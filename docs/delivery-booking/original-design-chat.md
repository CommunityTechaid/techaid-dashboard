# Charity Device Delivery Bookings

_Started 2026-07-06 16:38 UTC_

---

## User

Hey, my charity uses google calendar bookings to allow receipients of our devices to book in a timeslot to come in and collect their devices. We also want to have a calendar booking system to sign up for deliveries. THat would be similar to the collection bookings, with one key difference - we would have something like 2 longer timeslots (e.g. 10am-1pm and 2pm-5pm) that multiple people could sign up for, like up to 4 people per timeslot let's say. We would need a simple administrative interface (using the design of the existing internal app (attached with 'admin' keyword), a public-facing booking system (see example pdfs), and a simple confirmation email (see attached example email)

## Assistant

_[tool: read_skill_prompt]_

_[tool: run_script]_

Text extracted. Now let me see the visuals, especially the admin panel design.

_[tool: run_script]_

_[tool: run_script]_

_[tool: run_script]_

_[tool: run_script]_

PDF rasterizing hangs in the sandbox — I'll render it in a preview page instead.

_[tool: write_file]_

_[tool: show_html]_

_[tool: show_html]_

_[tool: save_screenshot]_

_[tool: save_screenshot]_

_[tool: set_project_title]_

_[tool: questions_v2]_

## User

Questions answered:
- scope: Decide for me
- public_style: CTA-branded page (matching the admin app's colors)
- slot_days: Admin should configure this
- slot_config: Admin should be able to edit slot times & capacity
- admin_features: Configure slots/capacity, Block out dates (holidays, van unavailable)
- form_fields: Decide for me
- fullness: Just show/hide slots (hide when full)
- variations: 2–3 variations of the public booking page

## Assistant

_[tool: read_skill_prompt]_

_[tool: read_skill_prompt]_

_[tool: update_todos]_

Building the public booking page variations now.

_[tool: dc_write]_

Now the admin settings screen in the TaDa style.

_[tool: dc_write]_

## Assistant

_[tool: update_todos]_

_[tool: dc_write]_

_[tool: update_todos]_

_[tool: ready_for_verification]_

All three pieces are done:

- **Delivery Booking Options.dc.html** (open now) — 3 public booking page directions in CTA branding: **1a** two-panel calendar layout (closest to the Google Calendar PDFs), **1b** guided 3-step mobile-friendly flow (clickable — walk through it), **1c** single page with date chips + big window cards. All hide full windows.
- **Admin - Delivery Booking Settings.dc.html** — TaDa-style admin screen: delivery days, editable window times + capacity steppers, blocked dates, enable/disable toggle.
- **Delivery Confirmation Email.dc.html** — confirmation email with booking summary, day-of expectations, and reschedule/cancel options.

Tell me which public variation to take forward (e.g. "build out 1b") and I'll add its confirmation screen and wire the details through. Note: address, phone, and contact details are placeholders — send real copy/phone numbers when ready.

## User

Export this design as an editable PPTX: Delivery Booking Options.dc.html

## Assistant

_[tool: eval_js_user_view]_

_[tool: eval_js_user_view]_

_[tool: eval_js_user_view]_

_[tool: eval_js_user_view]_

_[tool: eval_js_user_view]_

_[tool: show_to_user]_

_[tool: eval_js_user_view]_

Three option cards at different sizes — I'll export each as its own slide.

_[tool: gen_pptx]_

Done — the PPTX downloaded with 3 slides, one per booking-page option (1a, 1b, 1c) as editable text and shapes. Poppins was swapped for Arial for compatibility, so some text may wrap slightly differently than the preview. The cards keep their natural sizes, so smaller ones sit within blank slide space.

## User

Export this design as an editable PPTX: Delivery Confirmation Email.dc.html

## User

Export this design as an editable PPTX: Admin - Delivery Booking Settings.dc.html

## User

Export this design as an editable PPTX: Admin - Delivery Booking Settings.dc.html

## Assistant

_[tool: eval_js_user_view]_

_[tool: gen_pptx]_

Done — the admin settings screen exported as a single-slide PPTX (1440×900) with editable text and shapes; Poppins was swapped for Arial, so text may wrap slightly differently. Download has started.

## User

Export this design as an editable PPTX: Delivery Confirmation Email.dc.html

## Assistant

_[tool: gen_pptx]_

Done — the confirmation email exported again as a single-slide editable PPTX and the download has started.

