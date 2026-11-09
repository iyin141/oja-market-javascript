import type { Balance, Kpis, Order, ProductDetail, ProductSummary, SearchResult, VendorOrderRow } from "./types";

const V = [
  { id: "v1", name: "Lagos Gadget Hub", slug: "lagos-gadget-hub" },
  { id: "v2", name: "Ankara & Co", slug: "ankara-and-co" },
  { id: "v3", name: "Mama Put Pantry", slug: "mama-put-pantry" },
];
const mk = (i: number, title: string, naira: number, v: number, icon: string, rating = 4.5): ProductSummary => ({
  id: `fx-${i}`, slug: `fx-${i}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, title, vendorName: V[v].name, vendorSlug: V[v].slug,
  priceKobo: String(naira * 100), basePriceKobo: String(Math.round(naira * 1.2) * 100), ratingAvg: rating, ratingCount: 40 + i * 13, image: null, icon,
});
export const FIXTURE_PRODUCTS: ProductSummary[] = [
  mk(1, "Apex Audio Pro Headphones", 85000, 0, "headphones", 4.8), mk(2, "Wireless Earbuds", 32000, 0, "earbuds"), mk(3, "Retro Bluetooth Speaker", 41000, 0, "speaker"),
  mk(4, "Power Bank 20000mAh", 18500, 0, "battery_charging_full", 4.3), mk(5, "Ankara Print Overshirt", 27000, 1, "checkroom"), mk(6, "Canvas Weekender Bag", 36000, 1, "luggage", 4.6),
  mk(7, "Leather Cardholder", 12000, 1, "wallet"), mk(8, "Smoked Party Jollof Spice Mix", 3500, 2, "restaurant", 4.9), mk(9, "Palm Oil 5L", 14500, 2, "oil_barrel"),
  mk(10, "Ceramic Pour-over Set", 22000, 2, "coffee_maker", 4.4), mk(11, "Minimalist Watch", 58000, 1, "watch", 4.7), mk(12, "Mechanical Keyboard", 64000, 0, "keyboard", 4.6),
];
export const FIXTURE_CATEGORIES = [
  { id: "c1", name: "Electronics", count: 3400, icon: "devices" }, { id: "c2", name: "Fashion", count: 4200, icon: "checkroom" },
  { id: "c3", name: "Home & Kitchen", count: 5100, icon: "chair" }, { id: "c4", name: "Beauty", count: 2900, icon: "spa" },
  { id: "c5", name: "Groceries", count: 2200, icon: "shopping_basket" }, { id: "c6", name: "Sports", count: 1600, icon: "sports_soccer" },
];
export const FIXTURE_VENDORS = V;
export const FIXTURE_SEARCH = (q: string): SearchResult => {
  const items = FIXTURE_PRODUCTS.filter((p) => !q || p.title.toLowerCase().includes(q.toLowerCase()));
  return {
    total: items.length, items,
    facets: {
      categories: FIXTURE_CATEGORIES.map((c) => ({ id: c.id, name: c.name, count: Math.min(c.count, items.length) })),
      vendors: V.map((v) => ({ id: v.id, name: v.name, count: items.filter((p) => p.vendorSlug === v.slug).length })),
      price: { min: "300000", max: "8500000" },
    },
  };
};
export const FIXTURE_DETAIL = (slug: string): ProductDetail => {
  const p = FIXTURE_PRODUCTS.find((x) => x.slug === slug) ?? FIXTURE_PRODUCTS[0];
  const v = V.find((x) => x.slug === p.vendorSlug)!;
  return {
    ...p,
    description: "Studio-tuned drivers, 40 hour battery, active noise cancelling and multipoint Bluetooth 5.3. Sold directly by a verified Oja Market vendor with warranty and escrow buyer protection.",
    vendor: { id: v.id, storeName: v.name, slug: v.slug, score: 96 }, category: { name: "Electronics" }, images: [],
    variants: [
      { id: `${p.id}-black`, sku: "BLK", name: "Black", priceKobo: p.priceKobo, effectivePriceKobo: p.priceKobo, available: 14 },
      { id: `${p.id}-silver`, sku: "SLV", name: "Silver", priceKobo: p.priceKobo, effectivePriceKobo: p.priceKobo, available: 3 },
    ],
  };
};
export const FIXTURE_ORDERS: Order[] = [
  { id: "00000000-0000-4000-8000-0000000000a1", status: "MIXED", totalKobo: "11700000", createdAt: "2026-11-02T10:00:00Z", paymentMethod: "CARD", subOrders: [
    { id: "s1", status: "DELIVERED", subtotalKobo: "8500000", vendor: { storeName: "Lagos Gadget Hub" }, items: [{ id: "i1", title: "Apex Audio Pro Headphones", qty: 1, unitPriceKobo: "8500000" }], courier: "GIG", trackingNo: "GIG-48211" },
    { id: "s2", status: "SHIPPED", subtotalKobo: "3200000", vendor: { storeName: "Ankara & Co" }, items: [{ id: "i2", title: "Canvas Weekender Bag", qty: 1, unitPriceKobo: "3200000" }], courier: "DHL", trackingNo: "DHL-77120" },
  ] },
  { id: "00000000-0000-4000-8000-0000000000a2", status: "PAID", totalKobo: "350000", createdAt: "2026-11-06T09:00:00Z", paymentMethod: "CARD", subOrders: [
    { id: "s3", status: "PAID", subtotalKobo: "350000", vendor: { storeName: "Mama Put Pantry" }, items: [{ id: "i3", title: "Smoked Party Jollof Spice Mix", qty: 1, unitPriceKobo: "350000" }] },
  ] },
];
export const FIXTURE_VENDOR_ORDERS: VendorOrderRow[] = [
  { id: "vo1", status: "PAID", subtotalKobo: "8500000", createdAt: "2026-11-07T08:00:00Z", items: [{ title: "Apex Audio Pro Headphones", qty: 1 }], order: { user: { name: "Ada Customer" }, paymentMethod: "CARD" } },
  { id: "vo2", status: "SHIPPED", subtotalKobo: "3200000", createdAt: "2026-11-05T08:00:00Z", items: [{ title: "Wireless Earbuds", qty: 1 }], order: { user: { name: "Tunde B." }, paymentMethod: "COD" } },
  { id: "vo3", status: "DELIVERED", subtotalKobo: "4100000", createdAt: "2026-11-01T08:00:00Z", items: [{ title: "Retro Bluetooth Speaker", qty: 1 }], order: { user: { name: "Ngozi E." }, paymentMethod: "CARD" } },
];
export const FIXTURE_BALANCE: Balance = { pendingKobo: "7650000", availableKobo: "3690000", holdKobo: "0", paidOutKobo: "12000000" };
export const FIXTURE_KPIS: Kpis = {
  gmvKobo: "482500000", paidSubOrders: 128, commissionKobo: "41200000", refundedKobo: "3200000",
  pendingVendors: 3, pendingProducts: 7, openDisputes: 2, flaggedVendors: 1, ledger: { ok: true, totalDebits: "1250000000", totalCredits: "1250000000" },
};
