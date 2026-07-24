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

Weeknight open play needs **no capacity, no waitlist, no prepayment**.
Do not build that machinery for Mon–Thu.

That does **not** mean weeknights need no records at all. A weeknight
still needs a registration (walk-in, created at check-in — see below),
a check-in, and a queue entry, because tabs, the rotation queue, and
per-player history all key off those rows regardless of which night it
is. What weeknights specifically don't have is an
`OpenPlayNightSession` — there is no capacity to track, so there is
nothing for one to hold.

**Design consequence**: `OpenPlayNightRegistration.sessionId` is
nullable, and `date` is the field every query and constraint actually
keys off — `sessionId` is populated only for Fri/Sat, where it exists
solely to carry capacity/waitlist state. A Friday/Saturday row must
have a `sessionId` whose own `date` matches; every other day must have
`sessionId = null`. Both rules are enforced with database-level
constraints (a CHECK constraint plus a trigger, since the date-match
rule reads a second table — see
`prisma/migrations/11_registration_session_constraints/` and
`prisma/migrations/12_fix_registration_weekday_check_timezone/`), not
just in application code. The second migration exists because a naive
`EXTRACT(DOW FROM date)` check is wrong: see "Timezone: date-only
values assume `TZ=Asia/Manila`" below.

This same pattern — key off `date`, keep `sessionId` nullable — applies
to `PlayerTab` too. See §9.

Registration for weeknight open play is walk-in only. An advance
"register but don't hold anything" flow was considered and rejected —
weeknight players walk in; a registration that reserves nothing isn't
worth a form.

### Timezone: date-only values assume `TZ=Asia/Manila`

Every "date-only" value in this app (`OpenPlayNightSession.date`,
`OpenPlayNightRegistration.date`, `QueueEntry.date`, and any future
one) is constructed with `new Date(year, month, day)` — JS
local-timezone midnight. The venue is in Kalibo, Philippines (UTC+8,
no DST), and the whole app assumes the Node process's local timezone
*is* Philippine time (`en-PH` locale, ₱ currency, formatting all
already assume this). `TZ=Asia/Manila` is set explicitly in `.env` /
`.env.example` for exactly this reason — it must also be set wherever
the app runs in production (the venue machine, per §14's deployment
architecture).

This matters for any SQL-level date logic, not just application code.
Postgres stores these values into naive `timestamp` columns as their
raw UTC-shifted clock value — "Friday 00:00 PH-local" is stored as
literally "Thursday 16:00" — and has no timezone context to correct
for that. `EXTRACT(DOW FROM date)` on such a column reads the wrong
day. Migration 12 fixes this for the registration/session weekday
CHECK constraint by extracting from `date + INTERVAL '8 hours'`
instead — a fixed offset, not `AT TIME ZONE`, since Asia/Manila has no
DST to account for. Any future SQL touching day-of-week (or any other
date-part) on one of these columns needs the same adjustment.

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

## 4. Players, contact details, and skill level

### Court bookings — name and phone only

No email on the public court booking form. Phone is **required** — it
is the only way staff can reach someone about their slot.

Keep the email column, make it nullable, and keep it visible on the
staff booking detail page where historical values exist. This does not
affect staff/owner login accounts.

### Skill level — open play only

Required for **every** open play registration: Fri/Sat ₱150 nights and
weeknight walk-ins alike. Not collected for court bookings — a private
group's mix is nobody's business.

| Order | Level | Description shown in the dropdown |
|---|---|---|
| 1 | Beginner | New to the sport |
| 2 | Novice | Knows the rules, still learning placement |
| 3 | Intermediate | Consistent rallies, understands kitchen strategy |
| 4 | Advanced | Competitive play |

Store the ordering **explicitly as 1–4**. Alphabetical sorting would
put Advanced first and Novice second.

Always show the descriptions, not just the labels. People self-rate
badly without them, and a mis-rated player is the main thing that
ruins a rotation.

**Where it lives.** On the registration record always, so we know what
someone was on a given night. Also on the user profile when they have
an account, to prefill next time — prefilled but still editable. Staff
adding a walk-in get the same required dropdown.

**Staff can correct it**, logged with who and when. Correcting a level
must never alter past registrations.

**Display.** Beside each name in the staff open play list and waitlist,
plus a count by level on the session view ("8 beginner · 12
intermediate · 4 advanced") so staff can see the mix before the night.

### Two skill enums exist — deliberately, not synced

The Player Profiles / Tournament seeding system already had a skill
rating before this phase: `SkillLevel` (Beginner/Intermediate/Advanced/
**Pro**), admin-assigned, used for tournament bracket seeding. The scale
above (Beginner/**Novice**/Intermediate/Advanced) is a *different* field
— `OpenPlaySkillLevel` on `Player`, plus its own required value on every
`OpenPlayNightRegistration` row — added for this phase.

They were kept separate on purpose: different values (Novice vs. Pro),
different collection method (self-rated for rotation fairness vs.
admin-assigned for seeding), different audience. A player can hold both,
and they can legitimately disagree — a tournament-seeded "Advanced"
player might rate themselves "Intermediate" for a casual Friday night,
or vice versa. **Nothing reconciles them, and nothing should.**

**The rotation queue reads `OpenPlaySkillLevel` only** (via
`OpenPlayNightRegistration.skillLevel`, snapshotted per registration —
never `Player.SkillLevel`). Tournament seeding continues to read the
original `SkillLevel` only. If a future phase wants one scale to inform
the other (e.g. defaulting a new player's open-play rating from their
tournament rating on first registration), that's a deliberate product
decision to make then — not something to "clean up" by merging the two
enums, which would silently corrupt tournament seeding data.

### Skill level is STAFF-ONLY

| Surface | Shows skill level |
|---|---|
| Staff dashboard | Yes — everywhere |
| TV display | **Never** |
| Public website | Never shows other players at all |

Enforce at the **API layer**, not the component. `/api/display` must
not include `skillLevel` in its response at all — a field that never
leaves the server cannot leak into the DOM when someone adds a card
field six months from now.

Test: the `/api/display` response contains no `skillLevel` key for any
player.

---

## 5. Open play capacity and waitlist

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

## 6. Registration and check-in

**Check-in is what enters a player into the queue — not registration.**
Registering at 3PM must never outrank someone who arrived at 7.

### Registration (staff, in advance)

Name, phone, skill level, optional `partyId`.

- **Fri/Sat** — holds a capacity slot, requires ₱150 prepayment.
  Unpaid registrations do not count toward capacity.
- **Weeknight** — optional. Most players just walk in. No capacity,
  no prepayment.

```
registered -> checked_in -> playing/waiting -> done
           \-> no_show
```

### Check-in (on arrival)

Sets `checkedInAt`, creates the `QueueEntry` with
`joinedQueueAt = checkedInAt`, and opens a `PlayerTab` (weeknight) or
marks the prepaid session used (Fri/Sat).

**Queue order is by check-in time.** Registering early buys a capacity
slot, never a better place in line. Late arrivals join the back —
no special handling.

### Check-in screen

Used at a busy desk, so speed wins over polish. Live name search, big
tap targets, one tap to check in. Two lists: *Expected* (registered,
not arrived) and *Checked in* with arrival times. Undo for 60 seconds.
A **walk-in button** that registers and checks in as one action —
that's how most weeknight players arrive.

Skill level shows here. Staff-only screen.

### No-shows

Owner setting `noShowReleaseMinutes`, default 30. A Fri/Sat
registration not checked in within that window after session start is
marked `no_show`, freeing its slot and promoting the waitlist head.
**Never auto-refund** — flag it for staff instead.

Staff can check someone in after a no-show if capacity allows;
otherwise they go to the waitlist.

**Known limitation — reconciliation is lazy, not scheduled.** This app
has no cron/scheduler (see `membershipService.reconcileExpiredMemberships`
for the established pattern this follows). No-show release runs when
the check-in screen's data is loaded, not on a timer. If staff don't
have the check-in screen open, a slot that's already free (its holder
long past `noShowReleaseMinutes`) will not release, and the waitlist
head keeps waiting for a seat that is, in practice, already available.
This is accepted as-is — the mitigation is operational, not technical:
**the check-in screen is what staff are expected to keep open for the
duration of a session**, the same way it's the one staff screen that
must tolerate wifi blips without losing state (§14, "Staff screens
should tolerate blips"). If reconciliation frequency ever becomes a
real problem, revisit with an actual scheduler — don't paper over it
with more lazy-check call sites.

### Parties

A party enters the queue only when **all** members are checked in.
Party join time is the **last** member's check-in — you cannot play a
foursome with two people still outside.

> Note this differs deliberately from the waitlist rule in §5, where
> party wait time uses the *earliest* member. Signing up early
> shouldn't be penalised by slow friends; playing requires everyone
> present.

Show partially-arrived parties on the check-in screen. Staff can split
a party if someone isn't coming.

### Leaving

`done` removes them from the queue, frees a Fri/Sat slot, and surfaces
their tab for settlement if unpaid. `resting` keeps them registered
but skips rotations.

### Correctness

1. Queue position derives from `checkedInAt`, never `registeredAt`
2. A registered player who never checks in never enters the queue
3. Check-in is idempotent — double-tapping creates one entry
4. Party queue join uses the last member's check-in
5. No-show release and waitlist promotion happen in one transaction

Tests: register at 3PM, walk-in at 7PM, check the 3PM one in at 8PM —
walk-in is ahead. Double-tap yields one entry. A party of 3 with 2
arrived does not enter the queue.

---

## 7. Rotation queue and pairing

Applies to weeknight drop-in **and** Fri/Sat unlimited nights.
**Doubles only** — every game assigns exactly 4 players.

### Data model

```
QueueEntry
  sessionId, registrationId, playerName, skillLevel (1-4)
  joinedQueueAt, status (waiting|playing|resting|done)
  gamesPlayed, lastPlayedAt, partyId (nullable)

GameAssignment
  courtId, sessionId, playerIds (4), skillSpread
  source (auto|manual), createdByUserId (null when auto)
  proposedAt, startedAt, endedAt
  status (proposed|active|done|cancelled)

RecentPairing
  sessionId, playerIdA, playerIdB, gameCount
  Discourages repeats. Never a hard constraint.
```

### Auto-pairing

Triggered when a court frees up.

1. **Anchor** — the player waiting longest. Never highest skill, never
   random. Longest wait always anchors.
2. **Candidates** — waiting players within skill distance 1 of the
   anchor, ranked by wait time. Take the 3 longest waiting.
3. **Widen if short** — go to distance 2, then any level. Never leave a
   court idle for a perfect match. A mismatched game beats an empty court.
4. **Starvation guard** — any player waiting longer than
   `maxWaitMinutes` (default 20) is force-anchored on the next court
   regardless of fit. Without this, the only advanced player on a
   beginner-heavy night waits all evening and stops coming back.
5. **Repeat softening** — among equal candidates, prefer players not
   recently paired with the anchor. Soft tiebreak only; never delay a
   game to avoid a repeat.

Output is a **proposed** assignment. Staff confirms. An owner setting
controls whether proposals auto-confirm after N seconds.

### Parties — players who want to play together

Registrations can share a `partyId`, set at signup or by staff. A party
of 2–4 moves through the queue as a unit. Skill matching uses the
party's **average** skill to find the remaining players. Parties larger
than 4 are rejected with a clear message — split them.

Party wait time is the **earliest** join time among its members, so
grouping never costs anyone their place.

### Manual override — staff can always overrule

Staff can build a foursome by hand from the waiting list, ignoring
skill entirely. Marked `source='manual'` with the staff member logged.
Staff can also pin an upcoming foursome so auto-pairing skips those
players until their game runs.

When staff override, the auto-proposal is **discarded, not queued
behind**. The screen must never silently reshuffle after a manual
choice — staff need to trust what they're looking at.

### After a game

All 4 return to the queue with `joinedQueueAt` reset and `gamesPlayed`
incremented. Staff can mark a player `resting` (skips rotations, stays
registered) or `done` (left for the night). `done` frees a Fri/Sat
capacity slot and triggers waitlist promotion.

### Staff view

Live queue in order, wait times counting up. Skill level and games
played beside each name. Anyone past `maxWaitMinutes` highlights coral.
Per court: who's on, elapsed time, next proposed foursome with confirm
and override.

### Settings (owner)

```
maxWaitMinutes        default 20
skillWindow           starting distance, default 1
autoConfirmProposals  off by default
targetGameMinutes     informational, default 15
```

### Tests

- Nobody waits past `maxWaitMinutes` while others play repeat games
- A party of 3 stays together, matched on average skill
- Manual override is never overwritten by a later auto-proposal
- One advanced player among 20 beginners still plays within
  `maxWaitMinutes`
- A court never sits idle while 4+ players wait

### Not in scope

Scoring, win/loss tracking, or auto-adjusting skill from results.
Collect and rotate only.

---

## 8. Payments — manual GCash

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

## 9. Player tabs, settlement, and sales

### Game tally

Every `GameAssignment` reaching status `done` credits one game to each
of its 4 players. **Derive the count from assignment rows** — never a
manually incremented counter, which drifts the first time staff
correct something. Cancelled or voided assignments credit nobody.

### Billing differs by night type

| | Charge | Games |
|---|---|---|
| Weeknight (Mon–Thu) | ₱35 × games played, a running tab | Billed |
| Fri/Sat unlimited | ₱150 prepaid | Counted for rotation fairness, billed at ₱0 |

Snapshot `gameRateCents` onto the session at creation. Equipment
rentals (paddle ₱20) attach to the same tab.

### Data model

**Same fork as §0's `OpenPlayNightRegistration`, and for the same
reason**: weeknight tabs are exactly the ones that carry money (₱35/
game, a running tab) and weeknights have no `OpenPlayNightSession` to
key off. `PlayerTab` keys off `date`, with `sessionId` nullable —
populated for Fri/Sat only, null for Mon–Thu. Apply the same
database-level guard used for registrations (§0): `sessionId` present
⇒ `date` matches that session's date; Fri/Sat ⇒ `sessionId` required;
every other day ⇒ `sessionId` null. This is a decision recorded ahead
of Phase 7, not yet implemented — do not rediscover the fork when
building this phase.

One consequence to design for when this is built: "a session cannot
close while tabs are open" (Correctness #6, below) only makes sense
for Fri/Sat, which has a session to close. A weeknight has no session
to close — its equivalent guard is presumably end-of-night / date
rollover, not session closure. Decide the exact mechanism in Phase 7,
but don't let the Fri/Sat-shaped rule silently become the only one
that exists.

```
PlayerTab
  date, sessionId (nullable), registrationId, playerName
  gamesPlayed (derived), lineItems[], totalCents
  status (open | settled | written_off)
  settledAt, settledByUserId

TabLineItem
  tabId, type (game | rental | adjustment)
  description, qtyOrGames, unitPriceCents, amountCents, createdAt
```

Staff can add an adjustment (discount, correction) with a **required
reason**, logged with who made it. Never edit or delete an existing
line item.

### Settlement

Per player: games played, line items, total owed. "Settle" asks for
method — cash or GCash — then marks paid. GCash uses the manual
verification already built (unique reference required; screenshot
optional at the desk since staff can see the phone). Cash is immediate.

**A player marked `done` with an open non-zero tab must not close
silently.** They appear in an *Unsettled* list on the session view and
the daily summary until resolved. Staff can write off a tab with a
required reason — reported separately from real revenue.

### Sales summary — `/dashboard/sales`

Grouped by `businessDate`, so an 11:30PM game lands on the right night.

**Breakdown**
- Court bookings — subtotal **per court** (1 / 2 / 3), plus total
- Open play — weeknight per-game revenue and Fri/Sat ₱150
  registrations, shown separately
- Equipment rentals
- Adjustments — discounts and write-offs, as negatives

**By payment method** — cash, GCash, unpaid-on-site, outstanding tabs.

**Reconciliation** — expected cash for the day so staff can count the
drawer against it. Flag variance. Date range picker, CSV export.

### Correctness

1. Game counts derive from assignments, never a stored counter
2. Prices snapshot at transaction time
3. Every tab reconciles: sum of line items == `totalCents`
4. Voided assignments credit no games and bill nothing
5. Write-offs never count as revenue
6. A session cannot close while tabs are open — warn and list them
7. All money in integer centavos

Tests: 3 games + 1 paddle == ₱125; a voided game reduces the tab; a
Fri/Sat player with 6 games owes ₱0; closing a session with an open
tab is blocked.

### Not in scope

Payroll, expenses, profit reporting. Revenue only.

---

## 10. Staff dashboard — `/dashboard`

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

## 11. Payment settings — `/dashboard/admin/payments`

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

## 12. TV display — `/display/<slug>`

Reference: `docs/tv-display.html`.

Read-only. No clicks, no forms, no navigation. Must fit 1920×1080
with **no scrolling** — size in `vh` units.

### Approved design — locked

Three states, one word each. **"Open" only ever means open play.**

| State | Colour | Card treatment |
|---|---|---|
| **Booked** | Bone | The word BOOKED huge and centred, booker name beneath in coral, then the scheduled hour |
| **Open play** | Coral | Four player names, one per line, each in a raised box with a coloured left edge |
| **Available** | Green | The word AVAILABLE centred, next booking beneath |

**Sizing is container-relative, not viewport-relative.** Each card is a
`container-type: inline-size`; BOOKED is `33cqw`, AVAILABLE `24cqw`.
This keeps the words filling the card on a small TV, where `vh` units
would shrink them. The venue TV is not large — this matters.

**Name colour cycle** — bone, coral, sky `#8FB8DE`, green — applied in
rotation so adjacent names never blur together. Used for open play
player boxes and for every name in the queue bar, including the
"Next up" four.

**Countdown sizing by context.** Open play games run 15 minutes, so
the countdown is the live number that matters: `4vh`. Booked courts run
a full hour, so theirs is reference only: `2.4vh`. Both turn coral and
pulse under two minutes; on booked courts the word BOOKED turns coral too.

**Bookings are on the hour.** Never 7:30. Open play games land on the
quarter hour.

**No per-court "next" line on open play courts.** The queue is a single
pool assigned to whichever court frees first — tying the next four to a
specific court would be wrong. Booked courts do show their next
booking, since a reservation belongs to that court at that hour.

### Queue bar — approved layout

Two rows, roughly 23vh tall, sitting under the three court cards.

**Top row, three blocks:**

| Block | Content |
|---|---|
| Label | OPEN / PLAY stacked on two lines, `scaleX(1.22)` to stretch the condensed face across the block, with the waiting count and "WAITING" beneath it |
| Next up | Four names in a 2×2 grid, green left edge, using the colour cycle |
| After that | The following four, same 2×2 shape but grey edge, grey label, grey names |

Both name boxes are `flex: 1` so they split the remaining width evenly
with no gap at the right.

**Bottom row:** exactly **8 names** in an even 8-column grid, numbered
from 9, all in bone — a single colour, so the eye reads it as a list
rather than a rainbow. If more than 8 remain, the last cell shows
"+N more" rather than silently dropping people.

**The colour cycle now means something.** It appears in exactly two
places: players currently on court, and the next four going on. Used
everywhere it was decoration; restricted, it signals "about to play."

**Long names shrink, never truncate.** A `fitNames()` pass steps the
font size down until each name fits its cell, floored at half size, and
re-runs on resize and on every queue render.

Minor corrections expected once it's tested on the actual screen.

**Never rendered here:** skill level, games played, wait times, phone
numbers, emails, payment status. Names appear as first name + last
initial only. Enforce by excluding the fields from `/api/display`
entirely, not by omitting them in the template.

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

## 13. Running the TV

### Setup page — `/dashboard/admin/tv-display`

Staff can view, owner can edit.

- Full display URL in large monospace, with Copy
- **QR code** for the URL — scan on a phone, open on the TV
- "Open display in new tab", for when the dashboard is on the TV machine
- Live iframe preview so staff can confirm it works without walking out
- Short setup steps

**Security.** The URL carries an unguessable slug. Owner-only
"Regenerate URL" issues a new slug and invalidates the old one — for
when staff leave or the URL gets shared. Warn that the TV needs the new
URL first.

### On the display page itself

- **"Start display" button on first load only.** Tapping enters
  fullscreen and requests a wake lock — neither can fire without a user
  gesture. Hides afterwards.
- **`navigator.wakeLock`** so the TV never sleeps. Re-acquire on
  `visibilitychange`; the lock drops when a screen turns off and does
  not return on its own.
- **Never blank on error.** If a poll fails, keep the last good data and
  show a small "reconnecting" indicator. A connection error on the lobby
  wall for three hours is worse than slightly stale data.
- Auto-reload once every 6 hours to pick up deploys, but only when no
  game is within 60 seconds of ending.

### Config (owner)

Refresh interval (default 30s). Toggle the queue bar off for quiet days.

### Hardware — decided

**Windows laptop, HDMI cable, not wireless.** Wireless mirroring
degrades exactly when it matters: forty people on the wifi on a Friday
night. HDMI also auto-recovers after a power cut; a cast does not.

Kiosk shortcut, placed in `shell:startup`:

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk
  --noerrdialogs --disable-session-crashed-bubble --disable-infobars
  "http://<host>/display/<slug>"
```

Machine settings that actually prevent failures: never sleep, display
never off, lid close does nothing, auto-login on, Windows Update active
hours covering all opening hours, and always plugged in. Give the app
host a static IP or DHCP reservation — if its address changes, the TV
shortcut breaks silently.

---

## 14. Deployment

### Deployment architecture — the court machine is the single source of truth

Decided, not interim — see below for how this reframes the older
"local-first for now, droplet later" language that used to follow this
section. The court machine stays authoritative permanently; it does not
hand off to a separate droplet deployment once payments land.

**Topology.** App + Postgres run on one machine at the venue, via
Docker. Staff dashboards, the check-in screen, and the TV display all
reach it over local wifi by IP or local hostname — they never depend on
the internet. The public website is the SAME app instance, reached from
outside through a tunnel bound to thecourtroomkalibo.com.

**What an internet outage breaks.**

| Still works | Stops |
|---|---|
| Check-in, queue and rotation, tabs and settlement, cash payments, the TV display, all staff screens | Public booking, online Fri/Sat registration, customer GCash proof submission |

Staff must be able to run an entire live session with zero internet.
Verify this by unplugging the router and running a full session end to
end.

**No second writeable copy — ever.** Do not add a cloud database that
also accepts writes. Two writeable sources cannot both honour capacity
limits, and no sync strategy fixes that. One database, one lock, one
truth.

**Degraded public site.** When the tunnel is down, customers see a clear
"online booking temporarily unavailable, please call 0962 857 2974"
page — never a browser error.

**Local resilience — matters more under this model, not less.** The
venue machine holds all booking and payment data, permanently, not just
during an interim phase.

- Nightly `pg_dump` to DigitalOcean Spaces, 30-day retention
- A tested restore into a scratch database, documented
- Backups must run even when the internet is down: dump locally first,
  upload when connectivity returns
- Docker restart policy `unless-stopped`, so a power cut recovers
  unattended
- UPS on the machine if possible — a hard shutdown mid-write is the
  realistic way to corrupt Postgres

**Staff screens tolerate blips.** Local wifi drops too. Dashboard
screens keep the last loaded state and show a "reconnecting" indicator
rather than an error page — the TV display already has this rule (§12);
apply the same behaviour to the check-in screen, which staff keep open
for the whole session.

### Local-first is viable for the interim

The app and Postgres can run on one machine at the court via Docker.
Everything on the local wifi reaches it by IP — staff dashboard on a
phone or tablet, TV display on the laptop. **Fully functional offline**
for walk-ins, court bookings taken at the desk, the queue, and the TV.

**What local-first cannot do without the tunnel above:** the public
website. No booking from home, no Fri/Sat registration, no GCash proof
submission until thecourtroomkalibo.com is pointed at the venue machine.

Sensible sequence: run locally for staff and TV now, turn on the public
tunnel when payments land — the same app instance and database the
whole time, per the architecture decision above, not a second
deployment.

Two risks to accept knowingly — the court machine is permanently the
single point of failure holding all booking data, so **offsite nightly
backups matter from day one**; and there is no "moving to a droplet
later" to fall back on if local hardware fails without those backups.

### Production target

**Not where the app runs** — per the architecture decision above, the
app and its one database stay on the court machine permanently. The
existing DigitalOcean account (~$24/month, likely 4GB, room alongside
Semcore under 1GB) is the tunnel endpoint / reverse proxy for
thecourtroomkalibo.com and the target for offsite `pg_dump` backups
(Spaces), not a second running copy of the app. Revisit only if the
tunnel approach itself proves insufficient once bookings prove the
business — not as a default "move to the droplet" step.

Domain: **thecourtroomkalibo.com**. Point the tunnel at the venue
machine around Phase 8, once payments work and a customer could
genuinely use it.

Non-negotiable: nightly `pg_dump` to Spaces, 30-day retention, and a
**tested restore** to a scratch database. An untested backup is not a
backup.

### PWA, not native

Installable from the browser on both iOS and Android — home screen
icon, fullscreen, no app stores, no fees, same codebase. Native means
₱5,500/year to Apple, review cycles, a second codebase, and likely
rejection under guideline 4.2 for a single-venue booking wrapper.

Install path that fits Kalibo: a **printed QR tarpaulin at the court**
(you own a signage business), plus links from the Facebook page.
Android prompts to install automatically; iOS needs a one-time
dismissible "Add to Home Screen" hint.

---

## 15. Correctness requirements

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
   Skill level excluded at the API layer, not the template.
9. **Nobody starves in the queue** — the `maxWaitMinutes` guard must
   force-anchor long waiters regardless of skill fit.
10. **Manual pairing sticks** — a staff-chosen foursome is never
    overwritten by a later auto-proposal.
11. **Party wait time uses the earliest member's join time** — grouping
    with friends must never cost someone their place in line.

---

## 16. Build order

Do not do these in parallel. Commit after each.

1. ~~Design port~~ **DONE**
2. ~~Court hours settings — cutoffs, facility close, after-hours flag,
   `businessDate`, paddle price~~ **DONE**
3. ~~Open play sessions, capacity defaults, per-date overrides~~ **DONE**
4. Registration, waitlist, auto-promotion — plus skill levels, removing
   email from court bookings, and **the concurrency test**
5. Check-in — the queue-entry trigger, check-in screen, no-shows, parties
6. Rotation queue and pairing — anchor by wait time, skill window,
   starvation guard, manual override
7. Player tabs, settlement, and the sales summary
8. Manual GCash payments and the verification queue
   *(snapshot `businessDate` onto Payment rows here)*
9. Payment settings page with audit log
10. TV display, `/api/display`, and the TV setup page
11. PWA — installable on iOS and Android

Phases 4–7 can run against a local deployment. The public website and
domain only become necessary at Phase 8.

---

## 17. Open questions

- **Address and Facebook URL** — needed for the footer.
- **Weeknight settlement model** — tabs settled on departure, or ₱35
  paid per game as they go? Tabs are far less desk work but someone
  will walk out owing ₱105. Fine with regulars; riskier with walk-in
  strangers, where prepaid game credits may suit better.
- **Refund on a Fri/Sat no-show** — the ₱150 is prepaid and the slot
  was held. Currently flagged for staff, never auto-refunded.
- **AVAILABLE vs BOOKED balance on the TV** — nine characters against
  six, so AVAILABLE reads smaller. "FREE" would match BOOKED's weight
  if it looks unbalanced on the real screen.
- **Two open play systems** — confirm the existing rotation queue and
  the new `OpenPlayNightSession` are complementary, not duplicates.
  Working assumption: the old system tracks *who plays next*, the new
  one tracks *who paid to attend a Fri/Sat night*. Both are needed. If
  the old one is dead code, say so and plan its removal.
- **Beginner vs Novice** — players may not distinguish these. If
  everyone defaults to Novice, collapsing to three levels later is easy;
  expanding from three to four after collecting data is not.
- **Auto-confirm proposals** — on a busy Friday, confirming every
  foursome is a tap every few minutes. Decide from real nights whether
  auto-confirm with undo is better. The setting exists either way.
- **Cancellation and refund policy** — how late can someone cancel a
  paid ₱150 open play slot and get a refund?
- **GCash receiving limits** — a personal wallet has a monthly ceiling.
  Worth watching once volume picks up.
