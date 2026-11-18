import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma_ } from '../infra/prisma';
import { config } from '../config';
import { EFFECTIVE_PRICE_SQL, publicUrl } from './catalog';

const INDEX = 'oja-products';
const MAPPING = {
  settings: { number_of_shards: 1, number_of_replicas: 0, analysis: { analyzer: { edge: { tokenizer: 'edge_tokenizer', filter: ['lowercase'] } }, tokenizer: { edge_tokenizer: { type: 'edge_ngram', min_gram: 2, max_gram: 15, token_chars: ['letter', 'digit'] } } } },
  mappings: { properties: {
    slug: { type: 'keyword', index: false },
    title: { type: 'text', fields: { prefix: { type: 'text', analyzer: 'edge', search_analyzer: 'standard' } } }, description: { type: 'text' },
    categoryId: { type: 'keyword' }, categoryName: { type: 'keyword' }, vendorId: { type: 'keyword' }, vendorName: { type: 'keyword' }, vendorSlug: { type: 'keyword' },
    priceKobo: { type: 'long' }, inStock: { type: 'boolean' }, ratingAvg: { type: 'float' }, ratingCount: { type: 'integer' }, createdAt: { type: 'date' }, image: { type: 'keyword', index: false },
  } },
};

export interface EsQuery {
  q: string; categoryId?: string; vendorId?: string; minPrice?: bigint; maxPrice?: bigint; inStock?: boolean;
  sort: 'relevance' | 'price_asc' | 'price_desc' | 'rating' | 'newest'; page: number; limit: number;
}

/**
 * Elasticsearch-backed product search (spec milestone 4). Plain REST over fetch, so no client dependency.
 * Enabled when ELASTICSEARCH_URL is set; otherwise SearchService keeps using Postgres full-text search.
 * The index is rebuilt from Postgres on startup and every ES_REINDEX_SEC (default 60), and a product is re-indexed
 * when an admin approves it, so price and stock in the index lag the database by at most that interval.
 */
@Injectable()
export class ElasticSearch implements OnModuleInit, OnModuleDestroy {
  private log = new Logger('es');
  private timer?: NodeJS.Timeout;
  readonly enabled = !!config.elasticUrl;
  constructor(private db: Prisma_) {}

  private async es(path: string, method = 'GET', body?: unknown, ndjson = false) {
    const r = await fetch(config.elasticUrl + path, { method, headers: { 'content-type': ndjson ? 'application/x-ndjson' : 'application/json', ...(config.elasticApiKey ? { authorization: `ApiKey ${config.elasticApiKey}` } : {}) }, body: body === undefined ? undefined : ndjson ? (body as string) : JSON.stringify(body) });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`elasticsearch ${method} ${path} ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
    return j;
  }

  async onModuleInit() {
    if (!this.enabled) return;
    const every = Number(process.env.ES_REINDEX_SEC ?? 60) * 1000;
    const run = () => this.reindex().catch((e) => this.log.warn(`reindex failed, Postgres search still serves: ${e.message}`));
    void run();
    this.timer = setInterval(run, every);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  /** Rebuild the whole index into a fresh index and swap the alias, so searches never see a half-built index. */
  async reindex(): Promise<{ indexed: number }> {
    const name = `${INDEX}-${Date.now()}`;
    await this.es(`/${name}`, 'PUT', MAPPING);
    const rows = await this.db.$queryRawUnsafe<any[]>(
      `SELECT p.id, p.slug, p.title, p.description, p.category_id AS "categoryId", c.name AS "categoryName", p.vendor_id AS "vendorId", vp.store_name AS "vendorName", vp.slug AS "vendorSlug",
        p.rating_avg AS "ratingAvg", p.rating_count AS "ratingCount", p.created_at AS "createdAt", mp.price AS "priceKobo", mp.stock > 0 AS "inStock",
        (SELECT pi.key FROM product_images pi WHERE pi.product_id = p.id AND pi.status = 'READY' ORDER BY pi.position LIMIT 1) AS "imageKey"
       FROM products p JOIN vendor_profiles vp ON vp.id = p.vendor_id JOIN categories c ON c.id = p.category_id
       JOIN LATERAL (SELECT min(${EFFECTIVE_PRICE_SQL}) AS price, coalesce(sum(i.on_hand - i.reserved), 0) AS stock FROM variants v LEFT JOIN inventory i ON i.variant_id = v.id WHERE v.product_id = p.id) mp ON true
       WHERE p.status = 'ACTIVE' AND vp.status = 'APPROVED'`);
    if (rows.length) {
      const nd = rows.map(({ imageKey, priceKobo, ...r }) => `${JSON.stringify({ index: { _index: name, _id: r.id } })}\n${JSON.stringify({ ...r, priceKobo: Number(priceKobo), image: imageKey ? publicUrl(imageKey.replace('raw/', 'products/') + '-320.webp') : null })}\n`).join('');
      const res = await this.es('/_bulk?refresh=true', 'POST', nd, true);
      if (res.errors) throw new Error('bulk indexing reported errors');
    } else await this.es(`/${name}/_refresh`, 'POST');
    const old = await this.es(`/_alias/${INDEX}`).catch(() => ({}));
    const actions = [...Object.keys(old).map((i) => ({ remove: { index: i, alias: INDEX } })), { add: { index: name, alias: INDEX } }];
    await this.es('/_aliases', 'POST', { actions });
    for (const i of Object.keys(old)) await this.es(`/${i}`, 'DELETE').catch(() => undefined);
    return { indexed: rows.length };
  }

  async search(p: EsQuery) {
    const filters = (skip: string[] = []) => {
      const f: unknown[] = [];
      if (p.categoryId && !skip.includes('cat')) f.push({ term: { categoryId: p.categoryId } });
      if (p.vendorId && !skip.includes('vendor')) f.push({ term: { vendorId: p.vendorId } });
      if (p.minPrice !== undefined || p.maxPrice !== undefined) f.push({ range: { priceKobo: { ...(p.minPrice !== undefined ? { gte: Number(p.minPrice) } : {}), ...(p.maxPrice !== undefined ? { lte: Number(p.maxPrice) } : {}) } } });
      if (p.inStock) f.push({ term: { inStock: true } });
      return f;
    };
    const text = p.q.trim()
      ? [{ multi_match: { query: p.q, fields: ['title^3', 'title.prefix', 'description'], fuzziness: 'AUTO', operator: 'or' } }]
      : [{ match_all: {} }];
    const sort = ({
      relevance: ['_score', { ratingAvg: 'desc' }], price_asc: [{ priceKobo: 'asc' }], price_desc: [{ priceKobo: 'desc' }],
      rating: [{ ratingAvg: 'desc' }], newest: [{ createdAt: 'desc' }],
    } as const)[p.sort];
    // Facet aggregations ignore their own filter (post_filter pattern) so users can switch category/vendor.
    const j = await this.es(`/${INDEX}/_search`, 'POST', {
      from: (p.page - 1) * p.limit, size: p.limit, track_total_hits: true, sort,
      query: { bool: { must: text, filter: filters() } },
      aggs: {
        categories: { filter: { bool: { filter: filters(['cat']) } }, aggs: { b: { terms: { field: 'categoryId', size: 50 }, aggs: { name: { terms: { field: 'categoryName', size: 1 } } } } } },
        vendors: { filter: { bool: { filter: filters(['vendor']) } }, aggs: { b: { terms: { field: 'vendorId', size: 20 }, aggs: { name: { terms: { field: 'vendorName', size: 1 } } } } } },
        price: { filter: { bool: { filter: filters(['cat']) } }, aggs: { min: { min: { field: 'priceKobo' } }, max: { max: { field: 'priceKobo' } } } },
      },
    });
    const bucket = (a: any) => a.b.buckets.map((b: any) => ({ id: b.key, name: b.name.buckets[0]?.key ?? '', count: b.doc_count }));
    return {
      total: BigInt(j.hits.total.value), page: p.page, engine: 'elasticsearch',
      items: j.hits.hits.map((h: any) => ({ id: h._id, slug: h._source.slug, title: h._source.title, ratingAvg: h._source.ratingAvg, ratingCount: h._source.ratingCount, vendorName: h._source.vendorName, vendorSlug: h._source.vendorSlug, priceKobo: BigInt(h._source.priceKobo), inStock: h._source.inStock, rank: h._score, image: h._source.image })),
      facets: { categories: bucket(j.aggregations.categories), vendors: bucket(j.aggregations.vendors), price: { min: j.aggregations.price.min.value ?? null, max: j.aggregations.price.max.value ?? null } },
    };
  }
}
