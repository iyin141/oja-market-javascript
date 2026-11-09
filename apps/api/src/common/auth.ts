import { CanActivate, ExecutionContext, Injectable, SetMetadata, createParamDecorator, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { Problem } from './http';

export type Role = 'CUSTOMER' | 'VENDOR' | 'ADMIN' | 'AGENT';
export interface AuthUser { id: string; role: Role; email: string }

export const Public = () => SetMetadata('public', true);
export const Roles = (...roles: Role[]) => SetMetadata('roles', roles);
export const CurrentUser = createParamDecorator((_d, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().user as AuthUser);

export const signAccess = (u: AuthUser) => jwt.sign({ role: u.role, email: u.email }, config.jwtAccess, { subject: u.id, expiresIn: '15m' });

/** Global default-deny guard: every route needs a valid access token unless @Public(); @Roles narrows further. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  canActivate(ctx: ExecutionContext) {
    const h = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>('public', h)) return true;
    const req = ctx.switchToHttp().getRequest();
    const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
    if (!m) throw new Problem(HttpStatus.UNAUTHORIZED, 'Unauthorized', 'missing bearer token');
    try {
      const p = jwt.verify(m[1], config.jwtAccess, { algorithms: ['HS256'] }) as jwt.JwtPayload;
      req.user = { id: p.sub!, role: p.role, email: p.email } as AuthUser;
    } catch { throw new Problem(HttpStatus.UNAUTHORIZED, 'Unauthorized', 'invalid or expired token'); }
    const roles = this.reflector.getAllAndOverride<Role[]>('roles', h);
    if (roles && !roles.includes(req.user.role)) throw new Problem(HttpStatus.FORBIDDEN, 'Forbidden', 'insufficient role');
    return true;
  }
}
