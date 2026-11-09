import 'reflect-metadata';
import './common/bigint';
import { NestFactory } from '@nestjs/core';
import { Queue, Worker } from 'bullmq';
import { AppModule } from './app.module';
import { makeRedis } from './infra/redis';
import { QUEUE_NAME } from './infra/jobs';
import { InventoryService } from './modules/inventory';
import { Notifier } from './modules/notifier';
import { ImageProcessor } from './modules/images';
import { OrdersService } from './modules/orders';
import { ReturnsService } from './modules/returns';
import { log } from './common/http';

/** Same codebase as the API; runs the BullMQ processors and the periodic jobs. */
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const inv = app.get(InventoryService), notifier = app.get(Notifier), images = app.get(ImageProcessor), orders = app.get(OrdersService), returns = app.get(ReturnsService);

  const worker = new Worker(QUEUE_NAME, async (job) => {
    switch (job.name) {
      case 'release-reservation': return inv.expireOrder(job.data.orderId);
      case 'process-image': return images.process(job.data.imageId);
      case 'notify': return notifier.send(job.data.userId, job.data.type, job.data.payload);
      case 'sweep-expired': return inv.sweepExpired();
      case 'settle': return orders.settleDue();
      case 'return-sla': return returns.slaSweep();
      case 'vendor-score': return returns.scoreVendors();
      default: throw new Error(`unknown job ${job.name}`);
    }
  }, { connection: makeRedis(), concurrency: 10 });
  worker.on('failed', (j, e) => log.error({ job: j?.name, err: e.message }, 'job failed'));
  worker.on('completed', (j) => log.debug({ job: j.name }, 'job done'));

  const q = new Queue(QUEUE_NAME, { connection: makeRedis() });
  const every = (ms: number) => ({ repeat: { every: ms } });
  await q.add('sweep-expired', {}, { ...every(60_000), jobId: 'sweep-expired' });
  await q.add('settle', {}, { ...every(3600_000), jobId: 'settle' });
  await q.add('return-sla', {}, { ...every(3600_000), jobId: 'return-sla' });
  await q.add('vendor-score', {}, { ...every(86400_000), jobId: 'vendor-score' });
  log.info('worker started');
  const stop = async () => { await worker.close(); await app.close(); process.exit(0); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
main();
