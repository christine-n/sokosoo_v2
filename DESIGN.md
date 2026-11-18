---
name: SokoSoo
description: Good food. Closer to home.
colors:
  green: "#5c7952"
  green-dark: "#435c3a"
  green-pale: "#f0f4ed"
  canvas: "#ffffff"
  ink: "#232b25"
  muted: "#656e63"
  line: "#e6eae2"
  control-border: "#87917f"
  surface: "#fafbf8"
  surface-soft: "#f3f5ef"
  notice-bg: "#f6f8f3"
  notice-text: "#53644a"
  error-bg: "#fff3ef"
  error-text: "#8d3926"
  warning-bg: "#fff7e6"
  warning-text: "#775a2c"
  status-bg: "#f3f4f0"
  status-text: "#5b6255"
  selection-text: "#23351e"
  selection-bg: "#dce8d5"
  scrollbar-thumb: "#cbd4c6"
  modal-backdrop: "#19201650"
  toast-bg: "#283d23"
typography:
  heading:
    fontFamily: "Manrope, sans-serif"
    fontWeight: 700
  body:
    fontFamily: "Source Sans 3, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  action:
    fontFamily: "Source Sans 3, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.4
rounded:
  control: "7px"
  card: "12px"
components:
  button-primary:
    backgroundColor: "{colors.green}"
    textColor: "{colors.canvas}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
    padding: "12px 18px"
  button-primary-hover:
    backgroundColor: "{colors.green-dark}"
    textColor: "{colors.canvas}"
  button-secondary:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.green-dark}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
    padding: "12px 18px"
  input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "11px 12px"
---

# SokoSoo Design System

## Overview

This documents the existing implementation, not a new identity. The approved brand commitments are a white canvas, restrained surfaces and muted green actions. Manrope and Source Sans 3 are the current self-hosted implementation fonts; their use does not imply separate brand approval.

Shopping is product-led. Enquiries, notifications and inventory are task-oriented surfaces: familiar controls, clear consequences, stable density and explicit recovery matter more than decoration. Preserve the storefront header and horizontal categories rather than introducing a consumer dashboard sidebar.

## Colors

The frontmatter records the current values of the CSS tokens in [globals.css](./src/app/globals.css).

- Use `green` for primary actions and compact selected accents, not large page backgrounds.
- Use `green-dark` for links and action text, especially on `green-pale` selection surfaces. Normal-size `green` text on `green-pale` fails AA contrast.
- Use `ink` for primary text and `muted` for secondary text.
- Use `control-border` for identifiable input boundaries; `line` is a decorative separator, not an interchangeable input border.
- Keep warning, error, notice and neutral status roles distinct. Pair color with text or another non-color indicator.
- Light mode is the supported presentation. Do not invent a dark theme by inverting these colors.

## Typography

Use the heading family for headings and the body family for prose, controls and tables. Headings use weight 700, primary actions 600 and body text 400. Numeric prices, quantities and timestamps use tabular numerals where implemented.

The body baseline is 16px with 1.5 line height. Smaller table and metadata text is secondary, not a replacement for readable form inputs. Allow labels, messages and names to wrap. Do not fix container heights around dynamic text.

## Layout

- The storefront container is at most 1440px with 40px desktop gutters, 25px intermediate gutters and 18px mobile gutters.
- The default product grid has four columns, three at 960px and below, and content-sensitive columns at 700px and below. Enlarged text can reduce mobile columns rather than forcing horizontal page scrolling.
- Shopping remains a continuous page; consumer, farmer and hub operations have role-specific workspaces.
- Header layout adapts at 1250px, 960px and 700px. Hiding the desktop location trigger must not remove Change/Clear location from Filters.
- The header is sticky except on short viewports. Its measured height supplies scroll offsets for programmatic focus and anchors.
- Forms stack fields with a 20px gap. Use the existing two-column form grouping only where both controls can shrink and their labels can wrap.
- Use pagination for public produce and inventory rather than an unbounded page. Keep filtering, ordering and total counts consistent with the complete eligible dataset.
- Horizontal scrolling is allowed inside a named inventory-table region; do not make the entire page scroll horizontally.

## Elevation & Depth

Product cards are largely flat. Separate records using spacing and subtle borders. Soft shadows belong to temporary overlays such as the account popover, drawer and toast, not every content block.

Use native modal dialogs with a restrained backdrop. Keep focus inside the modal, provide an explicitly labelled close control and return focus to the opener.

## Shapes

Use the control-radius token for equivalent buttons and inputs, and the card-radius token for equivalent request, hub, enquiry and summary cards. Preserve intentional differences such as compact status tags and circular icon controls.

## Components

### Actions and fields

- Primary and secondary buttons have a 46px minimum height. Coarse-pointer controls should provide at least 44px targets even when their visible icon is smaller.
- Keep fine-pointer hover styling within its media query. Text actions on tinted surfaces use the darker action color.
- Focus uses a visible 2px green outline with offset. Do not suppress focus on interactive elements.
- Reuse [Field](./src/app/forms.tsx) for labels, required indicators and server errors. Associate error text with the control, mark invalid fields and move focus to the first invalid field or error summary.
- Preserve entered data after errors. Announce loading, success and failure with appropriate status/alert semantics.

### Notifications

Use a real table with a compact subject and an Actions column. Selection is page-scoped, including the header checkbox's mixed state. Details reveals the full message without marking it read; ordinary activation of the linked record marks it read. Consumer and farmer workspaces keep received timestamps and read status in separate columns, including on mobile, using a labelled horizontal scroll region.

### Inventory

Hub-manager inline batch actions identify their editor with `aria-controls`. Opening an editor moves focus to its heading below the sticky header. Back to batch returns to the initiating row action. Farmer batch actions instead use linked detail views, with produce and origin in separate table columns. Preserve table headers, captions and the labelled scroll region.

### Farmer workspace

The farmer workspace replaces storefront navigation with a compact farm header and operational side navigation; on mobile, navigation uses a collapsible menu. Keep the marketplace escape in the account menu. Buyer enquiries, requests, stock and transfers use searchable, filterable tables with explicit Actions columns. Filters and pagination live in the URL and apply before server pagination. Record actions navigate to dedicated views, retaining the originating table's filters in their Back links. Notification Details opens a separate view without marking the update read; following its record link marks it read. Overview counts come from the complete owned dataset, not the visible table page.

### Consumer workspace and table fields

Consumers use the same operational shell for Overview, My enquiries, My requests & offers, and Notifications. Product discovery, saved produce and the bag stay in the storefront. Request creation and offer review are full views; sending an offer enquiry keeps the existing stock checks and idempotency behavior.

Give each distinct field its own column. Do not stack buyer and produce, request and status, or quantity and unit in one cell. Enquiries with several produce items use one row per item, with shared enquiry fields spanning those rows. Keep full record access and table filters in linked detail and Back views. Overview counts and request tables are owner-scoped; farmer offers within one request support search, ordering and pagination.

### Produce, bags and category-aware controls

- Show bag quantities on produce cards. Never imply that a private bag reserves stock or notifies a farmer.
- Fetch product details and bag IDs independently of the visible catalog page. A missing item on one page is not evidence that it is unavailable.
- Quantities in `head` are whole animals; divisible units retain two-decimal quantities. Enforce the same rule in the API.
- Maximum price is a numeric KES-per-unit filter, not crop-only presets.
- For live livestock, present the stored date as Farmer-recorded date, not harvest or slaughter. New listing copy asks for the date the farmer recorded that stock; existing historical values are not reinterpreted as birth or slaughter dates.
- Internal availability deadlines remain off product cards. Availability is rechecked when sending an enquiry.

## Do's and Don'ts

- **Do** retain white backgrounds, restrained green and product-led discovery.
- **Do** test selected, hover, keyboard focus, loading, empty, error and disabled states together.
- **Do** retain reduced-motion alternatives and immediate, predictable focus handoffs.
- **Do** distinguish enquiry, confirmed receipt, stock allocation and sale: they are different events.
- **Do** keep customer-facing copy focused on the next action. Keep development status, sample-account credentials and implementation notes in developer documentation, not product screens. Clearly label actual test listings.
- **Don't** claim payment processing, managed pickup, delivery tracking, verification or notification channels that Phase 1 does not provide.
- **Don't** silently round fractional animal counts or remove saved produce because it is absent from a paginated response.
- **Don't** invent a new palette, typography identity or decorative metaphor when extending an existing surface.
