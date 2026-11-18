# Farm-to-consumer platform: implementation plan

## Implementation status

### Current Phase 1 scope (supersedes payment/fulfilment MVP descriptions below)

The approved first release connects farmers and buyers: private 24-hour carts, stock-checked enquiries with immediate quantity deductions, farmer responses, manual stock reconciliation, hub dispatch/partial receipt/movement history, selected-hub request matches, in-app notifications and scheduled archival cleanup. Declines and expiry never automatically restore deducted availability. Farmer acceptance shares contact and location but does not manage pickup or deduct twice. Product cards do not show internal freshness timestamps/deadlines.

Payments, managed logistics, premium tracking, farmer classification and revenue pricing are explicitly Phase 2. Historical orders and the native driver foundation are preserved; their presence does not make these current Phase 1 services. The remaining architecture sections are a future roadmap, not the current release contract. See README.md for runnable behavior and limits.

The initial local implementation now includes a Next.js marketplace, Django API and Expo native driver foundation. This document remains the target architecture, not a claim that every phase is complete. See [README.md](./README.md) for setup, verified behavior, local database/polling deviations, and outstanding payment, inventory-ledger and production requirements. The native driver path supersedes the earlier foreground-web pilot recommendation.

## 1. Scope and recommendations

Confirmed current foundations: Next.js + Django, Kenya and KES. The architecture below explores future managed payments/delivery and live GPS tracking; those are not current Phase 1 commitments.

Build a modular monolith first: one Django application owns business rules and one Next.js application serves role-specific experiences. Avoid microservices until operational scale justifies them.

Proposed MVP boundaries, requiring approval:

- Support multiple farms and hubs from launch, but pilot within one delivery service area.
- A consumer may hold farmer and consumer roles in the same account. Staff grant manager and driver permissions.
- A purchase contains one or more seller suborders; each suborder has one farmer and one pickup location. Each suborder initially gets its own delivery and fee. Show all fees before payment.
- Accept one farmer bid for the full requested quantity in MVP. Split-award requests and partial bids follow later.
- Use manual dispatch and fixed zone/weight-based delivery fees first; defer automated route optimization.
- Drivers use foreground web GPS for the pilot, clearly labeled as such. If continuous background tracking is a launch requirement, include a native driver client in MVP.

## 2. System architecture

```text
Next.js consumer / farmer / hub / driver interfaces
       | HTTPS REST                  | authenticated WebSocket
       v                             v
Django + Django REST Framework + Channels (ASGI)
       |                   |
PostgreSQL + PostGIS       Redis
       |                   | Channels fan-out / Celery broker
       +---- Celery workers and scheduler
                    |
       Payment providers / SMS / email / maps

Object storage: listing images and delivery proof
```

| Layer | Responsibility |
|---|---|
| Next.js App Router + TypeScript | Public catalog, account screens, dashboards, checkout, map views |
| Django REST Framework | Validated API, authorization, pricing, inventory and workflow rules |
| PostgreSQL + PostGIS | Transactional records, stock locks, indexed geographic searches |
| Django Channels + Redis | Delivery location/status and bid notifications |
| Celery + Redis | Reservation expiry, payment reconciliation, notifications, settlement jobs |
| S3-compatible storage | Validated image uploads with private access where needed |
| Django admin | Account approval, hub setup, disputes, operational recovery and audit views |

Use Django sessions with Secure, HttpOnly cookies and CSRF protection behind a shared origin: `/api/` and `/ws/` route to Django, other routes to Next.js. Django remains the authorization authority. Never put payment credentials or business rules in the browser.

Publish an OpenAPI contract and generate frontend API types. Use server rendering for discovery and client components for interactive forms, cart state, bids, and tracking.

Suggested application boundaries:

```text
frontend: app, components, features, lib
backend: accounts, catalog, inventory, hubs, requests,
         orders, payments, deliveries, reviews, notifications
```

## 3. Role experiences and workflows

### Farmer

1. Register/login; verify contact details and complete farm profile with coordinates.
2. Create a listing: crops, livestock, or byproducts; price per unit; quantity; unit; images; and applicable harvest, slaughter, or production date.
3. Choose direct, hub-drop, or both. Choose a predefined hub for hub stock; show nearest hubs by distance.
4. Receive paid direct orders and manage pickup readiness.
5. View eligible consumer requests and submit quantity, unit price, pickup origin, delivery commitment, and bid expiry.
6. Declare a hub drop with batch, quantity, and reference. This creates a pending receipt, not sellable stock.
7. View orders, inventory by location, bids, reviews, and settlement history.

### Consumer

1. Browse without login; register/login to request bids or buy.
2. Search by produce/category, price, availability, listing channel, hub, and distance from a selected location.
3. Buy from a farm listing, create a request, or buy manager-confirmed hub stock grouped by farmer.
4. Review seller suborders, pickup origins, delivery fees, delivery address, and total before paying.
5. Pay with M-Pesa or an eligible card provider. See pending, failed, or confirmed payment states explicitly.
6. Track each delivery independently with status history, last GPS update, and live location when available.
7. After delivery, rate produce for each purchased item and rate its delivery separately.

### Hub manager

1. Access only assigned hubs; see expected drops and pending receipts.
2. Inspect a drop; confirm accepted quantity, reject damaged stock with reasons, and record discrepancies.
3. View stock grouped by farmer and batch, including expiry and reservations.
4. Prepare paid orders, coordinate dispatch, assign drivers, and record pickup handover.
5. Record spoilage, returns, and adjustments through audited movements.

### Driver and administrator

- Drivers see only assigned jobs, confirm pickup, share GPS during active work, and complete delivery with recipient confirmation or proof.
- Administrators create hubs and service zones, approve privileged roles, manage dispatch, handle refunds/disputes, and reconcile payments and farmer settlements.

## 4. Core data model

| Entity | Important fields and relationships |
|---|---|
| User / Role / HubMembership | Credentials, verified contacts, account status, assigned roles and hubs |
| Farm / Address | Farmer, coordinates, public approximate location, private pickup/contact details |
| Hub / ServiceZone | Physical address, coordinates, opening hours, managers, delivery coverage |
| Category / Product / Unit | Crops, livestock, byproducts; product taxonomy and canonical compatible units |
| Listing | Farmer, product, unit price, permitted channels, status, description, images |
| ProduceBatch | Listing, traceable lot, harvest/slaughter/production dates, optional expiry |
| StockLot / StockMovement | Batch, farm-or-hub location, on-hand quantity, reserved quantity, audited movements |
| HubDrop / HubReceipt | Source lot, hub, declared/accepted/rejected quantities, staff actor, timestamps |
| ConsumerRequest | Consumer, product, quantity/unit, budget, destination, radius, deadline, fulfillment constraints |
| Bid | Request, farmer, exact quantity/unit, unit price, source lot/location, expiry, status |
| Purchase / SellerOrder / OrderItem | Consumer checkout, seller/location grouping, immutable price/unit/fee snapshots |
| InventoryReservation | Order item, source lot, quantity, expiry, lifecycle status |
| PaymentAttempt / PaymentEvent / Refund | Provider references, expected amount/currency, verified result, deduplication keys |
| Settlement / SettlementEntry | Farmer earnings, fees, refunds, payout status and provider references |
| Delivery / DeliveryEvent / LocationPing | Seller order, assigned driver, state, time, coordinates, accuracy, proof |
| ProduceReview / DeliveryReview | Delivered item or delivery, purchaser, rating, comment, moderation status |
| Notification / OutboxEvent / AuditEvent | Durable dispatch work, retries, user notifications, privileged changes |

Use UUID identifiers, decimal quantities and money, explicit currency, UTC timestamps, and Africa/Nairobi presentation. Use integer minor units at provider boundaries where required. Restrict conversions to compatible units: kilograms cannot silently become crates or head counts.

## 5. Business invariants

### Inventory and multi-location aggregation

- Listing channel is visibility/eligibility, not a second inventory balance. "Both" must never duplicate stock.
- A farm lot and each confirmed hub lot have separate balances. Every transfer conserves quantity.
- Declared drops move quantities into in-transit/unavailable stock. Manager acceptance creates hub stock; rejected stock stays unavailable until return or disposal is recorded.
- Available quantity equals on-hand minus active reservations. No negative on-hand or reserved quantities.
- Checkout reserves exact lots inside database transactions using row locks and database constraints. Lock multiple lots in a consistent order.
- Reserve with an expiry and release on cancellation/payment failure. Expiry workers and payment success handling use the same locking protocol.
- Do not hold database locks while calling payment providers.
- Paid stock is committed once. If payment succeeds after a reservation expired, attempt an atomic re-reservation; if unavailable, put the payment into an explicit refund/operations flow.
- Prioritize appropriate expiry dates when selecting lots, retaining source-batch traceability.

### Bidding

- This is a reverse marketplace: consumers request supply; farmers compete with offers.
- Validate product, unit, full quantity, source availability, geographic eligibility, request deadline, and bid expiry.
- A submitted bid does not indefinitely reserve stock. Recheck and reserve at acceptance.
- Accepting a bid locks the request, checks ownership and eligibility, and creates a pending-payment order plus reservation atomically.
- Permit at most one live award per request. Concurrent accept calls cannot create two awards.
- On successful payment, finalize the award and close remaining bids. On timeout, release the reservation and reopen only if the request deadline allows it.
- Bid amendments are blocked while an award is pending; preserve accepted price and terms as snapshots.

### Separate state machines

```text
Request: open -> award_pending_payment -> fulfilled
                           |-> open / expired
         open -> cancelled / expired
("fulfilled" here means commercially awarded and paid, not physically delivered)

Payment: initiated -> pending -> succeeded / failed / cancelled
         succeeded -> partially_refunded / refunded

Order: pending_payment -> confirmed -> fulfilling -> completed
       pending_payment -> cancelled
       confirmed / fulfilling -> cancellation_requested -> cancelled

Delivery: processing -> picked -> en_route -> delivered
          exception branches: failed_attempt / cancelled / returned

Hub drop: declared -> in_transit -> received / partially_received / rejected
```

Define allowed actors, prerequisites, and audit events for every transition. Payment state must not be inferred from delivery state. A purchase can be partially delivered or refunded while other seller orders continue.

## 6. API surface

Use `/api/v1/`, pagination, structured errors, permission checks, throttling, and idempotency keys for financial/order commands.

| Area | Representative endpoints |
|---|---|
| Identity | `POST /auth/register`, `/auth/login`, `/auth/logout`; `GET /me` |
| Catalog | `GET /listings?category=&hub=&channel=&lat=&lng=&radius_km=&min_price=&max_price=&available=` |
| Farmer | `POST /farms`, `POST /listings`, `PATCH /listings/{id}`, `GET /inventory` |
| Hubs | `GET /hubs`, `GET /hubs/{id}/inventory`, `POST /hub-drops`, `POST /hub-drops/{id}/receive` |
| Requests | `POST /requests`, `GET /requests`, `POST /requests/{id}/bids`, `POST /bids/{id}/accept` |
| Orders | `POST /checkout/quote`, `POST /checkout`, `GET /orders`, `GET /orders/{id}` |
| Payments | `POST /orders/{id}/payment-attempts`, provider-specific webhook endpoints |
| Delivery | `POST /deliveries/{id}/assign`, `/transition`, `/locations`; `GET /deliveries/{id}/tracking` |
| Reviews | `POST /order-items/{id}/review`, `POST /deliveries/{id}/review` |
| Realtime | Authenticated `/ws/deliveries/{id}` and user notification channels |

Quotes expire and are recalculated server-side at checkout. Clients cannot choose prices, roles, stock ownership, or arbitrary workflow statuses.

## 7. Payments and settlement

**Provider constraint:** Stripe currently lists Kenya under its extended network through Paystack. This is not a promise of direct Stripe merchant onboarding or Stripe API compatibility. Paystack's Kenya page advertises card and M-Pesa acceptance.

- Integrate M-Pesa through Safaricom Daraja STK Push, subject to merchant onboarding and production approval.
- Preserve the requested Stripe card path if the merchant has an eligible Stripe account. Otherwise seek approval to use Paystack for Kenyan card acceptance; do not silently substitute it.
- Put providers behind a small common payment service while keeping provider-specific verification explicit.
- Persist a payment attempt before initiating an external payment; store provider request/checkout references.
- Never mark an order paid from a browser redirect, an STK initiation response, or an unverified callback alone.
- For Stripe/Paystack, validate webhook signatures against the raw body and deduplicate events.
- For M-Pesa, verify against the exact approved Daraja product's callback/status contract; do not assume Stripe-style signed callbacks. Reconcile provider references, successful status, expected amount, and merchant/account destination using supported trusted provider mechanisms before releasing fulfillment.
- Handle missing, duplicate, delayed, and out-of-order callbacks with idempotent handlers and scheduled reconciliation.
- Use hosted/tokenized card collection; never store PAN or CVV.
- Keep an immutable earnings/refund ledger. Define commission, payout timing, refund funding, and chargeback liability before enabling farmer payouts.
- Do not describe retained funds as escrow or hold customer funds outside an approved provider/legal arrangement.

Official references:

- https://stripe.com/global
- https://paystack.com/ke
- https://developer.safaricom.co.ke/

## 8. Geography, dispatch, and live tracking

- Store coordinates as PostGIS geographic points. Use a spatial index and meter-based distance queries.
- Apply consumer radius to the actual bid/listing pickup origin: farm for direct stock, selected hub for hub stock.
- Keep straight-line discovery distance distinct from routing distance, delivery availability, and delivery fees.
- Require a delivery pin and useful address/landmark; permit manual location entry when browser permission is denied.
- Track each seller-order delivery separately; group them under the consumer purchase.
- Assigned drivers send timestamped coordinates and accuracy over authenticated HTTPS; broadcast authorized updates through Channels.
- Only the buyer, assigned driver, and responsible operations staff may access the tracking channel. Recheck access after reassignment or cancellation.
- Reject stale/out-of-order updates and implausible payloads; do not imply that browser GPS is tamper-proof.
- Use configurable update intervals, initially around 10-15 seconds while active, tuned during field testing.
- Show "last updated" and a stale/offline state instead of simulating movement. Fall back to periodic REST polling.
- Stop customer location sharing after delivery/cancellation and apply a documented retention policy.
- Mobile browsers cannot guarantee background GPS when locked or suspended. Continuous background tracking requires a suitable native driver app and OS permissions.

## 9. UX and accessibility requirements

- Mobile-first role workspaces: consumer marketplace, farmer sales/inventory, manager receiving/dispatch, driver jobs.
- Keep Buy now, Request bids, and Buy from hub distinct, with transparent origin, farmer identity, available quantity, unit, and delivery cost.
- Group hub inventory by farmer without merging away provenance.
- Include empty, loading, failure, offline, expired bid, insufficient stock, pending receipt, payment pending, and stale tracking states.
- Keep multi-seller fees and separate delivery expectations visible before payment.
- Support keyboard navigation, labeled forms, readable contrast, accessible validation and status announcements; target WCAG 2.2 AA.
- Use responsive image sizes and low-bandwidth pagination. Do not rely on maps alone to communicate status.
- Begin with English; confirm Kiswahili and notification language requirements before localization work.

## 10. Phased implementation and exit criteria

| Phase | Deliverables | Exit criteria |
|---|---|---|
| 0. Operational decisions | Pilot geography, hub data, units, delivery/payout/refund policies, payment eligibility, driver-client choice | Business rules approved; provider onboarding started |
| 1. Foundation | Next.js/Django setup, PostGIS, sessions, role permissions, CI, admin, generated API types | Accounts work; cross-user and cross-hub access tests pass |
| 2. Catalog and hub stock | Farms, categories, listing forms, batches, geographic search, drops/receipts, inventory ledger | Pending drops are unsellable; concurrent reservations cannot oversell |
| 3. Commerce and payments | Quotes, seller suborders, reservations, fees, M-Pesa/card sandbox, webhooks, cancellation/refunds | Direct and hub purchases complete; duplicate events and late payments are safe |
| 4. Reverse bidding | Requests, bid submission, expiry, acceptance and checkout integration | Concurrent awards produce one reservation/order; invalid bids cannot win |
| 5. Delivery and reviews | Manual dispatch, driver workflow, live tracking, proof, notifications, reviews | Actual-device tracking tested; unauthorized tracking denied; only delivered purchases reviewed |
| 6. Pilot hardening | Settlement reconciliation, backups/restore, observability, load tests, operational runbooks | End-to-end pilot accepted; payment/stock totals reconcile; restore drill passes |

Build one direct-sale vertical slice through all layers early, then reuse the same order, inventory, and delivery services for hub purchases and accepted bids.

After MVP: split awards, multi-pickup consolidated delivery, route optimization, inter-hub transfers, native background tracking if deferred, multilingual support, recurring orders, and advanced farmer analytics.

## 11. Validation and deployment

- Backend: pytest + pytest-django; real PostgreSQL/PostGIS transaction tests for reservations and bid races.
- API: test role/ownership isolation, decimal/unit validation, distance boundaries, hub acceptance discrepancies, and transition permissions.
- Payments: sandbox happy paths plus failed/duplicate/late callbacks, reservation-expiry races, partial refunds, and reconciliation recovery.
- Frontend: focused component tests and Playwright journeys for direct purchase, hub purchase, bid award, manager receipt, and driver-to-consumer tracking.
- Test GPS denial, offline/reconnect, stale updates, and background suspension on physical Android and iOS devices.
- Verify audit trails, stock conservation, settlement arithmetic, keyboard access, and mobile layouts.
- Deploy Next.js plus separate Django ASGI, Celery worker, and singleton scheduler processes; use managed PostGIS, Redis, and object storage.
- Stage with isolated provider credentials and data. Keep secrets server-side; validate uploads; rate-limit authentication and paid operations.
- Monitor payment-pending age, stock mismatches, failed jobs, delivery exceptions, and stale GPS. Use request IDs and avoid logging precise location or payment secrets.
- Use a transactional outbox so committed orders/events survive worker outages; consumers must tolerate duplicate processing.
- Before launch, review Kenya data-protection obligations, food/livestock handling and traceability requirements, prohibited listings, cancellation rights, and payment-provider marketplace terms with qualified advisers.

## 12. Decisions required before coding

1. Pilot counties/service zones, initial hubs, and delivery hours.
2. Merchant entity and card-provider eligibility: direct Stripe versus approved Paystack alternative.
3. Commission, delivery-fee calculation, payout timing, refunds, and dispute responsibility.
4. Whether separate delivery fees per seller/pickup are acceptable for MVP.
5. Whether bidding must support partial supply or multiple winning farmers at launch.
6. Whether live GPS means foreground pilot tracking or guaranteed background driver tracking.
7. Required farmer verification, regulated product restrictions, cold-chain rules, and quality inspection.
8. Whether livestock fulfillment needs a distinct transport/approval workflow.

Approval checkpoint: confirm the proposed MVP boundaries and these operational decisions before application implementation or visual design begins.
