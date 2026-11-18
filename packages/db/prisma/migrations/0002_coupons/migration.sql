CREATE TYPE "CouponKind" AS ENUM ('PERCENT', 'FIXED');
CREATE TABLE "coupons" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" TEXT NOT NULL,
  "kind" "CouponKind" NOT NULL,
  "value" BIGINT NOT NULL,
  "min_subtotal_kobo" BIGINT NOT NULL DEFAULT 0,
  "max_uses" INTEGER,
  "used_count" INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMP(3),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");
ALTER TABLE "orders" ADD COLUMN "coupon_code" TEXT, ADD COLUMN "discount_kobo" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "sub_orders" ADD COLUMN "discount_kobo" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "vendor_profiles" ADD COLUMN "stripe_account_id" TEXT;
GRANT SELECT, INSERT, UPDATE, DELETE ON "coupons" TO oja_app;
