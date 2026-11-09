import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand, CreateBucketCommand, HeadBucketCommand, PutBucketCorsCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config';

/** Storage port: only S3-compatible calls, endpoint chosen by env (SeaweedFS / R2 / Garage). */
export interface Storage {
  presignPut(bucket: string, key: string, contentType: string, size: number, ttlSec?: number): Promise<string>;
  presignGet(bucket: string, key: string, ttlSec?: number): Promise<string>;
  head(bucket: string, key: string): Promise<{ size: number; contentType?: string } | null>;
  getBytes(bucket: string, key: string): Promise<Buffer>;
  putBytes(bucket: string, key: string, body: Buffer, contentType: string): Promise<void>;
  remove(bucket: string, key: string): Promise<void>;
  ensureBuckets(): Promise<void>;
}

export class S3Storage implements Storage {
  readonly client = new S3Client({
    endpoint: config.s3.endpoint, region: config.s3.region, forcePathStyle: config.s3.forcePathStyle,
    credentials: { accessKeyId: config.s3.accessKey, secretAccessKey: config.s3.secretKey },
  });
  /** Presigned PUT is bound to content-type and content-length, expires in 5 min by default. */
  presignPut(bucket: string, key: string, contentType: string, size: number, ttlSec = 300) {
    return getSignedUrl(this.client, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType, ContentLength: size }), { expiresIn: ttlSec });
  }
  presignGet(bucket: string, key: string, ttlSec = 300) {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: ttlSec });
  }
  async head(bucket: string, key: string) {
    try {
      const r = await this.client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return { size: Number(r.ContentLength ?? 0), contentType: r.ContentType };
    } catch { return null; }
  }
  async getBytes(bucket: string, key: string) {
    const r = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
  async putBytes(bucket: string, key: string, body: Buffer, contentType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
  }
  async remove(bucket: string, key: string) { await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })); }
  async ensureBuckets() {
    for (const Bucket of [config.s3.publicBucket, config.s3.privateBucket]) {
      try { await this.client.send(new HeadBucketCommand({ Bucket })); } catch { await this.client.send(new CreateBucketCommand({ Bucket })); }
    }
    try {
      await this.client.send(new PutBucketCorsCommand({
        Bucket: config.s3.publicBucket,
        CORSConfiguration: { CORSRules: [{ AllowedOrigins: [config.webOrigin], AllowedMethods: ['PUT', 'GET', 'HEAD'], AllowedHeaders: ['*'], ExposeHeaders: ['ETag'], MaxAgeSeconds: 300 }] },
      }));
    } catch { /* CORS API optional on some providers; see docs/spikes.md */ }
  }
}

/** In-memory fake for unit tests. */
export class FakeStorage implements Storage {
  objects = new Map<string, { body: Buffer; contentType: string }>();
  async presignPut(b: string, k: string) { return `fake://put/${b}/${k}`; }
  async presignGet(b: string, k: string) { return `fake://get/${b}/${k}`; }
  async head(b: string, k: string) { const o = this.objects.get(`${b}/${k}`); return o ? { size: o.body.length, contentType: o.contentType } : null; }
  async getBytes(b: string, k: string) { return this.objects.get(`${b}/${k}`)!.body; }
  async putBytes(b: string, k: string, body: Buffer, contentType: string) { this.objects.set(`${b}/${k}`, { body, contentType }); }
  async remove(b: string, k: string) { this.objects.delete(`${b}/${k}`); }
  async ensureBuckets() {}
}
