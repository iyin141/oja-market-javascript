import { Injectable, HttpStatus } from '@nestjs/common';
import IORedis from 'ioredis';
import { Problem } from './http';

/** Fixed-window counter in Redis. Throws 429 over the limit. */
@Injectable()
export class RateLimiter {
  constructor(private redis: IORedis) {}
  async hit(key: string, limit: number, windowSec: number) {
    const k = `rl:${key}`;
    const n = await this.redis.incr(k);
    if (n === 1) await this.redis.expire(k, windowSec);
    if (n > limit) throw new Problem(HttpStatus.TOO_MANY_REQUESTS, 'Too Many Requests', `retry in ${await this.redis.ttl(k)}s`);
  }
  async count(key: string) { return Number((await this.redis.get(`rl:${key}`)) ?? 0); }
  async reset(key: string) { await this.redis.del(`rl:${key}`); }
}
