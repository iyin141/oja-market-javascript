import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email().max(254).transform((s) => s.toLowerCase()),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(100),
});
export const loginSchema = z.object({
  email: z.string().email().transform((s) => s.toLowerCase()),
  password: z.string().min(1).max(128),
});
export const kobo = z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).transform((v) => BigInt(v));
export const productCreateSchema = z.object({
  title: z.string().min(2).max(200),
  description: z.string().max(5000).default(''),
  categoryId: z.string().uuid(),
  variants: z.array(z.object({
    sku: z.string().min(1).max(64), name: z.string().max(100).default('Default'),
    priceKobo: kobo, stock: z.number().int().min(0).max(1_000_000).default(0),
  })).min(1).max(50),
});
export const checkoutSchema = z.object({
  paymentMethod: z.enum(['CARD', 'COD']).default('CARD'),
  address: z.object({ line1: z.string().min(3), city: z.string().min(2), state: z.string().min(2), phone: z.string().min(7) }).optional(),
});
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const presignSchema = z.object({
  contentType: z.enum(IMAGE_TYPES), size: z.number().int().positive().max(MAX_IMAGE_BYTES), filename: z.string().max(200),
});
