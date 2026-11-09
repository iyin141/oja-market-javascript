import IORedis from 'ioredis';
import { config } from '../config';
export const makeRedis = () => new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
