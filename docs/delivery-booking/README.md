# Delivery booking — design reference

Original design prototypes and brief for the device **delivery-booking** feature,
preserved here so the design intent lives alongside the code that implements it.

## What's here

| File | What it is |
|------|------------|
| `Delivery Booking Options.dc.html` | The public booking-flow options (design 1b was chosen and built). |
| `Admin - Delivery Booking Settings.dc.html` | Design for the slot-management admin screen (built as the **Delivery Slots** tab on the Distributions & Deliveries page). |
| `Delivery Confirmation Email.dc.html` | Design for the booking confirmation email (built as `techaid-server` `templates/email/delivery-confirmation.html`). |
| `original-design-chat.md` | The original brief / design conversation. |
| `refs/*.png` | Rendered screenshots of the prototypes. |
| `support.js` | Runtime for the `.dc.html` Claude Design prototypes (they use `<sc-for>` / `{{ }}` templating). |

The `.dc.html` files are **visual specs**, not production code — read them for
colours/spacing/layout and copy, not internal structure.

## Not yet built (from these designs)

- The confirmation email's **Add to calendar / Reschedule / Cancel** action buttons —
  the current email uses "reply to this email or call us" copy instead.
- Public-facing reschedule/cancel self-service.

## Where the implementation lives

- Public booking page: `src/app/views/corewidgets/components/delivery-booking/`
- Slot admin: `src/app/views/corewidgets/components/delivery-slots/`
- Server API + email: `techaid-server` — `graphql/delivery*.graphqls`,
  `cta/app/DeliveryModels.kt`, `cta/app/services/DeliveryService.kt`,
  `templates/email/delivery-confirmation.html`.
