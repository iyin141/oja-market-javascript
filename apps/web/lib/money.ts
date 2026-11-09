/** Money arrives from the API as integer kobo (decimal string). Never use floats for arithmetic. */
export type KoboLike = string | number | bigint;

export function formatKobo(k: KoboLike): string {
  const v = BigInt(k);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const naira = (a / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const kobo = a % 100n;
  return `${neg ? "-" : ""}₦${naira}${kobo ? "." + kobo.toString().padStart(2, "0") : ""}`;
}

export const mulKobo = (k: KoboLike, qty: number): bigint => BigInt(k) * BigInt(qty);
