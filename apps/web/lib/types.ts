export interface ProductSummary {
  id: string; slug: string; title: string; vendorName: string; vendorSlug: string;
  priceKobo: string; basePriceKobo?: string; ratingAvg: number; ratingCount: number; image: string | null; icon?: string;
}
export interface Variant { id: string; sku: string; name: string; priceKobo: string; effectivePriceKobo: string; available: number }
export interface ProductDetail extends ProductSummary {
  description: string; vendor: { id: string; storeName: string; slug: string; score: number }; category: { name: string };
  images: { id: string; url: string; thumb: string }[]; variants: Variant[];
}
export interface SearchResult {
  total: number; items: ProductSummary[];
  facets: { categories: { id: string; name: string; count: number }[]; vendors: { id: string; name: string; count: number }[]; price: { min: string | null; max: string | null } };
}
export interface CartLine { variantId: string; slug: string; title: string; vendorId: string; vendorName: string; priceKobo: string; qty: number; available?: number }
export type SubOrderStatus = "PENDING_PAYMENT" | "PAID" | "AWAITING_COLLECTION" | "PACKED" | "SHIPPED" | "DELIVERED" | "RETURN_REQUESTED" | "REFUNDED" | "SETTLED" | "EXPIRED" | "CANCELLED";
export interface OrderSub { id: string; status: SubOrderStatus; subtotalKobo: string; vendor: { storeName: string }; items: { id: string; title: string; qty: number; unitPriceKobo: string }[]; trackingNo?: string | null; courier?: string | null }
export interface Order { id: string; status: SubOrderStatus | "MIXED"; totalKobo: string; createdAt: string; paymentMethod: "CARD" | "COD"; subOrders: OrderSub[] }
export interface VendorOrderRow { id: string; status: SubOrderStatus; subtotalKobo: string; createdAt: string; items: { title: string; qty: number }[]; order: { user: { name: string }; paymentMethod: string } }
export interface Balance { pendingKobo: string; availableKobo: string; holdKobo: string; paidOutKobo: string }
export interface Kpis { gmvKobo: string; paidSubOrders: number; commissionKobo: string; refundedKobo: string; pendingVendors: number; pendingProducts: number; openDisputes: number; flaggedVendors: number; ledger: { ok: boolean; totalDebits: string; totalCredits: string } }
export interface Category { id: string; name: string; slug: string }
export interface Review { id: string; rating: number; title?: string | null; body: string; authorName: string; createdAt: string }
