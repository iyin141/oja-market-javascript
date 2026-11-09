// Money is bigint kobo; serialize as decimal strings in JSON.
(BigInt.prototype as any).toJSON = function () { return this.toString(); };
export {};
