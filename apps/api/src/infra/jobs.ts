import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import nodemailer from 'nodemailer';
import { config } from '../config';

/** Job port. Real impl = BullMQ; tests use RecordingJobs. */
export interface Jobs {
  releaseReservation(orderId: string, delayMs: number): Promise<void>;
  processImage(imageId: string): Promise<void>;
  notify(userId: string, type: string, payload: Record<string, unknown>): Promise<void>;
}
export interface Mailer { send(to: string, subject: string, text: string): Promise<void> }

export const QUEUE_NAME = 'oja';

export class BullJobs implements Jobs {
  readonly queue: Queue;
  constructor(conn: IORedis) {
    this.queue = new Queue(QUEUE_NAME, {
      connection: conn,
      defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 1000, attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
    });
  }
  async releaseReservation(orderId: string, delayMs: number) {
    // jobId makes enqueue idempotent per order.
    await this.queue.add('release-reservation', { orderId }, { delay: delayMs, jobId: `release-${orderId}` });
  }
  async processImage(imageId: string) { await this.queue.add('process-image', { imageId }, { jobId: `img-${imageId}` }); }
  async notify(userId: string, type: string, payload: Record<string, unknown>) { await this.queue.add('notify', { userId, type, payload }); }
}

export class RecordingJobs implements Jobs {
  calls: { name: string; args: unknown[] }[] = [];
  async releaseReservation(orderId: string, delayMs: number) { this.calls.push({ name: 'release', args: [orderId, delayMs] }); }
  async processImage(imageId: string) { this.calls.push({ name: 'image', args: [imageId] }); }
  async notify(userId: string, type: string, payload: Record<string, unknown>) { this.calls.push({ name: 'notify', args: [userId, type, payload] }); }
}

export class SmtpMailer implements Mailer {
  private t = nodemailer.createTransport(config.smtpUrl);
  async send(to: string, subject: string, text: string) { await this.t.sendMail({ from: 'Oja Market <no-reply@oja.local>', to, subject, text }); }
}
export class RecordingMailer implements Mailer {
  sent: { to: string; subject: string; text: string }[] = [];
  async send(to: string, subject: string, text: string) { this.sent.push({ to, subject, text }); }
}
