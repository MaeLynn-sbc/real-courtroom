# The Courtroom — Build Spec

Reference document for Claude Code. Put this in `docs/` alongside
`design-reference.html` and `tv-display.html`.

Work through it **one phase at a time**. Commit after each phase.

---

## 0. Business facts

Everything below is real. Nothing here is a placeholder except where marked.

| | |
|---|---|
| Venue | The Courtroom — indoor pickleball |
| Courts | 3 |
| Hours | 7:00 AM – 11:00 PM, daily |
| Court rate | ₱350 / hour, flat — no peak, no member rate |
| Paddle rental | ₱20 each — read from the Equipment record, never hardcoded |
| Phone | 0962 857 2974 |
| Address | **TO BE SUPPLIED** |
| Facebook | **TO BE SUPPLIED** |

### Court booking cutoffs

A court is bookable until its cutoff. After that it switches to open
play and cannot be reserved.

| | Court 1 | Court 2 | Court 3 |
|---|---|---|---|
| Mon – Thu | until 6PM | until 8PM | until 11PM |
| Fri & Sat | until 6PM | until 6PM | until 6PM |
| Sunday | Follows Mon–Thu for now — owner-editable, no code change needed |

`00:00` on a court means **no per-court cutoff**. It is a sentinel, not
midnight. Facility close caps it anyway. Court 3 uses this.

These cutoffs must be **editable by the owner**, not hardcoded.

### Facility close is a PUBLIC limit, not a data limit

This distinction matters. Sessions regularly run late and must still
be recorded.

| | Can book within facility hours | Can book past close |
|---|---|---|
| Public website | Yes | No |
| Staff / owner | Yes | **Yes** |

Staff bookings outside facility hours are allowed and flagged
`after_hours` for reporting. No blocking prompt, no confirmation
dialog — just record it.

Owner can also change facility close per weekday, so if late nights
become regular it's a setting change rather than repeated overrides.

### Business date vs calendar date

A session running 11PM–1AM belongs to **the night it started**, not the
calendar date it ended on. Without this, late bookings vanish from
Friday's totals and reappear under Saturday.

The business day runs from facility open until **3AM the following
calendar day** — anything before 3AM belongs to the previous business
date. Make the 3AM rollover a setting, not a magic number.

Use `businessDate` for: today's bookings on the staff dashboard, daily
payment totals and reconciliation, open play session grouping, and the
TV display. Use the real timestamp on the booking record itself.

Required test: a booking at 11:30PM Friday and one at 12:30AM Saturday
both report under Friday's business date and Friday's totals.

### Open play — two different modes

| | Mon – Thu | Fri & Sat |
|---|---|---|
| Price | ₱35 per game | ₱150 unlimited |
| Registration | None — walk in | Required, prepaid |
| Capacity | Uncapped | 32 Fri / 40 Sat, **editable** |
| Waitlist | No | Yes |
| Payment | Cash at desk | GCash upfront |

Weeknight open play needs **no** session records, no capacity, no
waitlist, no prepayment. Do not build that machinery for Mon–Thu.

---

## 1. Three displays

| Route | Audience | Auth |
|---|---|---|
| `/` | Customers | None |
| `/dashboard` | Staff and owner | Required |
| `/display/<unguessable-slug>` | Lobby TV | None |

The TV route must be auth-free — a smart TV browser cannot stay
signed in. Use an unguessable path segment, or restrict to LAN.
Never render full names, phone numbers, or emails on it.

---

## 2. Design system

Source of truth: `docs/design-reference.html`. Read it in full.

### Colour tokens

Add to Tailwind config as named tokens. Never hardcode hex values.

```
navy-900  #0E1424   page base
navy-800  #151D33   panels
navy-700  #1E2842   raised cards
navy-600  #2C3E63   court blue
coral     #E88A9A   kitchen / non-volley zone
green     #8FC24F   brand accent
bone      #F3F1EA   primary text
slate     #8894B0   muted text
line      rgba(243,241,234,0.10)
```

The navy and coral are taken from the actual court surface. Keep
that relationship — it is why the palette works.

### Type

Load via `next/font` from Google Fonts.

```
Saira Condensed 800/900   display headings, uppercase, tight tracking
Manrope 400/600/700       body copy
JetBrains Mono 400/700    times, prices, labels, eyebrows
```

### Signature element

Every availability slot renders as a **miniature court**: navy fill
with a 3px coral stripe along the bottom edge. This repeats on the
TV display's court cards. It is the thing that makes the system look
like this venue and not a generic booking tool. Keep it consistent.

---

## 3. Public website — `/`

### Hero

Short. The availability grid must sit high on the page — it is what
people come for. Big condensed uppercase headline, one line of body
copy, two buttons, thin stats row.

### Availability grid

- 7-day date picker, today first
- Rows = hours 7AM–11PM, columns = Court 1–3
- Sticky column headers

Slot states:

| State | Appearance | Behaviour |
|---|---|---|
| Open | Navy + coral stripe | Tappable, turns green when held |
| Booked | Dimmed | Not clickable |
| Open play | Translucent coral, reads "Open play" | Not clickable |

Legend beneath the grid explaining all three.

### Selection tray

Fixed bar sliding up from the bottom once slots are held, showing
hours held and running peso total. Clear button. Proceed to checkout.

### Open play section

Three cards: weeknight rotation (₱35/game), Friday unlimited, Saturday
unlimited. The Fri/Sat cards show a **live capacity meter** — slots
remaining and a fill bar, reading from the session record. Bar and
text switch to coral at 80% full. At capacity the card reads
"Waitlist only" and the button becomes "Join waitlist".

Never hardcode a capacity number in the UI.

### House rules

Non-marking shoes; hour ends on the hour with 15-minute grace; water
only on court; paddle rentals ₱20 at the desk.

### Quality floor

Responsive to mobile. Visible keyboard focus. Respect
`prefers-reduced-motion`.

---

## 4. Open play capacity and waitlist

Applies to **Friday and Saturday only**.

### Data model

```
OpenPlaySession
  date, startTime, endTime, capacity, status (open|closed|cancelled)
  One per date. Created on demand from the weekday default.

OpenPlayCapacityDefault
  dayOfWeek (0-6), capacity
  Seed: Friday 32, Saturday 40. Owner editable.

OpenPlayRegistration
  sessionId, playerName, phone, userId (nullable for walk-ins)
  source       walk_in | website
  status       awaiting_payment | pending_verification | confirmed
               | checked_out | no_show | cancelled
  waitlistPos  integer, null when confirmed
  registeredAt, checkedOutAt
```

### Capacity rules

- Capacity comes from the weekday default unless a per-date override
  exists. Owner can override a single date without changing the default.
- **Accept any positive integer.** Do not cap input at 40 — values
  like 42 must be allowed.
- Only `confirmed` (verified paid) registrations count toward capacity.
- Lowering capacity below the confirmed count must **fail loudly**,
  not silently cancel anyone. Tell the owner how many are registered.

### Registration

- Under capacity → `confirmed` once payment verified
- At capacity → `waitlisted`, appended to queue
- Walk-ins added by staff and website registrations compete for the
  **same pool**. No separate allocations.

### Auto-promotion

When a registration becomes `checked_out`, `cancelled`, or `no_show`,
promote the head of the waitlist and renumber the rest — **inside the
same transaction** as the status change, so a freed slot is never
lost or double-assigned.

### Concurrency — critical

Two people registering simultaneously must not both take the last
slot. Wrap count-and-insert in a single transaction with
`SELECT ... FOR UPDATE` on the session row, or a Prisma interactive
transaction with an explicit lock. **Never** count in application code
then insert — that oversells.

Required test: 10 concurrent registrations against capacity 5 →
exactly 5 confirmed, 5 waitlisted.

---

## 5. Payments — manual GCash

No payment gateway. Customers scan a GCash QR and submit proof;
staff verifies manually.

### Money

Store all amounts as **integers in centavos**. Never floats.
Court ₱350/hr = `35000`. Open play ₱150 = `15000`. Paddle ₱20 = `2000`.

**Snapshot the price at time of transaction.** Every booking, rental,
and registration records what was actually charged — never a reference
to the current price. Otherwise changing a price silently rewrites
historical totals and reconciliation quietly stops matching. Applies to
the court rate, the open play fee, and equipment rentals alike.

### Court bookings — prepayment OPTIONAL

Customer chooses at checkout:

- **Pay at the court** → `confirmed` immediately, Payment row `unpaid`,
  method `cash_on_site`. Staff collects on arrival.
- **Pay now via GCash** → show QR, amount, and a generated reference
  code (e.g. `TCR-4821`). Customer submits GCash reference number and
  screenshot. Status `pending_verification`.

GCash path: no proof within 30 minutes → release the slot.

### Fri/Sat open play — prepayment REQUIRED

₱150, no cash-on-site option online.

1. Registration created `awaiting_payment`, holds a place 30 minutes
2. Show QR, ₱150, reference code
3. Player submits GCash reference + screenshot
4. `pending_verification` until staff approves
5. No submission in 30 minutes → released

Staff can still add walk-ins paying ₱150 cash at the desk — method
`cash`, marked paid immediately, counts toward capacity.

### Fraud check

GCash reference number must be **unique across all payments**. Reject
duplicates with a clear message. People reuse old screenshots.

### Data model

```
Payment
  bookingId or registrationId, amountCentavos
  method       gcash_manual | cash | cash_on_site
  gcashReference (unique, nullable)
  proofImageUrl
  status       unpaid | pending | paid | rejected | refunded
  verifiedByUserId, verifiedAt, rejectionReason
```

### Slot holding

On checkout start, create with `holdExpiresAt = now + 30 minutes`.
A held slot is unavailable to everyone else. Create the hold inside
the same locked transaction that checks availability. Expired holds
release automatically.

---

## 6. Staff dashboard — `/dashboard`

- **Pending verification queue** — oldest first, count badge. Shows
  name, what was booked, amount due, reference number, screenshot
  thumbnail, time submitted. Approve → confirmed, log staff id and
  timestamp. Reject → cancelled, slot released, reason required.
- **Unpaid arrivals** — today's court bookings that chose pay-at-court,
  so staff know who owes ₱350.
- **Today's open play** — confirmed list, waitlist in order, live
  counts ("28 / 32 · 6 waiting"). Per-player: check out, mark no-show,
  cancel, manually promote. Add walk-in form. Capacity override with
  logged reason.
- **Daily totals** split by method: gcash_manual, cash, unpaid.

---

## 7. Payment settings — `/dashboard/admin/payments`

**Owner role only.** Whoever edits this can redirect all incoming
payments. Enforce the role check server-side in the action, not just
by hiding the nav link.

```
PaymentMethod
  type (gcash|maya|bank_transfer|other), displayName, accountName
  accountNumber (masked except last 4), qrImageUrl, instructions
  isActive, sortOrder, updatedByUserId, updatedAt

PaymentMethodAuditLog
  paymentMethodId, changedByUserId, changedAt
  fieldsChanged (json before/after), previousQrImageUrl
```

- QR upload: png/jpg/webp, max 5MB, reject others with a clear message
  naming allowed types
- **Never overwrite the previous QR** — keep it and record its URL in
  the audit log so a bad change can be rolled back
- Live preview showing exactly what the customer sees at checkout
- Cannot deactivate or delete the last active method — open play
  requires prepayment and would break. Explain why; don't fail silently
- Warn before saving if bookings are currently `pending_verification`,
  since those customers saw the old QR
- Audit log of last 20 changes displayed on the page

Checkout reads active methods from this table, ordered by `sortOrder`.
Nothing about the QR or account details is hardcoded anywhere.

---

## 8. TV display — `/display/<slug>`

Reference: `docs/tv-display.html`.

Read-only. No clicks, no forms, no navigation. Must fit 1920×1080
with **no scrolling** — size in `vh` units.

- **Header** — logo, "COURT STATUS", live clock and date
- **Middle** — three large court cards:

| State | Shows |
|---|---|
| In play | First name + last initial, start/end time, elapsed progress bar |
| Open play | Coral accent, current game, end time |
| Free | Large green "OPEN NOW", next booking beneath |

- **Bottom** — open play queue. "Next up" foursome highlighted green,
  remaining players with queue numbers, total waiting on the right.

Add `GET /api/display` returning current and next booking per court
plus the queue. Page polls every 30 seconds — **not** websockets.
Show a "last updated" indicator.

---

## 9. Correctness requirements

These are the things that will break in production if skipped.

1. **Concurrency** — availability check and reservation in one locked
   transaction. Two people must never take the last slot or last place.
2. **Unique GCash references** — enforced at the database level.
3. **Waitlist promotion atomicity** — promote inside the same
   transaction as the status change that freed the place.
4. **Capacity reduction guard** — cannot drop below confirmed count.
5. **Last payment method guard** — cannot remove the only active one.
6. **Owner-only payment settings** — enforced server-side.
7. **Held slots expire** — orphaned holds must not block a court forever.
8. **No PII on the TV display** — first name and last initial only.

---

## 10. Build order

Do not do these in parallel. Commit after each.

1. ~~Design port — tokens, fonts, hero, availability grid, selection tray~~ **DONE**
2. Court hours settings — editable cutoffs and facility close per weekday,
   staff after-hours booking, `businessDate` rollover, paddle price fix
3. Open play sessions, capacity defaults, per-date overrides
4. Registration, waitlist, auto-promotion (+ the concurrency test)
5. Manual GCash payments and the verification queue
6. Payment settings page with audit log
7. TV display and `/api/display`
8. PWA — installable on iOS and Android, home screen icon, fullscreen

---

## 11. Open questions

- **Address and Facebook URL** — needed for the footer.
- **Cancellation and refund policy** — how late can someone cancel a
  paid ₱150 open play slot and get a refund?
- **GCash receiving limits** — a personal wallet has a monthly ceiling.
  Worth watching once volume picks up.
