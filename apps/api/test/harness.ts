import 'reflect-metadata';
import '../src/common/bigint';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import * as argon2 from 'argon2';
import { FakeProvider } from '@oja/payment-provider';
import { AppModule } from '../src/app.module';
import { Prisma_ } from '../src/infra/prisma';
import { FakeStorage } from '../src/infra/storage';
import { RecordingJobs, RecordingMailer } from '../src/infra/jobs';
import { JOBS, MAILER, PAYMENT, REDIS, STORAGE } from '../src/tokens';
import { signAccess } from '../src/common/auth';

export async function boot() {
  const storage = new FakeStorage(), jobs = new RecordingJobs(), mailer = new RecordingMailer(), pay = new FakeProvider('test-secret');
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(STORAGE).useValue(storage).overrideProvider(JOBS).useValue(jobs)
    .overrideProvider(MAILER).useValue(mailer).overrideProvider(PAYMENT).useValue(pay).compile();
  const app = mod.createNestApplication({ rawBody: true, logger: false });
  app.use(cookieParser());
  await app.init();
  const db = app.get(Prisma_);
  return { app, db, storage, jobs, mailer, pay, server: app.getHttpServer(), redis: app.get(REDIS), close: async () => { await app.close(); } };
}
export type Harness = Awaited<ReturnType<typeof boot>>;

let hash: string | undefined;
export async function mkUser(db: Prisma_, role: 'CUSTOMER' | 'VENDOR' | 'ADMIN' | 'AGENT' = 'CUSTOMER') {
  hash ??= await argon2.hash('Passw0rd!x', { type: argon2.argon2id, memoryCost: 1024, timeCost: 2 });
  const u = await db.user.create({ data: { email: `${randomUUID()}@t.test`, name: 'T ' + role, role, passwordHash: hash } });
  return { ...u, token: signAccess({ id: u.id, role: u.role, email: u.email }) };
}
export const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

export async function mkVendor(db: Prisma_, status: 'APPROVED' | 'APPLIED' = 'APPROVED') {
  const u = await mkUser(db, 'VENDOR');
  const v = await db.vendorProfile.create({ data: { userId: u.id, storeName: 'Store ' + u.id.slice(0, 4), slug: 's-' + u.id.slice(0, 8), status } });
  return { user: u, vendor: v };
}
export async function mkCategory(db: Prisma_, bps?: number) {
  const c = await db.category.create({ data: { name: 'C' + randomUUID().slice(0, 6), slug: 'c-' + randomUUID() } });
  if (bps !== undefined) await db.commissionRule.create({ data: { categoryId: c.id, bps } });
  return c;
}
export async function mkProduct(db: Prisma_, vendorId: string, categoryId: string, priceKobo: bigint, stock: number, title = 'Widget') {
  const p = await db.product.create({ data: { vendorId, categoryId, title, slug: 'p-' + randomUUID(), status: 'ACTIVE' } });
  const v = await db.variant.create({ data: { productId: p.id, sku: 'S-' + randomUUID(), priceKobo } });
  await db.inventory.create({ data: { variantId: v.id, onHand: stock } });
  return { product: p, variant: v };
}
export async function fillCart(db: Prisma_, userId: string, lines: { variantId: string; qty: number; price: bigint }[]) {
  const cart = await db.cart.upsert({ where: { userId }, update: {}, create: { userId } });
  await db.cartItem.deleteMany({ where: { cartId: cart.id } });
  await db.cartItem.createMany({ data: lines.map((l) => ({ cartId: cart.id, variantId: l.variantId, qty: l.qty, unitPriceKobo: l.price })) });
}
export async function ensureDefaultRule(db: Prisma_) {
  if (!(await db.commissionRule.findFirst({ where: { categoryId: null } }))) await db.commissionRule.create({ data: { categoryId: null, bps: 1000 } });
}
