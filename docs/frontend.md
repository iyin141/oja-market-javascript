# Frontend (apps/web)

Next 16 (App Router) + React 19 + Tailwind v4. Tokens live in `apps/web/styles/theme.css` (extracted from the Stitch `DESIGN.md`); no raw Stitch markup ships.

## Structure

| Path | Purpose |
|---|---|
| `components/ui.tsx` | `Icon`, `StarRating`, `PriceBlock`, `StatusChip`, `StatTile`, `DataTable`, `Timeline`, `ProductTile`, `VendorGroup`, `Notice`, `PageTitle`, button/input classes |
| `components/interactive.tsx` | client components: `QtyStepper`, `Tabs`, `ConfirmDialog` (native `<dialog>`), `BuyBox` |
| `components/Masthead.tsx`, `Shell.tsx` | header with live cart badge and session state, footer, page chrome |
| `components/CartView.tsx`, `CheckoutFlow.tsx` | real cart (quantity, remove with confirm) and 3-step checkout (address, payment, review) |
| `components/OrderViews.tsx`, `SellerViews.tsx`, `AdminViews.tsx`, `AuthForms.tsx` | screens that need the signed-in user |
| `lib/api.ts` | typed client, `NEXT_PUBLIC_API_URL` (default `http://localhost:4100`), fixture fallback via `api()`, strict mutations via `apiStrict()` |
| `lib/fixtures.ts` | sample data used when the API is unreachable (an amber banner says so) |
| `lib/money.ts` | kobo strings to naira text using bigint, never floats |
| `lib/session.ts`, `lib/cart.ts`, `lib/useApi.ts` | session (access token in sessionStorage, refresh cookie httpOnly), localStorage cart, authenticated fetch hook |

Brand: every "Marketly" is now "Oja Market". Currency is NGN, not USD as in the mockups.

## Routes

`/`, `/search`, `/p/[slug]`, `/store/[vendor]`, `/cart`, `/checkout`, `/orders`, `/orders/[id]`, `/login`, `/register` (`?vendor=1` for vendor application), `/pay/fake` (dev stand-in for the hosted payment page), `/seller` (+ `/products`, `/orders`, `/payouts`, `/onboarding`), `/admin` (+ `/vendors`, `/disputes`).

## Behaviour notes

- Cart is stored in the browser; checkout sends it with `PUT /cart`, then `POST /checkout` with an `Idempotency-Key` that is generated once per checkout screen, so a double click or retry returns the same order.
- Prices on screen are informational: the API recomputes them in the checkout transaction.
- Signed-out visitors see fixture data on `/orders`, `/seller`, `/admin`; signed-in users get live data and a banner if the API is down.

## Mockups that did not exist (designed from the same tokens)

`/login`, `/register`, vendor onboarding (`/seller/onboarding`), `/store/[vendor]`, `/orders/[id]` timeline and return request, `/seller/products` inline editing, `/seller/payouts`, `/admin/vendors`, `/admin/disputes`, `/pay/fake`, and all mobile-specific layouts (M01-M04). Layouts are responsive via Tailwind breakpoints but no dedicated mobile designs were made.

## Not done or known gaps

- The mockup pages were rebuilt in simplified form, not pixel-matched: the hero carousel, quick-filter chips, brand/condition facets and the vendor spotlight on search are omitted. Search facets are displayed but not yet clickable filters (sort works).
- No product creation form or image upload UI for vendors (API supports it); onboarding KYC upload is implemented.
- Order status updates poll on load only; the SSE endpoint `/orders/stream` is not consumed yet.
- Reviews are described but there is no review form.
- No Playwright test; the build and a smoke fetch of the main routes were the only checks.
- The browser PUT to object storage needs the SeaweedFS CORS rules from the storage spike to be in place.
