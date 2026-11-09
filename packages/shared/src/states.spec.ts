import { canTransition, canVendorTransition, canProductTransition, deriveOrderStatus } from './states';
describe('state machines', () => {
  it('allows happy path', () => {
    const path = ['PENDING_PAYMENT', 'PAID', 'PACKED', 'SHIPPED', 'DELIVERED', 'SETTLED'] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i], path[i + 1])).toBe(true);
  });
  it('rejects illegal jumps', () => {
    expect(canTransition('PENDING_PAYMENT', 'SHIPPED')).toBe(false);
    expect(canTransition('SETTLED', 'REFUNDED')).toBe(false);
    expect(canTransition('SHIPPED', 'CANCELLED')).toBe(false);
    expect(canTransition('DELIVERED', 'PAID')).toBe(false);
    expect(canTransition('EXPIRED', 'PAID')).toBe(false);
  });
  it('return loop', () => {
    expect(canTransition('DELIVERED', 'RETURN_REQUESTED')).toBe(true);
    expect(canTransition('RETURN_REQUESTED', 'DELIVERED')).toBe(true);
    expect(canTransition('RETURN_REQUESTED', 'REFUNDED')).toBe(true);
  });
  it('vendor + product', () => {
    expect(canVendorTransition('APPLIED', 'APPROVED')).toBe(false);
    expect(canVendorTransition('KYC_SUBMITTED', 'APPROVED')).toBe(true);
    expect(canVendorTransition('REJECTED', 'KYC_SUBMITTED')).toBe(true);
    expect(canProductTransition('DRAFT', 'ACTIVE')).toBe(false);
    expect(canProductTransition('REVIEW', 'ACTIVE')).toBe(true);
  });
  it('derives order status', () => {
    expect(deriveOrderStatus(['PAID', 'PAID'])).toBe('PAID');
    expect(deriveOrderStatus(['PAID', 'SHIPPED'])).toBe('MIXED');
  });
});
