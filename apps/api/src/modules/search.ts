import { Controller, Get, Injectable, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Prisma_ } from '../infra/prisma';
import { Public } from '../common/auth';
import { Z } from '../common/http';
import { EFFECTIVE_PRICE_SQL, publicUrl } from './catalog';
import { ElasticSearch } from './search-es';
import { Roles } from '../common/auth';

const q = z.object({
  q: z.string().max(100).default(''), categoryId: z.string().uuid().optional(), vendorId: z.string().uuid().optional(),
  minPrice: z.coerce.bigint().optional(), maxPrice: z.coerce.bigint().optional(), inStock: z.coerce.boolean().optional(),
  sort: z.enum(['relevance', 'price_asc', 'price_desc', 'rating', 'newest']).default('relevance'),
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(60).default(24),
});

/** "iphone ca" -> "iphone & ca:*" (prefix match on last term). Only [a-z0-9] survives, so no tsquery injection. */
export function toTsQuery(s: string): string {
  const terms = s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).slice(0, 8);
  return terms.map((t, i) => (i === terms.length - 1 ? `${t}:*` : t)).join(' & ');
}

@Injectable()
export class SearchService {
  constructor(private db: Prisma_, private es: ElasticSearch) {}

  /** Elasticsearch when configured; any ES failure falls back to Postgres full-text so search never goes down with the index. */
  async search(p: z.infer<typeof q>) {
    if (this.es.enabled) {
      try { return await this.es.search(p); } catch (e: any) { console.warn('search: elasticsearch failed, using postgres:', e.message); }
    }
    return this.pgSearch(p);
  }

  async pgSearch(p: z.infer<typeof q>) {
    const tsq = toTsQuery(p.q);
    const has = tsq.length > 0;
    const args: unknown[] = [tsq, p.q.trim()];
    const base = (skip: string[] = []) => {
      const w = [`p.status = 'ACTIVE'`, `vp.status = 'APPROVED'`];
      if (has) w.push(`(p.search_vector @@ to_tsquery('simple', $1) OR p.title % $2 OR p.title ILIKE '%' || $2 || '%')`);
      else w.push(`$1::text = $1::text AND $2::text = $2::text`); // keep param types resolvable
      if (p.categoryId && !skip.includes('cat')) { args.push(p.categoryId); w.push(`p.category_id = $${args.length}::uuid`); }
      if (p.vendorId && !skip.includes('vendor')) { args.push(p.vendorId); w.push(`p.vendor_id = $${args.length}::uuid`); }
      if (p.minPrice !== undefined) { args.push(p.minPrice); w.push(`mp.price >= $${args.length}::bigint`); }
      if (p.maxPrice !== undefined) { args.push(p.maxPrice); w.push(`mp.price <= $${args.length}::bigint`); }
      if (p.inStock) w.push(`mp.stock > 0`);
      return w.join(' AND ');
    };
    const from = `FROM products p JOIN vendor_profiles vp ON vp.id = p.vendor_id
      JOIN LATERAL (SELECT min(${EFFECTIVE_PRICE_SQL}) AS price, coalesce(sum(i.on_hand - i.reserved), 0) AS stock FROM variants v LEFT JOIN inventory i ON i.variant_id = v.id WHERE v.product_id = p.id) mp ON true`;
    const rank = has ? `(ts_rank(p.search_vector, to_tsquery('simple', $1)) + similarity(p.title, $2))` : `0`;
    const order = { relevance: `${rank} DESC, p.rating_avg DESC`, price_asc: 'mp.price ASC', price_desc: 'mp.price DESC', rating: 'p.rating_avg DESC', newest: 'p.created_at DESC' }[p.sort];

    const where = base();
    const argsMain = [...args];
    const items = await this.db.$queryRawUnsafe<any[]>(
      `SELECT p.id, p.slug, p.title, p.rating_avg AS "ratingAvg", p.rating_count AS "ratingCount", vp.store_name AS "vendorName", vp.slug AS "vendorSlug",
        mp.price AS "priceKobo", mp.stock > 0 AS "inStock", ${rank} AS rank,
        (SELECT pi.key FROM product_images pi WHERE pi.product_id = p.id AND pi.status = 'READY' ORDER BY pi.position LIMIT 1) AS "imageKey"
       ${from} WHERE ${where} ORDER BY ${order} LIMIT ${p.limit} OFFSET ${(p.page - 1) * p.limit}`, ...argsMain);
    const total = (await this.db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n ${from} WHERE ${where}`, ...argsMain))[0].n;

    // Facets ignore their own filter so users can switch category/vendor.
    args.length = 2;
    const catWhere = base(['cat']); const catArgs = [...args];
    args.length = 2;
    const vendWhere = base(['vendor']); const vendArgs = [...args];
    const categories = await this.db.$queryRawUnsafe(`SELECT c.id, c.name, count(*)::int AS count ${from} JOIN categories c ON c.id = p.category_id WHERE ${catWhere} GROUP BY c.id, c.name ORDER BY count DESC`, ...catArgs);
    const vendors = await this.db.$queryRawUnsafe(`SELECT vp.id, vp.store_name AS name, count(*)::int AS count ${from} WHERE ${vendWhere} GROUP BY vp.id, vp.store_name ORDER BY count DESC LIMIT 20`, ...vendArgs);
    const [price] = await this.db.$queryRawUnsafe<any[]>(`SELECT min(mp.price) AS min, max(mp.price) AS max ${from} WHERE ${catWhere}`, ...catArgs);
    return {
      total, page: p.page,
      items: items.map(({ imageKey, ...r }) => ({ ...r, image: imageKey ? publicUrl(imageKey.replace('raw/', 'products/') + '-320.webp') : null })),
      facets: { categories, vendors, price: { min: price?.min ?? null, max: price?.max ?? null } },
    };
  }
}

@Controller('search')
export class SearchController {
  constructor(private s: SearchService, private es: ElasticSearch) {}
  @Public() @Get() search(@Query(Z(q)) p: any) { return this.s.search(p); }
  @Roles('ADMIN') @Post('reindex') reindex() { return this.es.reindex(); }
}
