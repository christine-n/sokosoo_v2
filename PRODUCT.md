# Product

<!-- impeccable:product-schema 1 -->

## Platform

web, with a native driver client

## Stack

Next.js/TypeScript frontend and Django REST Framework backend. An Expo/React Native driver client supports native location tracking.

## Users

- Farmers list crops, livestock, and byproducts; sell directly or through aggregation hubs; and bid on consumer requests.
- Consumers discover produce, buy listings or request bids, pay, track deliveries, and submit reviews.
- Admin-managed aggregation hubs receive farmer produce and coordinate hub-to-consumer delivery.
- Platform-managed drivers provide live GPS delivery tracking.

## Product Purpose

Connect farms to consumers through direct sales, consumer-request bidding, and multi-location aggregation.

## Operating Context

The launch market is Kenya and the transaction currency is KES. Implementation has begun with a local runnable marketplace and native driver foundation. See README.md for implemented behavior and remaining production requirements.

## Capabilities and Constraints

- Registration and login for farmers and consumers.
- Listings include category, price, quantity, unit, harvest/slaughter date as applicable, and farm location or hub.
- Listing channels are direct, hub-drop, or both.
- Hub managers confirm receipt before produce becomes purchasable as hub inventory.
- Search includes category, location, hub, availability, price, distance, and listing channel.
- Consumer requests receive farmer bids.
- Delivery progress is processing, picked, en route, and delivered, with live GPS tracking.
- Requested payment methods are M-Pesa and card through Stripe; merchant eligibility and provider integration must be confirmed before implementation.
- Consumers rate produce and delivery.
- Commission, farmer settlement, cancellations, substitutions, and delivery pricing remain open business decisions.
- Background GPS uses an Expo native driver client. Physical-device permission, battery, connectivity and background-operation validation remains required.

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
- Orders, tracking and saved produce belong under the account menu. Farmer and hub operations have separate, role-specific workspaces rather than a persistent consumer sidebar.
