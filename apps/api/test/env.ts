process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://oja_app:oja_app@localhost:5433/oja_test?connection_limit=40';
process.env.REDIS_URL = 'redis://localhost:6380/1';
process.env.AUTH_RATE_LIMIT = '100000';
process.env.PAYMENT_PROVIDER = 'fake';
process.env.FAKE_PROVIDER_SECRET = 'test-secret';
