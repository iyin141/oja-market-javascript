import { Inject, Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { Prisma_ } from '../infra/prisma';
import { Storage } from '../infra/storage';
import { STORAGE } from '../tokens';
import { config } from '../config';

/** Worker-side: re-encode to WebP (drops EXIF/polyglot payloads), make 1200px + 320px, delete the raw upload. */
@Injectable()
export class ImageProcessor {
  constructor(private db: Prisma_, @Inject(STORAGE) private storage: Storage) {}
  async process(imageId: string) {
    const img = await this.db.productImage.findUnique({ where: { id: imageId } });
    if (!img || img.status === 'READY') return;
    const bucket = config.s3.publicBucket;
    try {
      const raw = await this.storage.getBytes(bucket, img.key);
      const meta = await sharp(raw, { limitInputPixels: 50_000_000 }).metadata();
      if (!meta.format || !['jpeg', 'png', 'webp'].includes(meta.format)) throw new Error(`unsupported format ${meta.format}`);
      const base = img.key.replace('raw/', 'products/');
      const big = await sharp(raw).rotate().resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
      const thumb = await sharp(raw).rotate().resize({ width: 320, height: 320, fit: 'cover' }).webp({ quality: 78 }).toBuffer();
      await this.storage.putBytes(bucket, `${base}-1200.webp`, big, 'image/webp');
      await this.storage.putBytes(bucket, `${base}-320.webp`, thumb, 'image/webp');
      await this.storage.remove(bucket, img.key);
      await this.db.productImage.update({ where: { id: imageId }, data: { status: 'READY' } });
    } catch {
      await this.db.productImage.update({ where: { id: imageId }, data: { status: 'REJECTED' } });
    }
  }
}
