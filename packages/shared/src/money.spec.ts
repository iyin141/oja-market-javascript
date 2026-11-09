import { Money } from './money';
describe('Money', () => {
  it('parses naira without float error', () => {
    expect(Money.fromNaira('0.10')).toBe(10n);
    expect(Money.fromNaira(19.99)).toBe(1999n);
    expect(Money.fromNaira('1500')).toBe(150000n);
    expect(() => Money.fromNaira('1.234')).toThrow();
  });
  it('bps rounds half up', () => {
    expect(Money.bps(100000n, 1000)).toBe(10000n);
    expect(Money.bps(5n, 1000)).toBe(1n);
    expect(Money.bps(4n, 1000)).toBe(0n);
  });
  it('prorate', () => {
    expect(Money.prorate(999n, 1000n, 1000n)).toBe(999n);
    expect(Money.prorate(1000n, 1n, 3n)).toBe(333n);
  });
  it('formats', () => {
    expect(Money.format(123456789n)).toBe('₦1,234,567.89');
  });
});
