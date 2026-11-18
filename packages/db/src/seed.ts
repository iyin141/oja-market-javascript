import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const db = new PrismaClient();
const PASSWORD = 'Passw0rd!demo';

const CATEGORIES: [string, string, number][] = [
  ['Electronics', 'electronics', 800], ['Fashion', 'fashion', 1200], ['Home & Kitchen', 'home-kitchen', 1000], ['Beauty', 'beauty', 1500],
  ['Groceries', 'groceries', 500], ['Sports', 'sports', 1000], ['Books', 'books', 700], ['Phones', 'phones', 600],
];
const VENDORS = [
  { email: 'vendor1@oja.test', store: 'Lagos Gadget Hub', slug: 'lagos-gadget-hub' },
  { email: 'vendor2@oja.test', store: 'Ankara & Co', slug: 'ankara-and-co' },
  { email: 'vendor3@oja.test', store: 'Mama Put Pantry', slug: 'mama-put-pantry' },
];
const NAMES = ['Apex Audio Pro Headphones', 'Wireless Earbuds', 'Smart Watch', 'Bluetooth Speaker', 'Power Bank 20000mAh'];

async function main() {
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  const user = (email: string, name: string, role: any) =>
    db.user.upsert({ where: { email }, update: {}, create: { email, name, role, passwordHash: hash } });

  await user('admin@oja.test', 'Oja Admin', 'ADMIN');
  await user('customer@oja.test', 'Ada Customer', 'CUSTOMER');
  await user('agent@oja.test', 'Delivery Agent', 'AGENT');

  const cats = [];
  for (const [name, slug, bps] of CATEGORIES) {
    const c = await db.category.upsert({ where: { slug }, update: {}, create: { name, slug } });
    await db.commissionRule.upsert({ where: { categoryId: c.id }, update: {}, create: { categoryId: c.id, bps } });
    cats.push(c);
  }
  if (!(await db.commissionRule.findFirst({ where: { categoryId: null } }))) await db.commissionRule.create({ data: { categoryId: null, bps: 1000 } });

  await db.coupon.upsert({ where: { code: 'WELCOME10' }, update: {}, create: { code: 'WELCOME10', kind: 'PERCENT', value: 1000n, minSubtotalKobo: 500000n } });
  await db.coupon.upsert({ where: { code: 'FLAT5000' }, update: {}, create: { code: 'FLAT5000', kind: 'FIXED', value: 500000n, minSubtotalKobo: 2000000n, maxUses: 100 } });

  let n = 0;
  for (const [vi, v] of VENDORS.entries()) {
    const u = await user(v.email, v.store, 'VENDOR');
    const vp = await db.vendorProfile.upsert({ where: { userId: u.id }, update: {}, create: { userId: u.id, storeName: v.store, slug: v.slug, status: 'APPROVED', approvedAt: new Date() } });
    for (let i = 0; i < 14 && n < 40; i++, n++) {
      const cat = cats[(n + vi) % cats.length];
      const title = `${NAMES[n % NAMES.length]} ${Math.floor(n / NAMES.length) + 1}`;
      const slug = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${n}`;
      const p = await db.product.upsert({ where: { slug }, update: {}, create: { vendorId: vp.id, categoryId: cat.id, slug, title, description: `${title} sold by ${v.store}. Genuine product with warranty.`, status: 'ACTIVE' } });
      const sku = `SKU-${String(n).padStart(4, '0')}`;
      const variant = await db.variant.upsert({ where: { sku }, update: {}, create: { productId: p.id, sku, priceKobo: BigInt(500000 + n * 125000) } });
      await db.inventory.upsert({ where: { variantId: variant.id }, update: {}, create: { variantId: variant.id, onHand: 25 + (n % 7) * 10 } });
    }
  }
  console.log(`seeded: 3 vendors, ${n} products, 2 coupons (WELCOME10, FLAT5000), ${CATEGORIES.length} categories. Login: *@oja.test / ${PASSWORD}`);
}
main().finally(() => db.$disconnect());
