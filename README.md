# Oja Market (JavaScript / TypeScript)

Multi-vendor marketplace. NestJS + Prisma + PostgreSQL API, BullMQ worker, Redis, S3-compatible storage (SeaweedFS), Elasticsearch search, Next.js 16 storefront.
The Go rewrite of the same product lives next to it in `go/oja-market`.

## Run it

```bash
pnpm install
cp .env.example .env
make infra          # postgres, redis, seaweedfs, elasticsearch, mailpit
make migrate seed   # schema + 3 vendors, 40 products, coupons WELCOME10 and FLAT5000
pnpm --filter @oja/api dev       # API on :4100, Swagger at /docs
pnpm --filter @oja/web dev       # storefront on :3100
```

`make up` runs the whole stack in containers instead. Mail goes to Mailpit (http://localhost:8125).

Demo logins (password `Passw0rd!demo`): `customer@oja.test`, `vendor1@oja.test` .. `vendor3@oja.test`, `admin@oja.test`.
Payments default to a fake provider (a signed webhook is delivered to the API for you), so no gateway account is needed.

## Requirements checklist (internship brief FS-03 #1)

| # | Requirement | Where | Status |
|---|---|---|---|
| 1 | Roles (customer, vendor, admin), DB schema, API list | `packages/db/prisma/schema.prisma`, `docs/architecture.md`, Swagger `/docs` | Done |
| 2 | JWT auth with role-based access | `modules/auth.ts`, `common/auth.ts`; RBAC matrix test (29 routes) | Done |
| 3 | Vendor onboarding, product CRUD, image upload to S3 | `modules/vendors.ts`, `catalog.ts`, `images.ts` (presigned PUT, magic-byte check, sharp resize) | Done |
| 4 | Search with filters and sorting through Elasticsearch | `modules/search-es.ts` (index + query, facets, fuzzy, prefix). Falls back to Postgres full-text if `ELASTICSEARCH_URL` is empty or ES is down | Code and unit tests done; see note 1 |
| 5 | Cart, checkout, order lifecycle (placed, packed, shipped, delivered), Redis for cart/session caching | `cart.ts`, `checkout.ts`, `orders.ts`. Redis: read-through cart cache (30 s, dropped on every cart write and on checkout), `/me` session-profile cache (60 s), plus rate limiting, BullMQ jobs and SSE pub/sub | Done; see note 2 |
| 6 | Stripe Connect (or Razorpay) test mode for split payments and commissions | `packages/payment-provider` `StripeProvider` (Checkout Session, signed webhook, Express connected accounts, transfers at payout). Paystack and a fake provider sit behind the same port | Code and unit tests done; not run against Stripe, see note 3 |
| 7a | Reviews | `returns.ts` `ReviewsService`: verified buyers only, one per product, rating aggregate | Done |
| 7b | Coupons | `modules/coupons.ts`: percent or fixed, minimum spend, expiry, max uses (atomic), vendor-funded pro rata so ledger and refunds stay consistent | Done |
| 7c | PDF invoices | `modules/invoices.ts`: `GET /orders/:id/invoice`, dependency-free PDF writer | Done |
| 7d | Admin analytics page | `GET /admin/analytics`, `/admin/analytics` page with Chart.js (GMV and orders per day, top vendors, top products, coupon cost) | Done |
| 7e | Deploy front end and back end separately | Web is a standalone Next app that only talks to the API over HTTPS (`NEXT_PUBLIC_API_URL`); API, worker and web have separate Dockerfiles and compose services. `DEPLOYMENT.md` at the repo root describes the VM deployment | Done |

Notes
1. Elasticsearch was not started in the build environment (Docker Hub and the Elastic registry were unreachable from it), so the ES query path is not exercised by the test suite; the Postgres fallback is. Run `make infra`, then `curl -XPOST localhost:4100/search/reindex -H "Authorization: Bearer <admin token>"` and `GET /search?q=power` returns `"engine": "elasticsearch"`.
2. Postgres stays the source of truth for the cart (checkout re-prices from it, and it must survive a Redis flush); Redis caches the priced view. Prices or flash sales changed outside the API show in the cart view after at most 30 s; checkout is never affected.
3. Set `PAYMENT_PROVIDER=stripe`, `STRIPE_SECRET_KEY=sk_test_...`, `STRIPE_WEBHOOK_SECRET=whsec_...`, then point a Stripe CLI listener at `POST /payments/webhook`. Vendors call `POST /vendors/me/stripe/onboard` to connect an account. The provider refuses live keys. Webhook fee is reported as 0 (the real fee is on the balance transaction).

## Tests

```bash
pnpm test                         # shared 9, payment-provider 5, api integration 31 (real Postgres, Redis)
node tests/e2e/api-flow.mjs       # live 17-check flow against a running API
```

Results and measurements: `docs/test-results.md`. Architecture and sequence diagrams: `docs/architecture.md`. Frontend notes: `docs/frontend.md`.

## Layout

```
apps/api      NestJS API + worker (src/modules/*)
apps/web      Next.js 16 storefront, seller console, admin console
packages/db   Prisma schema, migrations, seed
packages/shared, packages/payment-provider
infra         docker compose (+ observability and k6 profiles)
```
