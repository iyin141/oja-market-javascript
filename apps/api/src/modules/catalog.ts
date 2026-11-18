import { Body, Controller, Get, HttpStatus, Inject, Injectable, Param, Patch, Post, Query } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { MAX_IMAGE_BYTES, canProductTransition, presignSchema, productCreateSchema, kobo } from '@oja/shared';
import { Prisma_ } from '../infra/prisma';
import { Storage } from '../infra/storage';
import { Jobs } from '../infra/jobs';
import { JOBS, STORAGE } from '../tokens';
import { config } from '../config';
import { AuthUser, CurrentUser, Public, Roles } from '../common/auth';
import { Problem, Z } from '../common/http';

export const publicUrl = (key: string) => `${config.s3.endpoint}/${config.s3.publicBucket}/${key}`;

/** Magic-byte sniff: never trust the declared MIME or file extension. */
export function sniffImage(b: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 12 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

const EFFECTIVE_PRICE = `COALESCE((SELECT fs.price_kobo FROM flash_sales fs WHERE fs.variant_id = v.id AND now() BETWEEN fs.starts_at AND fs.ends_at ORDER BY fs.price_kobo LIMIT 1), v.price_kobo)`;
export const EFFECTIVE_PRICE_SQL = EFFECTIVE_PRICE;

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

@Injectable()
export class CatalogService {
  constructor(private db: Prisma_, @Inject(STORAGE) private storage: Storage, @Inject(JOBS) private jobs: Jobs) {}

  async approvedVendor(userId: string) {
    const v = await this.db.vendorProfile.findUnique({ where: { userId } });
    if (!v) throw new Problem(HttpStatus.FORBIDDEN, 'Forbidden', 'no vendor profile');
    if (v.status !== 'APPROVED') throw new Problem(HttpStatus.FORBIDDEN, 'Forbidden', `vendor is ${v.status}`);
    return v;
  }

  list(q: { categoryId?: string; vendorId?: string; vendorSlug?: string; sort?: string; page?: number; limit?: number }) {
    const limit = Math.min(q.limit ?? 24, 100); const offset = ((q.page ?? 1) - 1) * limit;
    const order = q.sort === 'price_asc' ? 'min_price ASC' : q.sort === 'price_desc' ? 'min_price DESC' : q.sort === 'rating' ? 'p.rating_avg DESC' : 'p.created_at DESC';
    return this.db.$queryRawUnsafe(
      `SELECT p.id, p.slug, p.title, p.rating_avg AS "ratingAvg", p.rating_count AS "ratingCount", vp.store_name AS "vendorName", vp.slug AS "vendorSlug", p.category_id AS "categoryId",
        (SELECT min(${EFFECTIVE_PRICE}) FROM variants v WHERE v.product_id = p.id) AS min_price,
        (SELECT min(v.price_kobo) FROM variants v WHERE v.product_id = p.id) AS "basePriceKobo",
        (SELECT pi.key FROM product_images pi WHERE pi.product_id = p.id AND pi.status = 'READY' ORDER BY pi.position LIMIT 1) AS "imageKey"
       FROM products p JOIN vendor_profiles vp ON vp.id = p.vendor_id
       WHERE p.status = 'ACTIVE' AND vp.status = 'APPROVED'
         AND ($1::uuid IS NULL OR p.category_id = $1::uuid) AND ($2::uuid IS NULL OR p.vendor_id = $2::uuid) AND ($3::text IS NULL OR vp.slug = $3)
       ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`, q.categoryId ?? null, q.vendorId ?? null, q.vendorSlug ?? null).then(withImage);
  }

  async get(idOrSlug: string) {
    const isUuid = /^[0-9a-f-]{36}$/i.test(idOrSlug);
    const p = await this.db.product.findFirst({
      where: { ...(isUuid ? { id: idOrSlug } : { slug: idOrSlug }), status: 'ACTIVE', vendor: { status: 'APPROVED' } },
      include: { vendor: { select: { id: true, storeName: true, slug: true, score: true } }, category: true, images: { where: { status: 'READY' }, orderBy: { position: 'asc' } } },
    });
    if (!p) throw new Problem(HttpStatus.NOT_FOUND, 'Not Found', 'product not found');
    const variants = await this.db.$queryRawUnsafe<any[]>(
      `SELECT v.id, v.sku, v.name, v.price_kobo AS "priceKobo", ${EFFECTIVE_PRICE} AS "effectivePriceKobo", i.on_hand - i.reserved AS available
       FROM variants v LEFT JOIN inventory i ON i.variant_id = v.id WHERE v.product_id = $1::uuid ORDER BY v.price_kobo`, p.id);
    return { ...p, images: p.images.map((i) => ({ id: i.id, url: publicUrl(i.key.replace('raw/', 'products/') + '-1200.webp'), thumb: publicUrl(i.key.replace('raw/', 'products/') + '-320.webp') })), variants };
  }

  categories() { return this.db.category.findMany({ orderBy: { name: 'asc' } }); }

  async create(userId: string, dto: z.infer<typeof productCreateSchema>) {
    const v = await this.approvedVendor(userId);
    const slug = `${slugify(dto.title)}-${randomUUID().slice(0, 6)}`;
    return this.db.$transaction(async (tx) => {
      const p = await tx.product.create({ data: { vendorId: v.id, categoryId: dto.categoryId, title: dto.title, description: dto.description, slug } });
      for (const vr of dto.variants) {
        const row = await tx.variant.create({ data: { productId: p.id, sku: vr.sku, name: vr.name, priceKobo: vr.priceKobo } });
        await tx.inventory.create({ data: { variantId: row.id, onHand: vr.stock } });
      }
      return p;
    });
  }

  async update(userId: string, id: string, b: { title?: string; description?: string; categoryId?: string; status?: 'DRAFT' | 'REVIEW' | 'ARCHIVED' }) {
    const v = await this.approvedVendor(userId);
    const p = await this.db.product.findFirst({ where: { id, vendorId: v.id } });
    if (!p) throw new Problem(HttpStatus.NOT_FOUND, 'Not Found', 'product not found');
    if (b.status && !canProductTransition(p.status, b.status)) throw new Problem(HttpStatus.CONFLICT, 'Illegal transition', `${p.status} -> ${b.status}`);
    return this.db.product.update({ where: { id }, data: b });
  }

  async editVariant(userId: string, id: string, b: { priceKobo?: bigint; stock?: number }) {
    const v = await this.approvedVendor(userId);
    const own = await this.db.variant.findFirst({ where: { id, product: { vendorId: v.id } } });
    if (!own) throw new Problem(HttpStatus.NOT_FOUND, 'Not Found', 'variant not found');
    try {
      if (b.priceKobo !== undefined) await this.db.variant.update({ where: { id }, data: { priceKobo: b.priceKobo } });
      if (b.stock !== undefined) await this.db.inventory.update({ where: { variantId: id }, data: { onHand: b.stock } });
    } catch (e: any) {
      if (/inventory_nonneg|check constraint/i.test(String(e.message))) throw new Problem(HttpStatus.CONFLICT, 'Conflict', 'stock cannot go below reserved units');
      throw e;
    }
    return { ok: true };
  }

  async mine(userId: string) {
    const rows = await this.db.product.findMany({ where: { vendor: { userId } }, include: { variants: { include: { inventory: true } }, images: { orderBy: { position: 'asc' } } }, orderBy: { createdAt: 'desc' } });
    // READY images carry their public URLs (same shape as GET /products/:id); others only have a status.
    return rows.map((p) => ({ ...p, images: p.images.map((i) => i.status === 'READY' ? { ...i, url: publicUrl(i.key.replace('raw/', 'products/') + '-1200.webp'), thumb: publicUrl(i.key.replace('raw/', 'products/') + '-320.webp') } : i) }));
  }

  async presign(userId: string, productId: string, dto: z.infer<typeof presignSchema>) {
    const v = await this.approvedVendor(userId);
    const p = await this.db.product.findFirst({ where: { id: productId, vendorId: v.id } });
    if (!p) throw new Problem(HttpStatus.NOT_FOUND, 'Not Found', 'product not found');
    const key = `raw/${productId}/${randomUUID()}`;
    const img = await this.db.productImage.create({ data: { productId, key, position: await this.db.productImage.count({ where: { productId } }) } });
    const uploadUrl = await this.storage.presignPut(config.s3.publicBucket, key, dto.contentType, dto.size, 300);
    return { imageId: img.id, key, uploadUrl, headers: { 'Content-Type': dto.contentType }, expiresInSec: 300 };
  }

  /** After the browser PUT: verify size + real bytes, then hand to the worker (sharp). */
  async confirmImage(userId: string, productId: string, imageId: string) {
    const v = await this.approvedVendor(userId);
    const img = await this.db.productImage.findFirst({ where: { id: imageId, productId, product: { vendorId: v.id } } });
    if (!img) throw new Problem(HttpStatus.NOT_FOUND, 'Not Found', 'image not found');
    const head = await this.storage.head(config.s3.publicBucket, img.key);
    if (!head) throw new Problem(HttpStatus.UNPROCESSABLE_ENTITY, 'Upload missing', 'object was not uploaded');
    const reject = async (detail: string) => {
      await this.db.productImage.update({ where: { id: imageId }, data: { status: 'REJECTED' } });
      throw new Problem(HttpStatus.UNPROCESSABLE_ENTITY, 'Image rejected', detail);
    };
    if (head.size > MAX_IMAGE_BYTES) return reject('file too large');
    const bytes = await this.storage.getBytes(config.s3.publicBucket, img.key);
    const real = sniffImage(bytes);
    if (!real) return reject('file content is not a JPEG, PNG or WebP image');
    await this.db.productImage.update({ where: { id: imageId }, data: { status: 'PROCESSING' } });
    await this.jobs.processImage(imageId);
    return { status: 'PROCESSING' };
  }

  flashSales() {
    return this.db.$queryRawUnsafe(
      `SELECT fs.id, fs.variant_id AS "variantId", fs.price_kobo AS "priceKobo", fs.starts_at AS "startsAt", fs.ends_at AS "endsAt", v.price_kobo AS "basePriceKobo", p.title, p.slug
       FROM flash_sales fs JOIN variants v ON v.id = fs.variant_id JOIN products p ON p.id = v.product_id
       WHERE p.status = 'ACTIVE' AND fs.ends_at > now() ORDER BY fs.starts_at LIMIT 50`);
  }
}

function withImage(rows: any): any[] {
  return (rows as any[]).map(({ min_price, imageKey, ...r }) => ({ ...r, priceKobo: min_price, image: imageKey ? publicUrl(imageKey.replace('raw/', 'products/') + '-320.webp') : null }));
}

const listQuery = z.object({ categoryId: z.string().uuid().optional(), vendorId: z.string().uuid().optional(), vendorSlug: z.string().optional(), sort: z.string().optional(), page: z.coerce.number().int().min(1).optional(), limit: z.coerce.number().int().min(1).max(100).optional() });

@Controller()
export class CatalogController {
  constructor(private c: CatalogService, private db: Prisma_) {}

  @Public() @Get('products') list(@Query(Z(listQuery)) q: any) { return this.c.list(q); }
  @Public() @Get('products/:id') get(@Param('id') id: string) { return this.c.get(id); }
  @Public() @Get('categories') categories() { return this.c.categories(); }
  @Public() @Get('flash-sales') flash() { return this.c.flashSales(); }

  @Roles('VENDOR') @Get('vendor/products') mine(@CurrentUser() u: AuthUser) { return this.c.mine(u.id); }
  @Roles('VENDOR') @Post('vendor/products')
  create(@CurrentUser() u: AuthUser, @Body(Z(productCreateSchema)) b: any) { return this.c.create(u.id, b); }
  @Roles('VENDOR') @Patch('vendor/products/:id')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(Z(z.object({ title: z.string().min(2).max(200).optional(), description: z.string().max(5000).optional(), categoryId: z.string().uuid().optional(), status: z.enum(['DRAFT', 'REVIEW', 'ARCHIVED']).optional() }))) b: any) {
    return this.c.update(u.id, id, b);
  }
  @Roles('VENDOR') @Patch('vendor/variants/:id')
  variant(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(Z(z.object({ priceKobo: kobo.optional(), stock: z.number().int().min(0).optional() }))) b: any) {
    return this.c.editVariant(u.id, id, b);
  }
  @Roles('VENDOR') @Post('vendor/products/:id/images/presign')
  presign(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(Z(presignSchema)) b: any) { return this.c.presign(u.id, id, b); }
  @Roles('VENDOR') @Post('vendor/products/:id/images/:imageId/confirm')
  confirm(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('imageId') imageId: string) { return this.c.confirmImage(u.id, id, imageId); }

  @Roles('ADMIN') @Get('admin/products') adminList(@Query('status') status = 'REVIEW') {
    return this.db.product.findMany({ where: { status: status as any }, include: { vendor: { select: { storeName: true } } }, take: 100 });
  }
  @Roles('ADMIN') @Post('admin/products/:id/approve') async approve(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const p = await this.db.product.findUnique({ where: { id } });
    if (!p) throw new Problem(404, 'Not Found');
    if (!canProductTransition(p.status, 'ACTIVE')) throw new Problem(409, 'Illegal transition', `${p.status} -> ACTIVE`);
    await this.db.$transaction([
      this.db.product.update({ where: { id }, data: { status: 'ACTIVE' } }),
      this.db.auditLog.create({ data: { actorId: u.id, action: 'product.approve', entity: 'product', entityId: id } }),
    ]);
    return { ok: true };
  }
  @Roles('ADMIN') @Post('admin/products/:id/reject') async reject(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body?: { note?: string }) {
    const p = await this.db.product.findUnique({ where: { id } });
    if (!p) throw new Problem(404, 'Not Found');
    if (!canProductTransition(p.status, 'DRAFT')) throw new Problem(409, 'Illegal transition', `${p.status} -> DRAFT`);
    await this.db.$transaction([
      this.db.product.update({ where: { id }, data: { status: 'DRAFT' } }),
      this.db.auditLog.create({ data: { actorId: u.id, action: 'product.reject', entity: 'product', entityId: id, meta: { note: String(body?.note ?? '').slice(0, 500) } } }),
    ]);
    return { ok: true };
  }
  @Roles('ADMIN') @Post('admin/flash-sales')
  async createFlash(@CurrentUser() u: AuthUser, @Body(Z(z.object({ variantId: z.string().uuid(), priceKobo: kobo, startsAt: z.coerce.date(), endsAt: z.coerce.date() }))) b: any) {
    const f = await this.db.flashSale.create({ data: b });
    await this.db.auditLog.create({ data: { actorId: u.id, action: 'flash.create', entity: 'flash_sale', entityId: f.id } });
    return f;
  }
}
