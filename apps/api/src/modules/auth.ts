import { Body, Controller, HttpCode, HttpStatus, Injectable, Post, Req, Res, Get, Patch, Delete, Param } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { loginSchema, registerSchema } from '@oja/shared';
import { z } from 'zod';
import type IORedis from 'ioredis';
import { Inject } from '@nestjs/common';
import { JOBS, REDIS } from '../tokens';
import type { Jobs } from '../infra/jobs';
import { passwordFingerprint, readResetToken } from './password-reset';
import { Prisma_ } from '../infra/prisma';
import { RateLimiter } from '../common/ratelimit';
import { Problem, Z } from '../common/http';
import { AuthUser, CurrentUser, Public, signAccess } from '../common/auth';
import { config } from '../config';

const REFRESH_DAYS = 30;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const cookieOpts = { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/auth', maxAge: REFRESH_DAYS * 86400_000 };

@Injectable()
export class AuthService {
  constructor(private db: Prisma_, private rl: RateLimiter, @Inject(JOBS) private jobs: Jobs) {}

  private async issue(user: { id: string; role: any; email: string }, familyId: string = randomUUID()) {
    const raw = randomBytes(48).toString('base64url');
    await this.db.refreshToken.create({ data: { userId: user.id, familyId, tokenHash: sha(raw), expiresAt: new Date(Date.now() + REFRESH_DAYS * 86400_000) } });
    return { accessToken: signAccess(user), refreshToken: raw };
  }

  async register(dto: z.infer<typeof registerSchema>, ip: string) {
    await this.rl.hit(`register:${ip}`, config.authRateLimit, 60);
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    try {
      const u = await this.db.user.create({ data: { email: dto.email, name: dto.name, passwordHash } });
      return { user: { id: u.id, email: u.email, name: u.name, role: u.role }, ...(await this.issue(u)) };
    } catch (e: any) {
      if (e.code === 'P2002') throw new Problem(HttpStatus.CONFLICT, 'Conflict', 'email already registered');
      throw e;
    }
  }

  async login(dto: z.infer<typeof loginSchema>, ip: string) {
    await this.rl.hit(`login-ip:${ip}`, config.authRateLimit * 3, 60);
    const lockKey = `login-fail:${dto.email}`;
    if ((await this.rl.count(lockKey)) >= 5) throw new Problem(HttpStatus.TOO_MANY_REQUESTS, 'Account temporarily locked', 'too many failed attempts, try again in 15 minutes');
    const u = await this.db.user.findUnique({ where: { email: dto.email } });
    const ok = u ? await argon2.verify(u.passwordHash, dto.password) : (await argon2.hash('x'), false);
    if (!u || !ok) {
      await this.rl.hit(lockKey, 1_000_000, 900);
      throw new Problem(HttpStatus.UNAUTHORIZED, 'Unauthorized', 'invalid credentials');
    }
    await this.rl.reset(lockKey);
    return { user: { id: u.id, email: u.email, name: u.name, role: u.role }, ...(await this.issue(u)) };
  }

  /** Always resolves the same way: nothing reveals whether the account exists. The mail is built by the worker, so no token sits in the queue. */
  async forgot(email: string, ip: string) {
    await this.rl.hit(`forgot-ip:${ip}`, config.authRateLimit, 60);
    try {
      await this.rl.hit(`forgot:${email}`, 3, 900); // 3 mails per address per 15 min; over that, silently send nothing
      const u = await this.db.user.findUnique({ where: { email } });
      if (u) await this.jobs.notify(u.id, 'auth.password_reset', {});
    } catch { /* rate-limited or queue hiccup: the caller still sees 204 */ }
  }

  async reset(token: string, password: string) {
    const bad = () => new Problem(HttpStatus.BAD_REQUEST, 'Invalid reset link', 'this reset link is invalid, expired or already used');
    const t = readResetToken(token);
    if (!t) throw bad();
    const u = await this.db.user.findUnique({ where: { id: t.userId } });
    if (!u || passwordFingerprint(u.passwordHash) !== t.fp) throw bad();
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    // Compare-and-set on the old hash: two concurrent uses of one token cannot both win.
    const [claim] = await this.db.$transaction([
      this.db.user.updateMany({ where: { id: u.id, passwordHash: u.passwordHash }, data: { passwordHash } }),
    ]);
    if (claim.count !== 1) throw bad();
    await this.db.refreshToken.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  /** Rotating refresh with reuse detection: replaying a rotated token revokes the whole family. */
  async refresh(raw: string | undefined) {
    if (!raw) throw new Problem(HttpStatus.UNAUTHORIZED, 'Unauthorized', 'no refresh token');
    const t = await this.db.refreshToken.findUnique({ where: { tokenHash: sha(raw) }, include: { user: true } });
    if (!t || t.expiresAt < new Date()) throw new Problem(HttpStatus.UNAUTHORIZED, 'Unauthorized', 'invalid refresh token');
    if (t.revokedAt) {
      await this.db.refreshToken.updateMany({ where: { familyId: t.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      throw new Problem(HttpStatus.UNAUTHORIZED, 'Unauthorized', 'refresh token reuse detected');
    }
    const claim = await this.db.refreshToken.updateMany({ where: { id: t.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (claim.count !== 1) throw new Problem(HttpStatus.UNAUTHORIZED, 'Unauthorized', 'refresh token already used');
    return this.issue(t.user, t.familyId);
  }

  async logout(raw: string | undefined) {
    if (!raw) return;
    const t = await this.db.refreshToken.findUnique({ where: { tokenHash: sha(raw) } });
    if (t) await this.db.refreshToken.updateMany({ where: { familyId: t.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}
  @Public() @Post('register')
  async register(@Body(Z(registerSchema)) dto: any, @Req() req: any, @Res({ passthrough: true }) res: any) {
    const r = await this.auth.register(dto, req.ip);
    res.cookie('refresh', r.refreshToken, cookieOpts);
    return { user: r.user, accessToken: r.accessToken };
  }
  @Public() @Post('login')
  async login(@Body(Z(loginSchema)) dto: any, @Req() req: any, @Res({ passthrough: true }) res: any) {
    const r = await this.auth.login(dto, req.ip);
    res.cookie('refresh', r.refreshToken, cookieOpts);
    return { user: r.user, accessToken: r.accessToken };
  }
  @Public() @HttpCode(204) @Post('forgot')
  async forgot(@Body(Z(z.object({ email: z.string().email().max(254).transform((s) => s.toLowerCase()) }))) b: any, @Req() req: any) { await this.auth.forgot(b.email, req.ip); }
  @Public() @HttpCode(204) @Post('reset')
  async reset(@Body(Z(z.object({ token: z.string().min(1).max(2000), password: registerSchema.shape.password }))) b: any) { await this.auth.reset(b.token, b.password); }
  @Public() @Post('refresh')
  async refresh(@Req() req: any, @Res({ passthrough: true }) res: any) {
    const r = await this.auth.refresh(req.cookies?.refresh);
    res.cookie('refresh', r.refreshToken, cookieOpts);
    return { accessToken: r.accessToken };
  }
  @Public() @Post('logout')
  async logout(@Req() req: any, @Res({ passthrough: true }) res: any) {
    await this.auth.logout(req.cookies?.refresh);
    res.clearCookie('refresh', { path: '/auth' });
    return { ok: true };
  }
}

const addressSchema = z.object({ line1: z.string().min(3), city: z.string().min(2), state: z.string().min(2), phone: z.string().min(7) });
@Controller()
export class UsersController {
  constructor(private db: Prisma_, @Inject(REDIS) private redis: IORedis) {}
  /** Session profile cache: the web app calls /me on every page load. 60 s TTL, dropped on profile change. */
  @Get('me') async me(@CurrentUser() u: AuthUser) {
    const key = `me:${u.id}`;
    const hit = await this.redis.get(key).catch(() => null);
    if (hit) return JSON.parse(hit);
    const out = await this.loadMe(u);
    await this.redis.set(key, JSON.stringify(out), 'EX', 60).catch(() => undefined);
    return out;
  }
  private async loadMe(u: AuthUser) {
    const r = await this.db.user.findUniqueOrThrow({ where: { id: u.id }, include: { vendor: { select: { id: true, status: true, storeName: true, slug: true } } } });
    return { id: r.id, email: r.email, name: r.name, role: r.role, vendor: r.vendor };
  }
  @Patch('me') async patch(@CurrentUser() u: AuthUser, @Body(Z(z.object({ name: z.string().min(1).max(100) }))) b: any) {
    const r = await this.db.user.update({ where: { id: u.id }, data: { name: b.name } });
    await this.redis.del(`me:${u.id}`).catch(() => undefined);
    return { id: r.id, name: r.name };
  }
  @Get('me/addresses') addresses(@CurrentUser() u: AuthUser) { return this.db.address.findMany({ where: { userId: u.id } }); }
  @Post('me/addresses') addAddress(@CurrentUser() u: AuthUser, @Body(Z(addressSchema)) b: any) { return this.db.address.create({ data: { ...b, userId: u.id } }); }
  @Delete('me/addresses/:id') async delAddress(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.db.address.deleteMany({ where: { id, userId: u.id } });
    return { ok: true };
  }
}
