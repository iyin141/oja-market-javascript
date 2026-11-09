export const SUB_ORDER_STATES = [
  'PENDING_PAYMENT', 'PAID', 'AWAITING_COLLECTION', 'PACKED', 'SHIPPED', 'DELIVERED',
  'RETURN_REQUESTED', 'REFUNDED', 'SETTLED', 'EXPIRED', 'CANCELLED',
] as const;
export type SubOrderState = (typeof SUB_ORDER_STATES)[number];

const T: Record<SubOrderState, SubOrderState[]> = {
  PENDING_PAYMENT: ['PAID', 'EXPIRED', 'AWAITING_COLLECTION', 'CANCELLED'],
  PAID: ['PACKED', 'CANCELLED'],
  AWAITING_COLLECTION: ['PACKED', 'CANCELLED'],
  PACKED: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: ['RETURN_REQUESTED', 'SETTLED'],
  RETURN_REQUESTED: ['REFUNDED', 'DELIVERED'],
  REFUNDED: [], SETTLED: [], EXPIRED: [], CANCELLED: [],
};
export const canTransition = (from: SubOrderState, to: SubOrderState) => T[from].includes(to);

/** Order status derived from sub-orders: one state if they agree, else MIXED. */
export function deriveOrderStatus(states: SubOrderState[]): SubOrderState | 'MIXED' {
  const uniq = [...new Set(states)];
  return uniq.length === 1 ? uniq[0] : 'MIXED';
}

export const VENDOR_STATES = ['APPLIED', 'KYC_SUBMITTED', 'APPROVED', 'REJECTED', 'SUSPENDED'] as const;
export type VendorState = (typeof VENDOR_STATES)[number];
const V: Record<VendorState, VendorState[]> = {
  APPLIED: ['KYC_SUBMITTED'], KYC_SUBMITTED: ['APPROVED', 'REJECTED'], APPROVED: ['SUSPENDED'],
  REJECTED: ['KYC_SUBMITTED'], SUSPENDED: ['APPROVED'],
};
export const canVendorTransition = (f: VendorState, t: VendorState) => V[f].includes(t);

export const PRODUCT_STATES = ['DRAFT', 'REVIEW', 'ACTIVE', 'ARCHIVED'] as const;
export type ProductState = (typeof PRODUCT_STATES)[number];
const P: Record<ProductState, ProductState[]> = { DRAFT: ['REVIEW'], REVIEW: ['ACTIVE', 'DRAFT'], ACTIVE: ['ARCHIVED', 'DRAFT'], ARCHIVED: ['DRAFT'] };
export const canProductTransition = (f: ProductState, t: ProductState) => P[f].includes(t);
