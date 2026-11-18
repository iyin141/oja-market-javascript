# Test results (measured, local)

Environment: Windows 11, Docker Desktop. Postgres 16, Redis 7, SeaweedFS and Mailpit in containers (compose project `oja`); API, worker and web run on the host with Node 24. Seed: 3 vendors, 40 products. Figures are single runs on one machine, not benchmarks.

## Automated (all pass)

| Suite | Result |
|---|---|
| `@oja/shared` unit | 9 / 9 |
| `@oja/payment-provider` unit (Paystack, fake, Stripe signature + replay window) | 5 / 5 |
| `@oja/api` integration (jest, real Postgres and Redis) | 31 / 31 |

Added in the second pass: coupons (pro-rata net commission, 1 NGN floor, minimum spend, expiry, max-uses race: 6 parallel checkouts on a 2-use coupon gave exactly 2), PDF invoice (owner 200, other customer 404, admin 200), admin analytics (gap-free day series, admin only), Redis cart and `/me` cache (hit, tamper-proof read path, invalidation on write and checkout).

Selected measurements from the API suite:

| Test | Measured |
|---|---|
| Oversell: 200 concurrent checkouts, stock 50 | 50 succeeded, 150 rejected (409), `reserved=50 on_hand=50`, about 1.8 to 2.2 s |
| Same signed webhook replayed 20x concurrently | 1 `posted`, 19 `duplicate`; 1 payment row, 1 ledger set |
| RBAC matrix | 29 routes, 108 denials as expected, 37 allowed callers reached the handler, 0 unauthorised successes |
| Ledger | debits equal credits after payment, delivery, dispute, refund and SLA scenarios |

## Live flow (`node tests/e2e/api-flow.mjs`, API on :4100, 17 / 17 checks pass)

Login (customer, two vendors, admin), search, cart, checkout (201), idempotent retry returns the same order, missing Idempotency-Key gives 400, signed payment webhook posted, replay is a no-op, one order with 2 sub-orders both PAID, both vendors ship their own sub-order, customer confirms delivery, vendor balance shows pending funds, admin ledger check balanced (`unbalancedGroups: 0`).

## Browser flow (manual, Chrome against :3100)

Search page (live data and facets), product page, add to cart (badge updates), sign in, 3-step checkout, fake payment page, order page showing "Paid" with the timeline. No console errors on the search page.

## Not done / not measured

- Elasticsearch and Stripe: code and unit tests only. The ES container and Stripe test keys were not available in the build environment, so neither path ran end to end.
- SeaweedFS storage spike (presigned PUT with CORS, multipart, ranged GET) was not run.
- No k6 latency runs (checkout, search p95), no payout-run test at 200 vendors, no reservation-expiry timing test, no Grafana.
- The web app was not run through Playwright; the browser flow above was driven by hand.
- Mockup fidelity: pages are rebuilds on shared components, not pixel matches (see `frontend.md`).
- The Material Symbols icon font loads from Google Fonts; on a slow first load icons briefly show as text.
