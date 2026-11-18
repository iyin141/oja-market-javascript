# Frontend (apps/web)

Next 16 (App Router) + React 19 + Tailwind v4. Tokens live in `apps/web/styles/theme.css` (extracted from the Stitch `DESIGN.md`); no raw Stitch markup ships.

## Structure

| Path | Purpose |
|---|---|
| `components/ui.tsx` | `Icon`, `StarRating`, `PriceBlock`, `StatusChip`, `StatTile`, `DataTable`, `Timeline`, `ProductTile`, `VendorGroup`, `Notice`, `PageTitle`, button/input classes |
| `components/interactive.tsx` | client components: `QtyStepper`, `Tabs`, `ConfirmDialog` (native `<dialog>`), `BuyBox` |
| `components/Masthead.tsx`, `Shell.tsx` | header with live cart badge and session state, footer, page chrome |
| `components/CartView.tsx`, `CheckoutFlow.tsx` | real cart (quantity, remove with confirm) and 3-step checkout (address, payment, review) |
| `components/OrderViews.tsx`, `SellerViews.tsx`, `AdminViews.tsx`, `AuthForms.tsx` | screens that need the signed-in user (orders and the payment return, seller console, admin console, login / register / forgot / reset) |
| `components/RoleGuard.tsx`, `lib/useAuth.ts` | role guard used by the `seller`, `admin` and `agent` layouts: signed out goes to `/login?next=<path>`, a wrong role gets a not-allowed screen |
| `components/Reviews.tsx`, `ReturnsViews.tsx`, `AgentViews.tsx`, `AdminTools.tsx`, `FakePay.tsx` | reviews tab, vendor returns, delivery agent form, admin tools (vendor suspend, coupons, commission rules, audit log), dev-only fake payment |
| `lib/env.ts` | build-time switches: `USE_FIXTURES`, media base URL |
| `lib/api.ts` | typed client, `NEXT_PUBLIC_API_URL` (default `http://localhost:4100`, a production build without it prints a warning), `notFound()` on a 404, strict mutations via `apiStrict()` |
| `lib/fixtures.ts` | sample data, used only when the web app is built with `NEXT_PUBLIC_USE_FIXTURES=1` (an amber banner says so); otherwise empty values and honest error states |
| `lib/money.ts` | kobo strings to naira text using bigint, never floats |
| `lib/session.ts`, `lib/cart.ts`, `lib/useApi.ts` | session (access token in sessionStorage, refresh cookie httpOnly), localStorage cart, authenticated fetch hook |

Brand: every "Marketly" is now "Oja Market". Currency is NGN, not USD as in the mockups.

## Routes

`/`, `/search` (category, vendor, price and in-stock filters), `/p/[slug]` (with reviews), `/store/[vendor]`, `/cart`, `/checkout` (saved addresses), `/orders` (also the payment return: `?reference=`), `/orders/[id]`, `/login`, `/register` (`?vendor=1` for vendor application), `/forgot-password`, `/reset-password`, `/pay/fake` (only with the fake provider or the fixtures flag), `/seller` (+ `/products` with image upload, `/orders`, `/payouts` with bank details, `/returns`, `/onboarding`), `/admin` (+ `/vendors`, `/products` review, `/disputes`, `/analytics`, `/tools`; the overview has the run-payouts button), `/agent` (mark a shipment delivered).

## Behaviour notes

- Cart is stored in the browser; checkout sends it with `PUT /cart`, then `POST /checkout` with an `Idempotency-Key` that is generated once per checkout screen, so a double click or retry returns the same order.
- Prices on screen are informational: the API recomputes them in the checkout transaction.
- No fixture data in production. `/p/<unknown>` and `/orders/<unknown>` show not-found, signed-out visitors are sent to the login page, and a failed API call shows an error banner, not sample data. Fixtures are an opt-in demo mode (`NEXT_PUBLIC_USE_FIXTURES=1`).
- `/orders?reference=` verifies the payment with `POST /payments/paystack/verify` and shows paid, pending (with "Check again") or failed.
- A new vendor product starts as a draft; "Submit for review" puts it in review, and it goes live when an admin approves it on `/admin/products`.
- Product images: the seller console asks for a presigned URL, uploads the file straight to storage with a progress bar, then confirms. Thumbnails need `NEXT_PUBLIC_MEDIA_BASE_URL` (the public bucket URL) at build time.

## Mockups that did not exist (designed from the same tokens)

`/login`, `/register`, vendor onboarding (`/seller/onboarding`), `/store/[vendor]`, `/orders/[id]` timeline and return request, `/seller/products` inline editing, `/seller/payouts`, `/admin/vendors`, `/admin/disputes`, `/pay/fake`, and all mobile-specific layouts (M01-M04). Layouts are responsive via Tailwind breakpoints but no dedicated mobile designs were made.

## Not done or known gaps

- The mockup pages were rebuilt in simplified form, not pixel-matched: the hero carousel, quick-filter chips, brand/condition facets and the vendor spotlight on search are omitted.
- The delivery agent screen is a form that takes a shipment id (plus a cash-collected box). The API has `GET /agent/sub-orders`, but the screen does not list them yet.
- The flash-sales admin tool is not built (the API has create and a public list, but no admin list or delete).
- Store pages cannot tell "no such vendor" from "no products" (no vendor-by-slug endpoint), so they show a combined message.
- The orders page does not poll; a pending payment shows a "Check again" button. The SSE endpoint `/orders/stream` is not consumed.
- A suspended or unapproved vendor still reaches the seller console; API 403s show the generic load-failed banner.
- Reviews have no title field (the table has none).
- No Playwright test; the type-check and a smoke fetch of the main routes were the only checks. Everything behind a login (role guards, seller and admin pages, reviews, returns, agent delivery, saved addresses), the Paystack round trip and browser uploads through the domain are untested.
