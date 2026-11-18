const e = process.env;
const DEV_ACCESS = 'dev-access-secret-change-me-0123456789', DEV_REFRESH = 'dev-refresh-secret-change-me-0123456789';

/** Production refuses to boot on dev defaults. Returns the problems (variable NAMES only, never values). */
export function productionConfigProblems(env: Record<string, string | undefined>): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const bad: string[] = [];
  if (!env.JWT_ACCESS_SECRET || env.JWT_ACCESS_SECRET === DEV_ACCESS) bad.push('JWT_ACCESS_SECRET is unset or still the dev default');
  if (!env.JWT_REFRESH_SECRET || env.JWT_REFRESH_SECRET === DEV_REFRESH) bad.push('JWT_REFRESH_SECRET is unset or still the dev default');
  const provider = env.PAYMENT_PROVIDER ?? 'fake';
  if (provider === 'fake') bad.push('PAYMENT_PROVIDER must not be fake');
  if (provider === 'paystack' && !env.PAYSTACK_SECRET_KEY) bad.push('PAYSTACK_SECRET_KEY is empty while PAYMENT_PROVIDER=paystack');
  return bad;
}
const problems = productionConfigProblems(e);
if (problems.length) throw new Error(`Refusing to start in production: ${problems.join('; ')}`);
export const config = {
  port: Number(e.PORT ?? 4100),
  databaseUrl: e.DATABASE_URL ?? 'postgresql://oja_app:oja_app@localhost:5433/oja',
  redisUrl: e.REDIS_URL ?? 'redis://localhost:6380',
  jwtAccess: e.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-me-0123456789',
  jwtRefresh: e.JWT_REFRESH_SECRET ?? 'dev-refresh-secret-change-me-0123456789',
  s3: {
    endpoint: e.S3_ENDPOINT ?? 'http://localhost:8333', region: e.S3_REGION ?? 'us-east-1',
    accessKey: e.S3_ACCESS_KEY ?? 'ojaaccess', secretKey: e.S3_SECRET_KEY ?? 'ojasecret',
    publicBucket: e.S3_BUCKET_PUBLIC ?? 'oja-public', privateBucket: e.S3_BUCKET_PRIVATE ?? 'oja-private',
    forcePathStyle: (e.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
  },
  paymentProvider: (e.PAYMENT_PROVIDER ?? 'fake') as 'paystack' | 'stripe' | 'fake',
  stripeSecret: e.STRIPE_SECRET_KEY ?? '', stripeWebhookSecret: e.STRIPE_WEBHOOK_SECRET ?? '', stripeCurrency: e.STRIPE_CURRENCY ?? 'usd',
  elasticUrl: e.ELASTICSEARCH_URL ?? '', elasticApiKey: e.ELASTICSEARCH_API_KEY ?? '',
  paystackSecret: e.PAYSTACK_SECRET_KEY ?? '', paystackCurrency: e.PAYSTACK_CURRENCY ?? 'NGN', paystackWebhookSecret: e.PAYSTACK_WEBHOOK_SECRET ?? e.PAYSTACK_SECRET_KEY ?? '',
  fakeSecret: e.FAKE_PROVIDER_SECRET ?? 'fake-secret',
  smtpUrl: e.SMTP_URL ?? 'smtp://localhost:1125',
  webOrigin: e.WEB_ORIGIN ?? 'http://localhost:3100',
  /** Public origin PLUS base path (e.g. https://host/oja-market-js): used for links in emails and the payment callback. */
  webBaseUrl: e.WEB_BASE_URL || e.WEB_ORIGIN || 'http://localhost:3100',
  codLimitKobo: BigInt(e.COD_LIMIT_KOBO ?? '15000000'),
  reservationTtlMin: Number(e.RESERVATION_TTL_MIN ?? 15),
  settlementHoldDays: Number(e.SETTLEMENT_HOLD_DAYS ?? 7),
  authRateLimit: Number(e.AUTH_RATE_LIMIT ?? 10),
};
