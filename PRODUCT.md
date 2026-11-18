# Product

<!-- impeccable:product-schema 1 -->

## Platform

web, with a native driver client

## Stack

Next.js/TypeScript frontend and Django REST Framework backend. An Expo/React Native driver client supports native location tracking.

## Users

- Farmers list crops, livestock, and byproducts, respond to buyer enquiries, maintain available stock, and follow their produce at hubs.
- Consumers discover produce, keep private temporary carts, send stock-checked enquiries, and post requests for farmer offers.
- Admin-managed aggregation hubs confirm actual receipt and maintain farmer-attributed physical stock.
- Drivers, payments, managed logistics and farmer classification are Phase 2, not part of the current connection flow.

## Product Purpose

Connect farms to buyers through enquiries, consumer-request offers, and multi-location aggregation. Phase 1 does not manage payment, pickup or delivery.

## Operating Context

The launch market is Kenya and the transaction currency is KES. Implementation has begun with a local runnable marketplace and native driver foundation. See README.md for implemented behavior and remaining production requirements.

## Capabilities and Constraints

- Registration and login for farmers and consumers.
- Listings include category, price, quantity, unit, harvest/slaughter date as applicable, and farm location or hub.
- Listing channels are direct, hub-drop, or both.
- Hub managers confirm actual receipt before produce becomes available for enquiries; dispatch removes farm availability to prevent double counting.
- Search includes category, location, hub, availability, price, distance, and listing channel.
- Consumer requests receive farmer bids.
- Carts are private, expire after 24 hours, and never notify farmers. Stock is checked on enquiry submission, not through freshness information on product cards.
- Successful enquiries immediately deduct availability. Acceptance never deducts again; decline, cancellation and unanswered expiry never restore stock automatically.
- Farmers accept/decline with a response; acceptance includes contact and farm/hub location. There is no platform pickup deadline or collection confirmation.
- Unanswered enquiries expire after 24 hours; one-hour reminders and expiry notices reach both parties through an in-app inbox.
- Internal listing deadlines archive rather than delete stale listings. Reconfirmation requires an explicit physical-stock reconciliation.
- Hub movements record dispatch, partial receipt, rejection discrepancy, returns, spoilage and adjustments. Hub managers reconcile hub stock; farmers see their hub history.
- Requests can opt into a selected hub's availability matches by produce name, category, unit and full quantity.
- Scheduled cleanup creates deduplicated in-app notifications and runs independently of page visits. SMS, WhatsApp and push are not enabled.
- Payment, premium logistics/tracking, farmer classification, and pricing are deferred to Phase 2. Existing legacy records and native source are retained, not presented as current services.

## Evidence on Hand

The project directory contained no application implementation when planning began. Local demo accounts, farms, hubs and produce are illustrative, not verified operational data. No supplier credentials, payment credentials, or real hub data was supplied.

## Brand Commitments

- Product name: SokoSoo.
- Use white page backgrounds and restrained surface treatments; avoid bold or heavily colored backgrounds.
- Reserve stronger color for actions, status indicators, and small accents rather than large background areas.
- Approved brand color: muted green `#5C7952`. Use it for primary actions and selected accents while keeping page backgrounds white.
- Other previously proposed colors and typography remain recommendations, not approved choices.
- The initial implementation uses Manrope headings and Source Sans 3 body text as the proposed typography, self-hosted from installed font packages.
- Consumer surfaces are a storefront, not a management dashboard: full-width shopping header, prominent search, horizontal categories, product-led discovery, and separate product, bag and checkout views.
- Enquiries, notifications and saved produce belong under the account menu. Farmer and hub operations have separate, role-specific workspaces rather than a persistent consumer sidebar.
