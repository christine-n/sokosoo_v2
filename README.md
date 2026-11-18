# SokoSoo

A local farmer-to-buyer connection platform built with Next.js, TypeScript, Django, and Django REST Framework. Phase 1 supports enquiries and stock coordination, not payment or managed fulfilment. The Expo driver foundation is retained for Phase 2.

## Run with Docker Compose and Make

Requires Docker with Linux containers, Docker Compose v2+, and GNU Make. On Windows, use Docker Desktop with WSL 2 and run these commands from the repository root in PowerShell or WSL:

```powershell
make up
make seed
```

Open http://127.0.0.1:3010; Django admin is at http://127.0.0.1:8010/admin/. `make up` builds the images, applies migrations, starts the services, and waits for their health checks. Demo seeding is optional and explicit; an unseeded database starts with an empty marketplace.

| Command | Purpose |
|---|---|
| `make help` | List available commands |
| `make down` | Stop/remove this project's containers and network, retaining volumes |
| `make up` | Start again, rebuilding changed images |
| `make ps` / `make logs` | Inspect status / follow service logs |
| `make migrate` / `make makemigrations` | Apply / generate Django migrations |
| `make seed` / `make superuser` | Add local demo data / create an administrator |
| `make test` | Run API and focused frontend tests inside containers |
| `make typecheck` / `make check` | Validate frontend types / Django configuration |
| `make expire` | Expire unpaid stock reservations |
| `make cleanup` | Archive stale listings, expire enquiries/carts, and generate in-app reminders |
| `make manage ARGS="showmigrations"` | Run another Django management command |
| `make shell-api` / `make shell-web` | Open a container shell |
| `make config` / `make build` | Inspect Compose configuration / rebuild images |

Services use the `sokosoo` Compose project name and publish only to loopback. Next.js reaches Django at `http://api:8010` on the private Compose network; the browser continues to use same-origin `/api/` requests. Do not run the host servers and containers on the same ports simultaneously, or stop unrelated projects to free ports.

To select alternative host ports, set these before `make up`; trusted web origins adjust automatically:

```powershell
$env:SOKOSOO_WEB_PORT = "3011"
$env:SOKOSOO_API_PORT = "8011"
make up
```

Source changes under `src`, `public`, and `backend` are bind-mounted for development reloads. The web configuration files are also mounted. Dependencies live in images, not host `node_modules` or `.venv`; after changing a dependency manifest/lockfile, run `make up` to rebuild. Docker builds exclude local environments, databases, and generated artifacts. On Windows, source watching can be slower than host development; WSL's Linux filesystem generally performs better.

SQLite lives in the `sokosoo_database` named volume at `/data/db.sqlite3`, selected by `SOKOSOO_SQLITE_PATH`; the existing host `backend/db.sqlite3` is neither imported nor overwritten. A separate `sokosoo_next-cache` volume isolates Linux Next.js output from the host `.next`. `make down` preserves both. Do not use `docker compose down --volumes` unless you intend to permanently delete the container database and cache. Back up the database before deleting volumes.

This is a **local development setup**, using Django/Next.js development servers and debug mode, not a production deployment. A dedicated `cleanup` container runs `cleanup_marketplace --loop` every minute after API migrations complete; it restarts on failure and logs failures rather than silently skipping them. It shares only SokoSoo's database volume. After changing cleanup code, run `docker compose restart cleanup`. Payments, PostgreSQL and Redis are not added. The Expo driver remains a Phase 2 host/native-device workflow.

Services use an init process to forward signals and reap child processes. If Windows bind-mount edits do not appear in development, use `make restart` to reload this project's services; do not restart the shared Docker engine.

## Local code graph (Graphify)

[Graphify](https://github.com/Graphify-Labs/graphify) is an optional development
tool, separate from the Django and Next.js runtimes. This repository pins the
official `graphifyy` package and uses local AST parsing only: no API key, hosted
index or source upload.

On Windows, run from the repository root with Python 3.11-3.14:

```powershell
python -m venv .venv-graphify
.\.venv-graphify\Scripts\python.exe -m pip install -r requirements-graphify.txt
.\.venv-graphify\Scripts\graphify.exe extract . --code-only --max-workers 2
.\.venv-graphify\Scripts\graphify.exe cluster-only . --no-label
.\.venv-graphify\Scripts\graphify.exe query "consumer_workspace" --budget 1000
```

The two build commands create `graphify-out\graph.json`, `GRAPH_REPORT.md` and
`graph.html`. Re-run them after source changes. The generated graph, caches and
virtual environment remain local and are ignored by Git; `.graphifyignore`
also excludes assistant/editor metadata. Code-only extraction does not index
design documents or media, and some configuration-only files yield no symbols.

VS Code's committed `.vscode\mcp.json` starts the local Graphify MCP server over
stdio using this environment. After installing, reload VS Code and start/trust
the **graphify** server when prompted. It provides graph queries, node details,
neighbours and impact paths without opening a network listener. The repository
also includes the upstream project skill under `.agents\skills\graphify`.
To refresh that registration after deliberately upgrading the pinned package:

```powershell
.\.venv-graphify\Scripts\graphify.exe install --project --platform agents
```

Do not use the semantic extraction or community-labelling defaults for this
local-only workflow; retain `--code-only` and `--no-label`. No automatic Git
hooks or cloud account are configured. Graphify is Apache-2.0 licensed; its
bundled notices are retained with the installed project skill.

## Farmer workspace

Open `/?view=farm` with a farmer account. The dedicated workspace provides an action-led overview, stock and hub-transfer tables, incoming buyer enquiries, buyer requests/own offers, and notifications. Farmers who also buy can switch the enquiry table to Sent to farmers; shopping enquiry redirects open that view. Search, filters and pagination are URL-backed; batch, enquiry, request and notification actions open linkable detail views without expanding the table. Adding produce has its own workspace view. The consumer storefront and hub-manager inventory retain their existing navigation.

Stock, enquiry and request filters run before pagination (`page` requests return 24-item envelopes). Existing unpaginated API shapes remain supported. `GET /api/farmer-workspace/` supplies owner-scoped overview counts; eligible offer stock is filtered server-side using `offer_request`. These views do not introduce payments, managed logistics or farmer classification.

## Consumer workspace

Open `/?view=consumer` with a consumer account, or select My workspace from the storefront. The dedicated navigation includes Overview, My enquiries, My requests & offers, and Notifications. Stock, enquiry, request and offer tables keep distinct fields in separate columns; multi-item enquiries have individual produce rows.

`GET /api/consumer-workspace/` supplies owner-scoped activity counts. `GET /api/requests/?mine=true&page=1` searches and filters all owned requests before pagination. Request details, offer comparison, request creation, offer review, enquiries and notification details have linkable views with contextual Back links. Offer comparison supports search, price ordering and pagination. Sending an offer enquiry uses the existing stock-deducting, idempotent flow and opens the resulting enquiry. Browsing, saved produce and the private bag remain storefront features.

## Run without Docker (Windows PowerShell)

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

Existing sample/legacy orders are preserved but are not converted into enquiries or shown as current fulfilment. New demo seeding does not create delivery orders or reset/relist existing stock.

Create a separate administrator if needed:

```powershell
& '.\.venv\Scripts\python.exe' '.\backend\manage.py' createsuperuser
```

Django admin is at http://127.0.0.1:8010/admin/. Administrators assign privileged profile roles and hub managers. Stock history, enquiry and legacy financial records are read-only; normal stock adjustments go through the audited inventory workflow.

## Implemented

- White, responsive storefront with the approved `#5C7952` brand color, self-hosted fonts, prominent header search, horizontal categories, and sample produce photography. No persistent consumer sidebar.
- Cookie/CSRF-protected web registration, login and logout. Public registration permits only consumer or farmer roles.
- Customer-facing screens omit development/demo banners, sample-account credentials and implementation commentary. Local account details stay in this document; actual test listings remain clearly identified.
- Context-aware header search: produce/farm/location in Shop produce, request name/description/location in Requests & offers, and hub name/location in Shop by hub. Submit to search within the active tab; other pages search produce. Each tab's submitted term is retained independently in URL parameters (`q`, `requests_q`, `hubs_q`) for tab switching, refresh and browser back/forward. Request and hub matching runs on the API before result limits; request results show up to 100 matches.
- Produce categories appear only in Shop produce, with an announced selected state. Category, channel, hub, maximum price, radius and sorting are retained in URL parameters through refresh, product details and tab navigation. Named areas are URL-backed; precise GPS remains visit-local and must be chosen again after reload. A retained radius is not applied until a location is available.
- Full-page product details, private bag and enquiry review, addressable through query-string navigation. The old `view=orders` link opens enquiries; payment-oriented checkout copy and controls are removed.
- Private per-item 24-hour carts. Anonymous carts expire in browser storage when the app is opened/running; signed-in carts also sync to private server records for scheduled reminders/cleanup. Quantity edits do not restart deadlines. Adding to a bag never notifies a farmer or allocates stock.
- Produce cards show the quantity already in the bag, with decrease/increase controls. Removing the last quantity restores Add to bag; card and bag quantities share the same state.
- Produce browsing and inventory use 24-item pages with URL-backed page state and explicit totals. Price, distance and other filters apply before pagination. Product details load by ID, and local/account bags resolve their saved IDs independently of browse pages; a network failure retains the saved bag for retry. The private account-bag API supports up to 100 products.
- Farmer offer selectors follow every page of the farmer's inventory before determining whether suitable stock exists; they do not treat the legacy 500-item array as the complete inventory.
- Maximum unit price accepts a numeric KES ceiling, including livestock prices. Filters always expose Choose/Change/Clear location where relevant, including mobile/tablet. Equivalent cards and status colors use the shared tokens documented in [DESIGN.md](./DESIGN.md).
- Quantities in `head` must be whole animals across listing/request creation, private bags, enquiries, reconciliation, dispatch and receipt; kg/litre and other supported divisible quantities retain two decimals. Live-livestock dates are labelled Farmer-recorded date rather than harvest/slaughter; historical values are preserved.
- Operational forms use field-associated server errors and focus the invalid control or error summary while preserving entered values. Opening an inventory editor focuses its heading; Back to batch returns to the initiating row.
- Stock is checked at enquiry submission against active, unexpired, received-at-hub availability, merging duplicate lines before validation. Each enquiry has one farmer and origin. Quantities are deducted atomically and an idempotency key prevents duplicate submission deductions. Contact and optional message are shared with the named farmer.
- Farmer acceptance shares contact/location, without another stock deduction or a pickup workflow. Decline, cancellation and unanswered expiry retain deductions pending explicit reconciliation. No payment, pickup or logistics booking is created.
- My enquiries and a compact notification table with All updates / Unread filters, 20-item cursor pagination through all history, and per-row Details actions for full messages. Checkboxes support multi-selection and select-all for the current page; Mark selected as read affects only the selected notifications on that page. Selection resets when changing page, filter or account. Opening a linked record marks its notification as read; Details does not. Consumer and farmer workspaces use linked notification detail views and retain separate subject, received and status columns on mobile through table-local horizontal scrolling. Explicit loading/error/retry states are provided. Filters and page position are URL-backed. New arrivals prompt refresh rather than shifting the table. Notifications are in-app only, not SMS, WhatsApp, email or push.
- Notification subjects name the farm and, for hub stock, the hub; produce names and full messages are available in Details rather than cluttering the table. Names are saved with new notifications. Existing history is enriched from retained records where the origin is recoverable, without guessing names for deleted records or changing read status.
- Notification read actions invalidate only the inbox and unread summary, not public catalog or hub resources.
- Keyboard-visible product-image focus, restored focus after drawer dismissal, semantic inventory tables, and layouts that wrap long product/farm names and large prices.
- Farmer listing coordinates can be filled from device GPS while at the farm, or entered manually; permission failures retain the manual option.
- Farm stock reconciliation, explicit archive/relist, sold-out quantity updates, offline-sale/spoilage/return adjustments, and actor/reason/balance movement history. Internal availability deadlines are never displayed on product cards.
- Hub dispatch reduces farm stock; in-transit hub quantity is zero. Managers confirm actual partial/full receipt once; unaccepted quantities stay outside availability. Farmers see My hub stock and movement history; only responsible managers reconcile physical hub stock.
- Consumer requests and farmer offers remain separate from direct enquiries. Choosing an offer creates a stock-checked enquiry at the offered unit price, not an unpaid order.
- Optional selected-hub matches use produce-name matching plus category, unit and sufficient confirmed quantity. Alerts indicate possible availability, not allocation.
- Unanswered enquiries expire after 24 hours. One-hour reminders and expiry notices go to both parties. Listing deadlines archive records without deleting enquiry/movement history; farmers and responsible hub managers are prompted to reconfirm actual stock.
- Install metadata and an offline fallback page. The PWA does not promise a full offline marketplace or background synchronization.
- Legacy order records and Expo driver source retained for Phase 2; legacy payment/fulfilment write endpoints explicitly return 410.

## Intentional first-slice boundaries

### Listing read contract

The storefront requests `GET /api/listings/?page=1` (and equivalent paginated inventory/hub-drop reads). Responses contain `items`, `count`, `page`, `pages`, `next_page` and `previous_page`. Public `max_price` filtering uses KES per unit. `GET /api/listings/<id>/` resolves a single currently available public product; `GET /api/listings/?ids=1,2` resolves explicit active IDs for bags. Neither lookup depends on the current browse page.

For compatibility, listing reads without `page` retain their array shape and 500-record limit. They are not an authoritative full catalog. New browse/inventory code must request pages; product and bag resolution must use individual IDs.

This is not a production-complete marketplace. The broader roadmap remains in [BUILD_PLAN.md](./BUILD_PLAN.md).

| Area | Current behavior / remaining work |
|---|---|
| Payments and logistics | Arranged directly between buyer and farmer. No platform payment, pickup deadline, collection confirmation or delivery promise. Managed services, premium tracking and farmer classification are Phase 2. |
| Database | SQLite and bounded in-process Haversine distance filtering make local setup simple. Migrate to PostgreSQL/PostGIS and run real multi-connection concurrency tests before multi-user trading. SQLite row locks are not equivalent to PostgreSQL locks. |
| Enquiries | Connecting parties is not proof of sale. Accepted enquiries have no pickup timer. Deducted quantities stay unavailable until deliberately reconciled; staff must avoid adding existing buyer commitments back to availability. No threaded chat or attachments yet. |
| Hub inventory | Receipt is finalized once, with the remaining dispatched quantity recorded as not accepted. Additional deliveries require a new transfer. Returns/spoilage reduce hub balance and do not automatically relist farm stock. Physical collection is outside the platform workflow. |
| Requests | One full-quantity offer per farmer/request; no editing or split awards. Hub alerts require an explicitly selected hub and matching produce name/category/unit/quantity. This is not a full product taxonomy or geographic matching engine. |
| Realtime | HTTP polling, not Channels/WebSockets. Redis/Celery and durable event dispatch are roadmap items. |
| Native / tracking | Preserved Phase 2 foundation; current managed-fulfilment endpoints are retired. Native source must be integrated and physically validated when that service is introduced. |
| Accounts | One profile role per account in this slice. Multiple roles, password recovery, verified contacts and farmer onboarding remain. |
| Catalog | Image URLs rather than uploads. Richer taxonomy, pagination beyond the bounded preview and moderation remain. Freshness deadlines represent seller availability claims, not food-safety certification. |
| Migration | Additive schema preserves legacy orders. Existing stock receives a historical opening movement and a deadline 24 hours after original creation, so older listings start archived and need owner/manager reconciliation. Unreceived legacy hub declarations become unavailable until actual receipt. |
| Operations | No commission/payout ledger, support inbox, routing optimization, regulatory onboarding or production deployment automation yet. |

Without Compose, run cleanup once or continuously in a separate terminal:

```powershell
& '.\.venv\Scripts\python.exe' '.\backend\manage.py' cleanup_marketplace --loop
```

The cleanup pass uses persistent deduplication keys, archives rather than deletes listings, deletes only expired private-cart lines, and never releases enquiry deductions. It also expires older legacy unpaid reservations under their original rules, without converting those orders. `make cleanup` runs a manual pass.

## Native driver app (Phase 2 foundation)

The source below is retained for later integration. Phase 1 retires managed-delivery mutations, so this is not a currently usable delivery service.

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

API tests cover enquiry deductions/idempotency, insufficient/expired/mixed-origin stock, acceptance/decline/cancellation, privacy, expiry/reminders, archival/reconfirmation, hub transfers/partial receipt/permissions, request matching, private-cart cleanup and CSRF. SQLite does not validate production multi-connection row-lock semantics; run those tests on PostgreSQL before a multi-user rollout.

Focused storefront tests cover bag restoration without silently reducing enquiry quantities, per-item expiry, corrupt data and grouping by farmer/origin. Native touch and safe-area behavior still require physical-device validation.

Additional UI helper tests cover structured validation errors, responsive image sources, and concurrent catalog reads with retry after failure. Unsplash images use responsive source sets while arbitrary farmer image URLs remain unchanged. Identical concurrent catalog/hub GETs are shared only while in flight; authenticated responses are not persistently cached and mutations are never deduplicated.

Historical native bundle validation does not validate the current web connection workflow or replace device testing.

### Storefront design conventions

Keep the canvas white and surfaces restrained. `src/app/globals.css` is the token source: brand/action `--green` (`#5C7952`), hover/focus `--green-dark`, body `--ink`, supporting copy `--muted`, separators `--line`, and interactive boundaries `--control-border` (`#87917F`). Control borders measure 3.29:1 on white; separators are intentionally lighter and must not identify a control on their own.

Use the shared notice/error/warning tokens for semantic feedback, with explicit text as well as color. Manrope carries headings and Source Sans 3 carries body/forms. Controls use the shared control radius; product cards use the card radius. Preserve product-led horizontal navigation rather than adding a consumer dashboard sidebar.

Use native labeled controls and tables, visible keyboard focus, 44px coarse-pointer targets, and intentional reduced-motion alternatives (static loading icon with status text; no image zoom or press movement). Long content must wrap inside shrinkable grid/flex children; do not hide page overflow to mask layout failures. Clearly separate enquiries from payment and fulfilment, and keep internal freshness details off product cards. Physical-device and assistive-technology validation remain release prerequisites.

## Deployment prerequisites

Set `DJANGO_DEBUG=0`, a strong `DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS`, and HTTPS `CSRF_TRUSTED_ORIGINS`. Never deploy demo users/data. Configure production database/storage/workers, verified contacts, monitoring and backups, and validate privacy and stock-reconciliation procedures before a public enquiry rollout. Payment-provider eligibility and financial/logistics obligations belong to the separately approved Phase 2 scope.

Sample photography is loaded from Unsplash URLs and requires internet access. Replace it with actual farmer imagery and approved production assets before launch.
