# SokoSoo

A working local farm-to-consumer marketplace built with Next.js, TypeScript, Django, and Django REST Framework, plus an Expo native driver client.

## Run locally (Windows PowerShell)

Requires Node.js 22.13+ and Python 3.12+. The checked-in lockfiles resolve the JavaScript dependency versions.

```powershell
npm ci
python -m venv .venv
& '.\.venv\Scripts\python.exe' -m pip install -r '.\backend\requirements.txt'
& '.\.venv\Scripts\python.exe' '.\backend\manage.py' migrate
& '.\.venv\Scripts\python.exe' '.\backend\manage.py' seed_demo
npm run dev:api
```

In another terminal:

```powershell
npm run dev
```

Open http://127.0.0.1:3010. Next.js proxies `/api/` to Django on port 8010, retaining Django's required trailing slashes.

### Project-specific ports

| SokoSoo service | Port |
|---|---|
| Next.js development/production server | 3010 |
| Django local API/admin | 8010 |
| Expo/Metro driver development server | 8090 |

These defaults were checked against running listeners and the other projects' startup/Compose configurations under `C:\Users\User\Projects`, including stopped KiotaSync containers. They avoid HarusiKit (3000/8000), KiotaSync (3001/8001), LocalLLM (3002), and NSE Cash Bot's existing allocations. Recheck availability if adding services later; ports cannot be permanently reserved by documentation.

Web session and CSRF cookies use SokoSoo-specific names because browsers share cookies across ports on the same host.

If port 8010 becomes occupied, choose a free port for Django and set `$env:SOKOSOO_DJANGO_URL = 'http://127.0.0.1:YOUR_PORT'` in the terminal running Next.js. This project-specific variable avoids inheriting another project's generic `DJANGO_URL`. If changing the web port, also update `CSRF_TRUSTED_ORIGINS`. Do not stop unrelated processes.

### Local demo accounts

| Username | Role |
|---|---|
| `consumer` | Buyer |
| `farmer` | Farmer: Wanjiku Family Farm |
| `farmer2` | Farmer: Green Valley Farm |
| `manager` | Manager for the two sample hubs |
| `driver` | Delivery driver |

All use the local-only password `SokoDemo2026!`. These are sample accounts, not production credentials. Demo seeding is disabled when `DJANGO_DEBUG=0` and does not reset existing users' passwords.

The sample delivery is explicitly marked `payment_status=demo`. It is not a paid order and cannot be dispatched. There are no fake payment-success buttons.

Create a separate administrator if needed:

```powershell
& '.\.venv\Scripts\python.exe' '.\backend\manage.py' createsuperuser
```

Django admin is at http://127.0.0.1:8010/admin/. Administrators assign privileged profile roles, hub managers, and order drivers. Financial/order state fields are read-only to avoid bypassing inventory rules.

## Implemented

- White, responsive storefront with the approved `#5C7952` brand color, self-hosted fonts, prominent header search, horizontal categories, and sample produce photography. No persistent consumer sidebar.
- Cookie/CSRF-protected web registration, login and logout. Public registration permits only consumer or farmer roles.
- Context-aware header search: produce/farm/location in Shop produce, request name/description/location in Requests & offers, and hub name/location in Shop by hub. Submit to search within the active tab; other pages search produce. Each tab's submitted term is retained independently in URL parameters (`q`, `requests_q`, `hubs_q`) for tab switching, refresh and browser back/forward. Request and hub matching runs on the API before result limits; request results show up to 100 matches.
- Produce categories appear only in Shop produce, with an announced selected state. Category, channel, hub, maximum price, radius and sorting are retained in URL parameters through refresh, product details and tab navigation. Named areas are URL-backed; precise GPS remains visit-local and must be chosen again after reload. A retained radius is not applied until a location is available.
- Full-page product details with quantity selection, a dedicated bag, and separate checkout views, addressable through Next.js query-string navigation with browser back/forward support.
- Visit-local favorites and a browser-persisted bag restored against current catalog stock. The bag groups items by farmer/channel/hub, with a separate checkout per pickup; other pickups remain in the bag.
- Server-calculated totals and idempotent unpaid checkout. The checkout key is retained with the bag across reloads; delivery addresses are not saved to browser storage.
- Account-menu access to orders, tracking and saved produce; role-specific farmer and hub workspaces, separated from shopping navigation. Mobile filters open in a focus-contained sheet.
- Independent loading/error/retry states for account, produce, hubs, requests, orders, farmer inventory and hub drops. A failed request never substitutes an empty business-data state. Server validation is associated with the submitted form's fields, with focus moved to the first invalid field.
- Keyboard-visible product-image focus, restored focus after drawer dismissal, semantic inventory tables, and layouts that wrap long product/farm names and large prices.
- Farmer listing coordinates can be filled from device GPS while at the farm, or entered manually; permission failures retain the manual option.
- Farm and hub inventory entries are distinct; hub entries remain hidden until the responsible manager confirms full receipt.
- Farmer inventory, listing creation, consumer requests, farmer bids, owner-only award acceptance and stock reservation.
- Unpaid order cancellation, visible 15-minute reservation deadlines/countdowns, request reopening after failed/expired awards, and order histories. Preview payment buttons are disabled with an explanation; the API still explicitly rejects unsupported initiation.
- Permission-checked driver assignments, ordered delivery transitions, timestamp-validated GPS ingestion, and customer tracking via 10-second polling with a map link and stale-location warning.
- Separate produce/delivery ratings after delivery.
- Install metadata and an offline fallback page. The PWA does not promise a full offline marketplace or background synchronization.
- Expo driver source with secure credential storage, assignments, navigation handoff, foreground/background permission flow, native location task, tracking health, and delivery transitions.

## Intentional first-slice boundaries

This is not a production-complete marketplace. The broader roadmap remains in [BUILD_PLAN.md](./BUILD_PLAN.md).

| Area | Current behavior / remaining work |
|---|---|
| Payments | Provider adapters, verified webhooks, reconciliation and refunds are **not implemented**. Payment initiation returns an explicit 503. Orders remain unpaid; no money is collected. Configure and implement approved M-Pesa/card providers before trading. |
| Delivery lifecycle | Drivers can advance only assigned orders with verified `succeeded` payment status. Until payment integration exists, end-to-end live dispatch cannot be exercised through the UI. API tests use isolated fixtures for these states. |
| Database | SQLite and bounded in-process Haversine distance filtering make local setup simple. Migrate to PostgreSQL/PostGIS and run real multi-connection concurrency tests before multi-user trading. SQLite row locks are not equivalent to PostgreSQL locks. |
| Checkout | One farmer and pickup origin per order; mixed-origin bags receive a clear validation error. Multi-seller purchase grouping and delivery fees are not implemented. |
| Hub inventory | Manager confirms a full drop. Partial acceptance, in-transit transfer ledger, spoilage, rejection and returns need the planned inventory ledger. Separate listings must represent genuinely separate stock. |
| Bids | One full-quantity offer per farmer/request; no editing or split awards. Requests use descriptive product/location fields; automatic product matching and bid-radius enforcement remain to be implemented. |
| Realtime | HTTP polling, not Channels/WebSockets. Redis/Celery and durable event dispatch are roadmap items. |
| Native | Compiles and bundles, but needs a development build and physical-device validation. Push, QR scanning, photos/OTP proof, offline job/outbox sync, and biometric sign-in are not implemented. Completion currently records driver attestation only. |
| Tracking | One active tracked job per device. Customer location visibility ends on completion; GPS retention cleanup and stronger operational monitoring remain. No guarantee after app force-stop or OS suspension. |
| Accounts | One profile role per account in this slice. Multiple roles, password recovery, verified contacts and farmer onboarding remain. |
| Catalog | Read/create listings; image URLs rather than image uploads. Stock edits, richer units, product taxonomy, pagination beyond the bounded preview and moderation remain. |
| Reviews | Separate produce and delivery scores at order level, not per-item reviews yet. |
| Operations | No commission/payout ledger, support inbox, routing optimization, regulatory onboarding or production deployment automation yet. |

Reservation expiry runs on catalog, checkout, bid acceptance, and order reads. For periodic cleanup:

```powershell
& '.\.venv\Scripts\python.exe' '.\backend\manage.py' expire_reservations
```

Schedule that command every minute in a deployed environment; replace it with a worker task when Celery is introduced.

## Native driver app

```powershell
Set-Location '.\driver'
npm ci
npm run typecheck
npm run android
```

Android builds require the Android SDK/JDK/device setup. iOS builds require macOS/Xcode or a configured remote build service. Background location requires a native development/production build, not Expo Go. Use a valid HTTPS backend origin reachable from the phone; `127.0.0.1` on a phone is the phone itself.

The native client uses a separate, driver-only token endpoint and OS secure storage. Production needs token expiry/rotation and remote session management. The current development profile accepts HTTPS only; it intentionally does not transmit credentials over an arbitrary plaintext LAN endpoint.

Validate background tracking on physical Android and iOS devices, including permission denial, screen lock, navigation switching, battery optimization, network loss and forced termination. Failed uploads are reported in tracking health; there is no offline replay queue yet.

The Expo dependency tree currently reports a moderate `minimatch` advisory via `@expo/fingerprint` (build tooling). Do not apply `npm audit fix --force`, which proposes an incompatible Expo downgrade. Resolve with a supported upstream SDK/tooling update before production builds.

## Validation

```powershell
& '.\.venv\Scripts\python.exe' '.\backend\manage.py' test market
npm run typecheck
node --experimental-strip-types --test '.\src\lib\bag.test.mjs' '.\src\lib\ui.test.mjs'
npm run build
Set-Location '.\driver'
npm run typecheck
npx expo install --check
npx expo export --platform android --output-dir dist
```

API tests cover stock reservations and expiry, idempotency, overselling, hub authorization/visibility, award ownership, payment unavailability, private tracking, timestamps, delivery prerequisites, review permissions and CSRF.

Focused storefront tests cover saved-bag restoration, stock changes, corrupt saved data, and grouping checkout items by the exact pickup-origin rules used by Django. Desktop and mobile-browser checks cover shopping navigation, full-page product/bag/checkout flows, and account/workspace entry. Native touch and safe-area behavior still require a physical phone.

Additional UI helper tests cover structured validation errors, responsive image sources, and concurrent catalog reads with retry after failure. Unsplash images use responsive source sets while arbitrary farmer image URLs remain unchanged. Identical concurrent catalog/hub GETs are shared only while in flight; authenticated responses are not persistently cached and mutations are never deduplicated.

Browser validation covers sign-in, catalog search, unpaid checkout, explicit payment unavailability, cancellation, farmer inventory, offer submission/acceptance, farmer-grouped hub inventory and mobile layout. Native source and Android bundle validation do not replace device testing.

### Storefront design conventions

Keep the canvas white and surfaces restrained. `src/app/globals.css` is the token source: brand/action `--green` (`#5C7952`), hover/focus `--green-dark`, body `--ink`, supporting copy `--muted`, separators `--line`, and interactive boundaries `--control-border` (`#87917F`). Control borders measure 3.29:1 on white; separators are intentionally lighter and must not identify a control on their own.

Use the shared notice/error/warning tokens for semantic feedback, with explicit text as well as color. Manrope carries headings and Source Sans 3 carries body/forms. Controls use the shared control radius; product cards use the card radius. Preserve product-led horizontal navigation rather than adding a consumer dashboard sidebar.

Use native labeled controls and tables, visible keyboard focus, 44px coarse-pointer targets, and intentional reduced-motion alternatives (static loading icon with status text; no image zoom or press movement). Long content must wrap inside shrinkable grid/flex children; do not hide page overflow to mask layout failures. Keep preview boundaries visible at checkout and on unpaid orders. Physical-device and assistive-technology validation remain release prerequisites.

## Deployment prerequisites

Set `DJANGO_DEBUG=0`, a strong `DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS`, and HTTPS `CSRF_TRUSTED_ORIGINS`. Never deploy demo users/data. Implement the gaps above, configure production database/storage/workers, validate payment-provider eligibility and legal obligations, and test database restore and reconciliation before accepting real orders.

Sample photography is loaded from Unsplash URLs and requires internet access. Replace it with actual farmer imagery and approved production assets before launch.
