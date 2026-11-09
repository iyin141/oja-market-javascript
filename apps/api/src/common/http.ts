import { ArgumentsHost, BadRequestException, CallHandler, Catch, ExceptionFilter, ExecutionContext, HttpException, Injectable, NestInterceptor, PipeTransform, HttpStatus, NestMiddleware, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ZodError, ZodTypeAny } from 'zod';
import { Histogram, Registry, collectDefaultMetrics, Counter } from 'prom-client';
import pino from 'pino';

export const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

export const registry = new Registry();
collectDefaultMetrics({ register: registry });
export const httpHist = new Histogram({ name: 'http_request_duration_seconds', help: 'HTTP latency', labelNames: ['method', 'route', 'status'], registers: [registry], buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5] });
export const counters = {
  orders: new Counter({ name: 'oja_orders_created_total', help: 'orders', registers: [registry] }),
  payments: new Counter({ name: 'oja_payments_posted_total', help: 'payments posted to ledger', registers: [registry] }),
  webhookDup: new Counter({ name: 'oja_webhook_duplicates_total', help: 'duplicate webhooks', registers: [registry] }),
  oos: new Counter({ name: 'oja_out_of_stock_total', help: 'reservation failures', registers: [registry] }),
};

export class Problem extends HttpException {
  constructor(status: number, title: string, detail?: string, extra?: Record<string, unknown>) {
    super({ title, detail, ...extra }, status);
  }
}

/** Correlation id + request log + latency metric. */
@Injectable()
export class RequestMiddleware implements NestMiddleware {
  use(req: any, res: any, next: () => void) {
    const id = (req.headers['x-request-id'] as string) || randomUUID();
    req.id = id; res.setHeader('x-request-id', id);
    const t0 = process.hrtime.bigint();
    res.on('finish', () => {
      const sec = Number(process.hrtime.bigint() - t0) / 1e9;
      const route = req.route?.path ? (req.baseUrl ?? '') + req.route.path : 'unmatched';
      httpHist.labels(req.method, route, String(res.statusCode)).observe(sec);
      if (process.env.NODE_ENV !== 'test') log.info({ id, method: req.method, url: req.originalUrl, status: res.statusCode, ms: Math.round(sec * 1000) }, 'req');
    });
    next();
  }
}

/** RFC 7807 problem+json for everything. */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  catch(ex: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse(); const req = host.switchToHttp().getRequest();
    let status = 500, title = 'Internal Server Error', detail: string | undefined, extra: any = {};
    if (ex instanceof HttpException) {
      status = ex.getStatus(); const r: any = ex.getResponse();
      title = typeof r === 'string' ? r : r.title ?? r.error ?? ex.message; detail = typeof r === 'object' ? (Array.isArray(r.message) ? r.message.join('; ') : r.detail ?? r.message) : undefined;
      if (typeof r === 'object') { const { title: _t, detail: _d, message: _m, error: _e, statusCode: _s, ...rest } = r; extra = rest; }
    } else {
      log.error({ err: ex, id: req.id }, 'unhandled');
      const code = (ex as any)?.code;
      if (code === 'P2002') { status = 409; title = 'Conflict'; detail = 'duplicate value'; }
    }
    res.status(status).type('application/problem+json').json({ type: 'about:blank', title, status, detail, instance: req.originalUrl, correlationId: req.id, ...extra });
  }
}

export class ZodPipe implements PipeTransform {
  constructor(private schema: ZodTypeAny) {}
  transform(v: unknown) {
    const r = this.schema.safeParse(v);
    if (!r.success) throw new Problem(HttpStatus.BAD_REQUEST, 'Validation failed', 'invalid request', { errors: (r.error as ZodError).issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    return r.data;
  }
}
export const Z = (s: ZodTypeAny) => new ZodPipe(s);
