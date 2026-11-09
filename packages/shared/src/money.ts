/** Money is integer kobo (bigint). No floats anywhere. */
export type Kobo = bigint;

export const Money = {
  /** Naira string/number with <=2 decimals -> kobo, without float math. */
  fromNaira(n: string | number): Kobo {
    const s = typeof n === 'number' ? n.toFixed(2) : n.trim();
    const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(s);
    if (!m) throw new Error(`invalid naira amount: ${s}`);
    const kobo = BigInt(m[2]) * 100n + BigInt((m[3] ?? '0').padEnd(2, '0'));
    return m[1] ? -kobo : kobo;
  },
  /** basis points of an amount, rounded half up (non-negative amounts). */
  bps(amount: Kobo, bps: number): Kobo {
    if (!Number.isInteger(bps) || bps < 0 || bps > 10000) throw new Error('bps out of range');
    return (amount * BigInt(bps) + 5000n) / 10000n;
  },
  /** Proportional share part/total of amount, rounded half up. Used for refunds. */
  prorate(amount: Kobo, part: Kobo, total: Kobo): Kobo {
    if (total === 0n) return 0n;
    return (amount * part * 2n + total) / (total * 2n);
  },
  format(k: Kobo): string {
    const neg = k < 0n;
    const a = neg ? -k : k;
    const naira = (a / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${neg ? '-' : ''}₦${naira}.${(a % 100n).toString().padStart(2, '0')}`;
  },
};
