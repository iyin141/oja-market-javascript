# Oja Market: technology, system architecture and phase-by-phase execution plan

(Source: user-supplied 03-execution-marketplace.md. Build in the order of section 8. Each phase has exit criteria; do not start the next phase until they pass.)

## 1. Locked decisions

| Area | Decision |
|---|---|
| Shape | Modular monolith plus background worker |
| Frontend | Next.js (App Router) + TypeScript + Tailwind, deployed outside the container stack; talks to API over HTTPS only |
| API | NestJS + TypeScript, REST + OpenAPI (Swagger) |
| Database | PostgreSQL 16 + Prisma |
| Queue/cache | Redis 7 + BullMQ (delayed jobs for reservation expiry; rate limits) |
| Object storage | S3-compatible API, provider by env. Local/VPS: SeaweedFS container (S3 on 8333). Free hosted: Cloudflare R2. Fallback: Garage. MinIO is NOT to be used (archived 25 Apr 2026) |
| Payments | Paystack test mode behind a `PaymentProvider` interface (+ FakeProvider) |
| Search | Postgres full-text + `pg_trgm` |
| Images | `sharp` in the worker |
| Email | Mailpit locally; SMTP by env in prod |
| Observability | `pino` JSON logs, `/metrics` Prometheus, Grafana (profile `obs`) |
| Tests | Jest/Vitest, Supertest, Testcontainers, Playwright, k6 |
| CI | GitHub Actions: lint, test, build images, push to GHCR |

## 2. Object storage

Code rule: use `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` with `S3_ENDPOINT`, `S3_REGION`, `S3_FORCE_PATH_STYLE`. Never import anything vendor-specific. R2: presigned URLs only on the S3 endpoint, configure CORS.
Phase 0 spike (mandatory): prove on SeaweedFS presigned PUT from a browser (CORS), presigned GET, multipart upload, ranged GET. If any fails, switch to Garage.

## 3. Architecture

Containers: gateway (Caddy: TLS, routing, CORS, rate limit) -> api (NestJS) ; worker (BullMQ processors); postgres 16; redis 7; seaweedfs; mailpit; migrate (one-shot); prometheus+grafana (profile obs); k6 (profile perf). Paystack test mode webhook -> gateway -> api.

Checkout flow: POST /checkout (Idempotency-Key) -> TX: `UPDATE inventory SET reserved=reserved+n WHERE on_hand-reserved>=n`; insert order + sub_orders (one per vendor) PENDING_PAYMENT with commission rate snapshot; commit; enqueue delayed `release-reservation` (15 min); initialize Paystack tx (reference = order id); return authorization_url. Webhook charge.success (signed): insert payment_events (event_id UNIQUE); first delivery -> TX mark paid, inventory commit, ledger entries per sub-order, enqueue notify vendors/emails; duplicate -> 200 no-op.

Order state machine: PENDING_PAYMENT -> PAID (webhook) | EXPIRED (timeout) | AWAITING_COLLECTION (pay on delivery); PAID/AWAITING_COLLECTION -> PACKED -> SHIPPED -> DELIVERED -> RETURN_REQUESTED (within 7 days) -> REFUNDED | DELIVERED (vendor wins dispute); DELIVERED -> SETTLED (hold period ends); PAID/PACKED -> CANCELLED. Order status derived from sub-orders; each sub-order owns its state, shipment, money.

## 4. Data model

Entities: USER, VENDOR_PROFILE, ADDRESS, CATEGORY, PRODUCT, VARIANT, INVENTORY, CART, CART_ITEM, ORDER, SUB_ORDER, ORDER_ITEM, PAYMENT, PAYMENT_EVENT, LEDGER_ENTRY, PAYOUT, RETURN_REQUEST, REVIEW, COMMISSION_RULE (per category).

Rules the schema must enforce:
1. Money is integer kobo, BIGINT, `Money` helper, no floats.
2. Commission snapshot: `sub_orders.commission_bps` and `commission_kobo` written at purchase; later rule changes never rewrite history.
3. Append-only ledger `ledger_entries(id, sub_order_id, account, direction, amount_kobo, created_at, ref)`. No UPDATE/DELETE grants for app role. Balances from views.
4. Idempotency: `payment_events.event_id UNIQUE`; `checkout_requests.idempotency_key UNIQUE`.
5. Inventory `CHECK (reserved >= 0 AND on_hand - reserved >= 0)`.
6. `reservations(id, order_id, variant_id, qty, expires_at, status)`.

Ledger postings per sub-order on payment: Dr gateway_clearing gross; Cr vendor_payable:{vendor} gross-commission; Cr platform_commission commission; Dr processing_fees fee; Cr gateway_clearing fee. Delivered + 7 days: SETTLED, vendor-payable pending -> available (status on entry, not an edit). Payout: Dr vendor_payable, Cr payout_clearing. Refund: reverse postings proportionally. Invariant: debits = credits per sub-order and globally; admin screen shows check. COD posts nothing until agent reports cash collected; COD limit NGN 150,000/order; exclude flagged vendors.

## 5. Modules and API surface

- auth: POST /auth/register,/login,/refresh,/logout; argon2id; 15 min access JWT; rotating refresh in httpOnly cookie; Redis rate limit
- users: GET/PATCH /me, /me/addresses
- vendors: POST /vendors/apply, PATCH /vendors/me/kyc, admin POST /admin/vendors/:id/approve|reject; presigned KYC upload
- catalog: GET /products, /products/:id, vendor POST/PATCH /vendor/products, POST /vendor/products/:id/images/presign; draft->review->active; inline price/qty edit
- search: GET /search?q=&filters (tsvector+trigram, facets)
- inventory: internal reserve/commit/release; GET /vendor/inventory/low-stock
- cart: GET/PUT /cart, POST /cart/items; grouped by vendor; price-change flags
- checkout: POST /checkout (Idempotency-Key required)
- orders: GET /orders, /orders/:id, vendor GET /vendor/orders, POST /vendor/orders/:id/ship, POST /orders/:id/events; SSE /orders/stream
- payments: POST /payments/webhook (signature verified), POST /payments/:id/verify
- ledger: GET /vendor/balance, /vendor/transactions, admin GET /admin/ledger/check
- payouts: admin POST /admin/payouts/run (idempotent), vendor GET /vendor/payouts
- returns: POST /orders/:id/returns, vendor POST /vendor/returns/:id/respond, admin POST /admin/disputes/:id/decide; 48h vendor SLA job
- reviews: POST /products/:id/reviews (verified purchase)
- promotions: GET /flash-sales, admin CRUD
- admin: KPIs, GET/PUT /admin/commission-rules (affect only new orders)
- notifications: worker-driven email + in-app
Cross-cutting: validation on every DTO, RFC 7807 problem responses, correlation IDs, OpenAPI at /docs.

## 6. Repo layout

```
oja-market/
  apps/api (NestJS api+worker)  apps/web (Next.js)
  packages/db (prisma schema, migrations, seed)  packages/shared (Money, DTOs, zod)  packages/payment-provider (interface + Paystack + FakeProvider)
  infra/ compose.yml compose.obs.yml compose.perf.yml caddy/Caddyfile seaweedfs/s3.json
  tests/e2e (Playwright) tests/perf (k6)  docs/  .github/workflows/  Makefile  README.md
```
Compose services: gateway caddy:2; api; worker (same image, `node dist/worker.js`); migrate (`prisma migrate deploy`); postgres:16-alpine; redis:7-alpine (AOF); seaweedfs; mailpit; prometheus+grafana (obs); k6 (perf). Multi-stage Dockerfiles, non-root, .dockerignore, healthchecks, depends_on service_healthy, one .env.example, make up/seed/test/perf.
Env minimum: DATABASE_URL, REDIS_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET_PUBLIC, S3_BUCKET_PRIVATE, S3_FORCE_PATH_STYLE, PAYSTACK_SECRET_KEY, PAYSTACK_WEBHOOK_SECRET, PAYMENT_PROVIDER=paystack|fake, SMTP_URL, WEB_ORIGIN, COD_LIMIT_KOBO=15000000, RESERVATION_TTL_MIN=15, SETTLEMENT_HOLD_DAYS=7.

## 7. Frontend mapping

Export Stitch screens, extract tokens to Tailwind, rebuild as React components (do not ship raw Stitch markup).
Routes: `/` S02 (/flash-sales, /products); `/search` S03; `/p/[slug]` S04; `/store/[vendor]` S05; `/cart` S06; `/checkout` S07; `/orders`, `/orders/[id]` S08-S11 (SSE); `/seller/*` V01-V09; `/admin/*` A01-A04.
Component library: Masthead, ProductTile, PriceBlock, StarRating, BuyBox, VendorGroup, StatusChip, DataTable, InlineEditCell, Timeline, StatTile, ConfirmDialog.

## 8. Phases (14 days)

- **P0 Foundations/spikes:** monorepo, lint, prettier, commit convention, CI skeleton, Makefile; compose with postgres, redis, seaweedfs, mailpit, gateway, api health; storage spike; Paystack spike (default: own ledger). Exit: `make up` green health; `docs/spikes.md`.
- **P1 Schema/auth/RBAC:** Prisma schema, migrations, seed (3 vendors, 40 products, categories, commission rules); auth flows, `@Roles` guards, refresh rotation, rate limits. Tests: auth unit+e2e, RBAC matrix. Exit: OpenAPI shows auth and /me; seed runs in CI.
- **P2 Vendors/catalog/media:** vendor apply+KYC (presigned), admin approve/reject, product CRUD, variants, image presign + sharp worker, draft->review->active. FE: tokens, component library, S01,S02,S05, V01, A02. Tests: vendor state machine, upload happy path, rejected types/sizes. Exit: vendor onboarded, approved, lists product with images e2e.
- **P3 Search/cart/inventory:** tsvector+trigram search with facets, cart grouped by vendor, inventory reserve/commit/release, low-stock, flash-sale window. FE: S03,S04,S06,V05,V06. Tests: inventory unit; concurrency test. Exit: 200 parallel reservations on 50 units => exactly 50 successes.
- **P4 Checkout/orders:** /checkout idempotent, TX order+sub_orders, commission snapshot, reservation delayed job, order SSE, vendor ship, state machine guard tests. FE: S07-S10, V03,V04. Exit: two-vendor cart => one order, two sub-orders; expiry releases stock.
- **P5 Payments/ledger/payouts/COD:** provider interface (Paystack + FakeProvider), signed webhook, payment_events dedupe, ledger postings, vendor balance views, settlement job, idempotent payout run, COD collect. FE: V07, A03. Tests: duplicate webhook x20 => one posting; tampered signature rejected; ledger invariant property test; refund reversal.
- **P6 Returns/disputes/reviews/health score:** return request, 48h SLA timer, admin decision w/ ledger reversal, verified reviews, nightly vendor score job, auto-flag. FE: S11, V08, V09, A04, A01. Exit: disputed order moves vendor balance to on-hold and back.
- **P7 FE integration/polish:** wire all screens to live API, loading/empty states, error boundaries, mobile M01-M04, Playwright happy path (browse, cart, checkout w/ FakeProvider, vendor ships, customer sees delivered).
- **P8 Hardening/perf:** security checklist, indexes from EXPLAIN, pooling, caching, k6 scenarios, Grafana. Exit: metrics in docs/test-results.md.
- **P9 Docs/evidence:** README with 5-command setup, architecture doc (Mermaid), OpenAPI docs, ERD, test results, limitations.
- **P10 Demo.**

## 9. Test plan (report actual measured numbers with hardware and dataset size)

Oversell (200 concurrent checkouts, stock 50 => exactly 50 succeed, 0 negative); webhook idempotency (20x concurrent => 1 payment row, 1 ledger set); ledger invariant property test; checkout p95 < 500 ms (50 VUs, 5 min, 5,000 products); search p95 < 200 ms; payout run 200 vendors twice => second no-op; reservation expiry within TTL+30 s; RBAC matrix 0 unauthorised successes; upload safety (MIME sniff, size cap, extension spoof => 4xx). Coverage goal 80% on inventory, ledger, payments, orders.

## 10. Security checklist

Verify webhook signature on raw body, constant-time compare; never trust client prices (recompute in checkout TX); per-route rate limits + lockout; presigned URLs expire in 5 min bound to content type/size; private bucket for KYC with short-lived signed GETs to admins; app DB role has no UPDATE/DELETE on ledger_entries and payment_events; secrets only in env, CI secret scan; CORS only WEB_ORIGIN, secure httpOnly SameSite cookies; structured audit log for approvals, rule changes, payouts, disputes.

## 12. Risks/fallbacks

SeaweedFS fails spike -> Garage or R2. Paystack split/transfer unavailable in test mode -> FakeProvider + own ledger. Time slips: cut Best Offer, flash-sale polish, reviews; never cut inventory, ledger, webhook idempotency, tests.

## 13. Rules for the coding agent

1. Read sections 1, 4, 8 before code; one phase at a time.
2. Each phase ends with passing tests and a conventional commit.
3. Never floating-point money. Never update/delete ledger rows.
4. Every external call (storage, payment, email) behind an interface with a fake for tests.
5. No new library without a one-line justification.
6. Keep docs/ current.
