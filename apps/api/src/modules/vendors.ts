import { Body, Controller, Get, HttpStatus, Inject, Injectable, Param, Patch, Post, Query } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { canVendorTransition } from '@oja/shared';
import { Prisma_ } from '../infra/prisma';
import { Storage } from '../infra/storage';
import { Jobs } from '../infra/jobs';
import type IORedis from 'ioredis';
import { JOBS, PAYMENT, REDIS, STORAGE } from '../tokens';
import { PaystackProvider, StripeProvider, type PaymentProvider } from '@oja/payment-provider';
import { config } from '../config';
import { AuthUser, CurrentUser, Roles, signAccess } from '../common/auth';
import { Problem, Z } from '../common/http';

const KYC_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
const KYC_MAX = 10 * 1024 * 1024;
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

@Injectable()
export class VendorsService {
  constructor(private db: Prisma_, @Inject(STORAGE) private storage: Storage, @Inject(JOBS) private jobs: Jobs, @Inject(PAYMENT) private pay: PaymentProvider, @Inject(REDIS) private redis: IORedis) {}

  /** Stripe Connect Express onboarding (test mode): creates the connected account once, returns a hosted onboarding link. */
  async stripeOnboard(user: AuthUser) {
    if (!(this.pay instanceof StripeProvider)) throw new Problem(HttpStatus.CONFLICT, 'Conflict', 'Stripe is not the active payment provider');
    const v = await this.db.vendorProfile.findUnique({ where: { userId: user.id } });
    if (!v) throw new Problem(HttpStatus.FORBIDDEN, 'Forbidden', 'no vendor profile');
    let accountId = v.payoutAccountId;
    if (!accountId) {
      accountId = (await this.pay.createConnectedAccount(user.email)).accountId;
      await this.db.vendorProfile.update({ where: { id: v.id }, data: { payoutAccountId: accountId } });
    }
    return this.pay.onboardingLink(accountId, `${config.webOrigin}/seller`);
  }

  /** Banks the vendor can be paid into (Paystack /bank). */
  async banks() {
    if (!(this.pay instanceof PaystackProvider)) throw new Problem(HttpStatus.CONFLICT, 'Conflict', 'Paystack is not the active payment provider');
    return this.pay.listBanks();
  }

  /**
   * Paystack payout setup: resolve the account holder at the bank (GET /bank/resolve), then register a transfer recipient
   * (POST /transferrecipient). The recipient code is what the payout run transfers to.
   */
  async paystackRecipient(user: AuthUser, bankCode: string, accountNumber: string) {
    if (!(this.pay instanceof PaystackProvider)) throw new Problem(HttpStatus.CONFLICT, 'Conflict', 'Paystack is not the active payment provider');
    const v = await this.db.vendorProfile.findUnique({ where: { userId: user.id } });
    if (!v) throw new Problem(HttpStatus.FORBIDDEN, 'Forbidden', 'no vendor profile');
    let name: string;
    try { name = (await this.pay.resolveAccount(accountNumber, bankCode)).accountName; }
    catch (e: any) {
      // 400/422 from Paystack = the bank does not know this account; anything else (401 IP not allowed, 5xx) is a gateway problem, not the vendor's typo
      if (/ (400|422):/.test(String(e?.message))) throw new Problem(HttpStatus.UNPROCESSABLE_ENTITY, 'Account not found', 'the bank could not verify this account number');
      throw new Problem(HttpStatus.BAD_GATEWAY, 'Payment provider unavailable', 'could not reach the payment service, try again shortly');
    }
    const { recipientCode } = await this.pay.createRecipient({ name, accountNumber, bankCode });
    await this.db.vendorProfile.update({ where: { id: v.id }, data: { payoutAccountId: recipientCode } });
    return { accountName: name };
  }

  async apply(user: AuthUser, storeName: string) {
    if (await this.db.vendorProfile.findUnique({ where: { userId: user.id } })) throw new Problem(HttpStatus.CONFLICT, 'Conflict', 'already applied');
    const slug = `${slugify(storeName)}-${randomUUID().slice(0, 4)}`;
    const [profile, u] = await this.db.$transaction([
      this.db.vendorProfile.create({ data: { userId: user.id, storeName, slug } }),
      this.db.user.update({ where: { id: user.id }, data: { role: user.role === 'ADMIN' ? 'ADMIN' : 'VENDOR' } }),
    ]);
    // Role changed: hand back a fresh access token so the new role applies immediately.
    return { profile, accessToken: signAccess({ id: u.id, role: u.role, email: u.email }) };
  }

  private async mineOrFail(userId: string) {
    const v = await this.db.vendorProfile.findUnique({ where: { userId } });
    if (!v) throw new Problem(HttpStatus.FORBIDDEN, 'Forbidden', 'no vendor profile');
    return v;
  }

  me(userId: string) { return this.mineOrFail(userId); }

  /** Step 1 (no docKey): presigned PUT into the PRIVATE bucket. Step 2 (docKey): verify object, move to KYC_SUBMITTED. */
  async kyc(userId: string, b: { contentType?: string; size?: number; docKey?: string }) {
    const v = await this.mineOrFail(userId);
    if (!b.docKey) {
      if (!b.contentType || !b.size) throw new Problem(HttpStatus.BAD_REQUEST, 'Validation failed', 'contentType and size required');
      if (!(KYC_TYPES as readonly string[]).includes(b.contentType) || b.size > KYC_MAX) throw new Problem(HttpStatus.UNPROCESSABLE_ENTITY, 'Rejected', 'only pdf/jpeg/png up to 10MB');
      const key = `kyc/${v.id}/${randomUUID()}`;
      return { key, uploadUrl: await this.storage.presignPut(config.s3.privateBucket, key, b.contentType, b.size, 300), headers: { 'Content-Type': b.contentType } };
    }
    if (!b.docKey.startsWith(`kyc/${v.id}/`)) throw new Problem(HttpStatus.FORBIDDEN, 'Forbidden', 'foreign key');
    if (!canVendorTransition(v.status, 'KYC_SUBMITTED')) throw new Problem(HttpStatus.CONFLICT, 'Illegal transition', `${v.status} -> KYC_SUBMITTED`);
    if (!(await this.storage.head(config.s3.privateBucket, b.docKey))) throw new Problem(HttpStatus.UNPROCESSABLE_ENTITY, 'Upload missing', 'document was not uploaded');
    return this.db.vendorProfile.update({ where: { id: v.id }, data: { status: 'KYC_SUBMITTED', kycKey: b.docKey, kycNote: null } });
  }

  list(status?: string) { return this.db.vendorProfile.findMany({ where: status ? { status: status as any } : {}, include: { user: { select: { email: true, name: true } } }, orderBy: { createdAt: 'asc' }, take: 200 }); }

  async decide(adminId: string, id: string, to: 'APPROVED' | 'REJECTED' | 'SUSPENDED', note?: string) {
    const v = await this.db.vendorProfile.findUnique({ where: { id } });
    if (!v) throw new Problem(HttpStatus.NOT_FOUND, 'Not Found', 'vendor not found');
    if (!canVendorTransition(v.status, to)) throw new Problem(HttpStatus.CONFLICT, 'Illegal transition', `${v.status} -> ${to}`);
    const [u] = await this.db.$transaction([
      this.db.vendorProfile.update({ where: { id }, data: { status: to, kycNote: note ?? null, approvedAt: to === 'APPROVED' ? new Date() : v.approvedAt } }),
      this.db.auditLog.create({ data: { actorId: adminId, action: `vendor.${to.toLowerCase()}`, entity: 'vendor', entityId: id, meta: { note } } }),
    ]);
    await this.redis.del(`me:${v.userId}`).catch(() => undefined);
    await this.jobs.notify(v.userId, `vendor.${to.toLowerCase()}`, { storeName: v.storeName, note });
    return u;
  }

  async kycUrl(adminId: string, id: string) {
    const v = await this.db.vendorProfile.findUnique({ where: { id } });
    if (!v?.kycKey) throw new Problem(HttpStatus.NOT_FOUND, 'Not Found', 'no KYC document');
    await this.db.auditLog.create({ data: { actorId: adminId, action: 'vendor.kyc_view', entity: 'vendor', entityId: id } });
    return { url: await this.storage.presignGet(config.s3.privateBucket, v.kycKey, 120) };
  }
}

@Controller()
export class VendorsController {
  constructor(private v: VendorsService) {}
  @Post('vendors/apply') apply(@CurrentUser() u: AuthUser, @Body(Z(z.object({ storeName: z.string().min(2).max(80) }))) b: any) { return this.v.apply(u, b.storeName); }
  @Roles('VENDOR') @Get('vendors/banks') banks() { return this.v.banks(); }
  @Roles('VENDOR') @Post('vendors/me/paystack/recipient')
  recipient(@CurrentUser() u: AuthUser, @Body(Z(z.object({ bankCode: z.string().min(2).max(10), accountNumber: z.string().regex(/^\d{10}$/) }))) b: any) { return this.v.paystackRecipient(u, b.bankCode, b.accountNumber); }
  @Roles('VENDOR') @Post('vendors/me/stripe/onboard') stripe(@CurrentUser() u: AuthUser) { return this.v.stripeOnboard(u); }
  @Roles('VENDOR') @Get('vendors/me') me(@CurrentUser() u: AuthUser) { return this.v.me(u.id); }
  @Roles('VENDOR') @Patch('vendors/me/kyc')
  kyc(@CurrentUser() u: AuthUser, @Body(Z(z.object({ contentType: z.string().optional(), size: z.number().int().positive().optional(), docKey: z.string().optional() }))) b: any) { return this.v.kyc(u.id, b); }

  @Roles('ADMIN') @Get('admin/vendors') list(@Query('status') s?: string) { return this.v.list(s); }
  @Roles('ADMIN') @Post('admin/vendors/:id/approve') approve(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.v.decide(u.id, id, 'APPROVED'); }
  @Roles('ADMIN') @Post('admin/vendors/:id/reject')
  reject(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(Z(z.object({ note: z.string().max(500).optional() }))) b: any) { return this.v.decide(u.id, id, 'REJECTED', b.note); }
  @Roles('ADMIN') @Post('admin/vendors/:id/suspend') suspend(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.v.decide(u.id, id, 'SUSPENDED'); }
  @Roles('ADMIN') @Get('admin/vendors/:id/kyc-url') kycUrl(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.v.kycUrl(u.id, id); }
}
