import { Controller, Get, Inject, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import IORedis from 'ioredis';
import { FakeProvider, PaymentProvider, PaystackProvider, StripeProvider } from '@oja/payment-provider';
import { config } from './config';
import { JOBS, MAILER, PAYMENT, REDIS, STORAGE } from './tokens';
import { Prisma_ } from './infra/prisma';
import { makeRedis } from './infra/redis';
import { S3Storage } from './infra/storage';
import { BullJobs, SmtpMailer } from './infra/jobs';
import { AuthGuard, Public } from './common/auth';
import { ProblemFilter, RequestMiddleware, registry } from './common/http';
import { RateLimiter } from './common/ratelimit';
import { AuthController, AuthService, UsersController } from './modules/auth';
import { VendorsController, VendorsService } from './modules/vendors';
import { CatalogController, CatalogService } from './modules/catalog';
import { SearchController, SearchService } from './modules/search';
import { InventoryController, InventoryService } from './modules/inventory';
import { CartController, CartService } from './modules/cart';
import { CheckoutController, CheckoutService } from './modules/checkout';
import { OrderEvents, OrdersController, OrdersService } from './modules/orders';
import { PaymentsController, PaymentsService } from './modules/payments';
import { LedgerController, LedgerService } from './modules/ledger';
import { AdminController, AdminService, PayoutsService } from './modules/admin';
import { ElasticSearch } from './modules/search-es';
import { InvoiceController, InvoiceService } from './modules/invoices';
import { CouponController, CouponService } from './modules/coupons';
import { ReturnsController, ReturnsService, ReviewsService } from './modules/returns';
import { Notifier } from './modules/notifier';
import { ImageProcessor } from './modules/images';

@Controller()
class OpsController {
  constructor(private db: Prisma_, @Inject(REDIS) private redis: IORedis) {}
  @Public() @Get('health') async health() {
    await this.db.$queryRaw`SELECT 1`;
    await this.redis.ping();
    return { status: 'ok' };
  }
  @Public() @Get('metrics') async metrics() { return registry.metrics(); }
}

function paymentProvider(): PaymentProvider {
  if (config.paymentProvider === 'stripe') return new StripeProvider(config.stripeSecret, config.stripeWebhookSecret, config.stripeCurrency);
  if (config.paymentProvider === 'paystack') return new PaystackProvider(config.paystackSecret, config.paystackWebhookSecret, config.paystackCurrency);
  if (process.env.NODE_ENV === 'production') throw new Error('PAYMENT_PROVIDER=fake is not allowed in production');
  return new FakeProvider(config.fakeSecret, config.webOrigin);
}

@Module({
  controllers: [OpsController, AuthController, UsersController, VendorsController, CatalogController, SearchController, InventoryController, CartController,
    CheckoutController, OrdersController, PaymentsController, LedgerController, AdminController, ReturnsController, CouponController, InvoiceController],
  providers: [
    Prisma_,
    { provide: REDIS, useFactory: makeRedis },
    { provide: STORAGE, useFactory: () => new S3Storage() },
    { provide: JOBS, inject: [REDIS], useFactory: (r: IORedis) => new BullJobs(r) },
    { provide: MAILER, useFactory: () => new SmtpMailer() },
    { provide: PAYMENT, useFactory: paymentProvider },
    { provide: RateLimiter, inject: [REDIS], useFactory: (r: IORedis) => new RateLimiter(r) },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: ProblemFilter },
    AuthService, VendorsService, CatalogService, ElasticSearch, SearchService, InventoryService, CartService, CheckoutService, CouponService, InvoiceService, OrderEvents, OrdersService,
    PaymentsService, LedgerService, PayoutsService, AdminService, ReturnsService, ReviewsService, Notifier, ImageProcessor,
  ],
})
export class AppModule implements NestModule {
  configure(c: MiddlewareConsumer) { c.apply(RequestMiddleware).forRoutes('*'); }
}
