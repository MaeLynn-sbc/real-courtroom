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
already assume this).

This matters for any SQL-level date logic, not just application code.
Postgres stores these values into naive `timestamp` columns as their
raw UTC-shifted clock value — "Friday 00:00 PH-local" is stored as
literally "Thursday 16:00" — and has no timezone context to correct
for that. `EXTRACT(DOW FROM date)` on such a column reads the wrong
day. Migration 12 fixes this for the registration/session weekday
CHECK constraint by extracting from `date + INTERVAL '8 hours'`
instead. **This fixed +8 hardcode is safe only because the Philippines
has never observed DST** — a flat offset is exact year-round precisely
because there's no seasonal shift to account for. If this app is ever
deployed somewhere that isn't Asia/Manila (or, implausibly, the
Philippines starts observing DST), both this constraint and every
`new Date(y, m, d)` call in the app need to be revisited together —
they're one coupled assumption, not two independent ones. Any future
SQL touching day-of-week (or any other date-part) on one of these
columns needs the same `+ INTERVAL '8 hours'` adjustment.

This is now enforced, not just documented, at two layers so it can't
quietly drift on a real deployment:
1. `TZ=Asia/Manila` in `.env` / `.env.example` for local dev, and baked
   into the `Dockerfile` as an image-level default (correct even
   without an external `.env`) for whenever this app is actually
   containerized. `docker-compose.yml` deliberately has no `app`
   service yet — this dev setup runs the app via `npm run dev` on the
   host; wire one in against real deployment requirements when Phase 8
   needs it, not as an unwired placeholder that goes stale unnoticed.
2. `lib/env.ts` asserts the *actual* process UTC offset is -480 minutes
   at boot — checking the numeric offset rather than the `TZ` string,
   since what actually matters is the offset, not the zone name — and
   throws before the app serves any request if it's wrong. Audited to
   confirm every real entry point (web server, `npm run db:seed`, every
   integration test) actually reaches this module — an assertion that
   isn't reached is not an assertion. A live regression test
   (`lib/timezone.integration.ts`) constructs a Friday date, writes it,
   and asserts the database agrees it's a Friday when read back through
   the exact expression migration 12 uses.

### Process rule: dropping a database guarantee requires its proof, same commit

A database-level guarantee (a unique constraint, a foreign key, a CHECK)
may not be dropped in a commit that does not **also** contain the
passing, failure-proven test for whatever replaces it. "Failure-proven"
means the test was run against the code *without* the replacement and
observed to fail, before being run against the code *with* it and
observed to pass — not just written and immediately green.

This is not a hypothetical precaution. `2d6e6c6` dropped
`TabLineItem`'s unique constraint on `(tabId, gameAssignmentId)` (to let
a voided game credit be re-credited — see §9's `voidsLineItemId`) and
replaced it with an application-level check inside `creditGame`,
without a concurrency test proving that check was still safe. It
wasn't: the very next review round found `completeAssignment` could run
10 times concurrently for one assignment with nothing serializing the
calls, credit the game repeatedly, and only luck in that one test run
kept the credit itself from actually duplicating (two *other* side
effects — `QueueEntry.gamesPlayed` and `RecentPairing.gameCount` — did
duplicate, 10x, every run). The fix (`open-play-rotation.service.ts`'s
`FOR UPDATE` lock) and its test (`player-tab.concurrency.integration.ts`)
landed a full commit later, only because the review process caught it.
Under this rule, they would have been required in `2d6e6c6` itself.

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

**Which of these depends on serialized writes — checked precisely, not
assumed (review correction):** step 4's starvation guard reads only
`joinedQueueAt`/wait time — it does not read `RecentPairing` or
`QueueEntry.gamesPlayed` at all, so corrupting either does **not**
defeat the no-starvation guarantee. What step 5's repeat-softening
*does* depend on is `RecentPairing.gameCount` — confirmed a real
algorithm input (`fetchRecentPairingCounts`/`pairingCountBetweenUnits`
in `open-play-rotation.service.ts`). The concurrency bug found in this
session's review (unserialized `completeAssignment` calls incrementing
it 10x instead of once) would silently bias which candidate gets
preferred in a tie, not cause starvation. `QueueEntry.gamesPlayed`,
also found inflated 10x by the same bug, is currently **write-only** —
grepped, not assumed: nothing reads it, not the pairing algorithm, not
the RotationBoard, not the Tabs panel (which independently derives its
own "games played" from `GameAssignmentParticipant` DONE counts, a
different and correctly-derived value — see §9). Its corruption has no
functional consequence today. It's still worth keeping correct, since
`completeAssignment`'s `FOR UPDATE` lock protects it for free in the
same transaction as `RecentPairing` — there's no reason to leave it
wrong just because nothing currently reads it, since that's exactly
the kind of latent trap that bites whoever adds a read path later
without knowing the field was never trustworthy.

**Unfillable queue — a real deadlock, not just "not enough people yet."**
Parties never split, so two parties of 3 with no solos waiting cannot
combine into a foursome no matter how far skill widens — 6 people
waiting, a free court, and no valid group of exactly 4. This is
different from simply having fewer than 4 people waiting, which needs
no explanation. When a court is free and 4+ players are waiting but no
group can be assembled, the staff board must name the reason and
prompt a manual override or splitting a party — never sit idle with no
explanation.

Output is a **proposed** assignment. Staff confirms. An owner setting
controls whether proposals auto-confirm after N seconds.

### Parties — players who want to play together

Registrations can share a `partyId`, set at signup or by staff. A party
of 2–4 moves through the queue as a unit. Skill matching uses the
party's **average** skill to find the remaining players. Parties larger
than 4 are rejected with a clear message — split them.

**Rotation queue order uses `joinedQueueAt` directly — the LAST
member's check-in, same as §6.** A party isn't playable until everyone
has arrived; using the earliest member's join time would let a party
still assembling leapfrog a solo player who was playable the whole
time it waited. This is deliberately different from the Fri/Sat
waitlist rule (§5), which uses the *earliest* member — that's about
claiming a capacity seat, a different question from "whose turn is it
to play," and grouping shouldn't cost anyone their waitlist place even
though it does mean the party's rotation clock starts later, when the
group actually becomes playable.

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

### Court bookings — prepayment REQUIRED on the public site, Phase 8

**Policy change, recorded here ahead of implementation — nothing below
this point in this subsection is built yet.** The public booking form
no longer offers pay-at-court. Every online booking now requires GCash
prepayment before it holds a confirmed slot:

- Customer sees the QR, the amount, and a generated reference code
  (e.g. `TCR-4821`) at checkout.
- Customer submits their GCash reference number and a confirmation
  receipt screenshot. Status `pending_verification`.
- The slot is held 30 minutes from the start of checkout. No proof
  submitted in that window → the hold expires and the slot returns to
  available.
- **Nothing confirms until a human checks.** Staff verify each payment
  actually landed in the GCash account before a booking becomes
  `confirmed` — this is unchanged from the existing Fri/Sat open play
  verification flow below, just now also the only path for public
  court bookings.

**Staff bookings are unaffected.** `cash_on_site`, `cash`, and
`gcash_manual` all remain available when staff create a booking from
the dashboard. Prepayment exists to stop no-shows from strangers
booking online, not to inconvenience someone standing at the desk —
this distinction must hold regardless of how the public form changes.

### Verification queue — every online booking now blocks on staff

Because prepayment is now mandatory for the public path, the
verification queue becomes a load-bearing, can't-miss piece of the
staff UI, not an occasional side task:

- A **pending-verification count badge** must appear on every dashboard
  page (not just a dedicated verification screen) — staff working
  anywhere in the app need to know work is waiting.
- The queue itself is sorted **oldest first**, shows elapsed time since
  submission, and **highlights anything waiting over 30 minutes**.
- Show the affected slot's time next to each pending item, so staff can
  prioritize a booking starting in an hour over one for next week —
  submission order and urgency aren't the same thing.

**Verification screen requirements:**
- The GCash reference number renders **large and selectable**, with
  tap-to-copy — staff paste it into the GCash app to search for the
  transaction, they shouldn't have to retype it from a screenshot.
- The screenshot is viewable **full size**, not just a thumbnail —
  staff need to actually read the amount and timestamp on it.
- The **expected amount** shows beside the submitted proof.
- **Flag when the submitted amount doesn't match what's owed** — don't
  make staff eyeball two numbers to catch a shortfall.

### Customer-side clarity

After submitting proof, the booking page shows "Waiting for
confirmation" with their reference number, and updates live once staff
approve. On rejection, show why and release the slot back to
available. **Never leave the customer guessing whether they have a
court** — silence after submission is the failure mode to design
against.

### Fri/Sat open play — prepayment REQUIRED

₱150, no cash-on-site option online.

1. Registration created `awaiting_payment`, holds a place 30 minutes
2. Show QR, ₱150, reference code
3. Player submits GCash reference + screenshot
4. `pending_verification` until staff approves
5. No submission in 30 minutes → released

Staff can still add walk-ins paying ₱150 cash at the desk — method
`cash`, marked paid immediately, counts toward capacity.

### Cancellation policy — non-refundable, spec only, Phase 8

**Decided ahead of implementation:** the ₱150 is **non-refundable** on
both customer cancellation and no-show. The fee exists specifically to
stop no-shows from strangers holding a seat with nothing at stake —
refunding it on cancellation defeats that purpose the same way
pay-at-court did. Nothing below this point is built; this is recorded
so Phase 8 doesn't reopen a policy question that's already answered.

**Four things this policy requires alongside it, so it doesn't create
worse problems than it solves:**

**1. Preserve the incentive to actually cancel.** Non-refundable with
zero upside makes "just don't show up" the rational customer choice —
strictly worse for the business than a cancellation, since a no-show's
seat never frees and the waitlist never promotes, while a cancellation
at least gives the freed seat a chance to fill. So: cancelling
**before a cutoff** converts the ₱150 to **credit toward a future
night**, never cash. The policy stays non-refundable — no money leaves
the business either way — but a cancelling customer gets something a
no-show doesn't, which is the whole incentive this needs to work.

  **Proposed cutoff: at least 4 hours before the session's start
  time.** Tied to the actual constraint, not a fixed clock time like
  "noon" that stops making sense if session times ever change: staff
  need real lead time to reach the next waitlisted person, get them to
  submit their own prepayment, and have that verified — all manual,
  no push notifications exist in this app. Less than a few hours and
  there's no realistic chance of actually filling the seat before the
  night starts, which is the entire point of encouraging the
  cancellation in the first place. A cancellation *after* the cutoff
  (or a no-show) forfeits the fee with no credit — by then the
  practical outcome is identical to a no-show (the seat can't be
  refilled in time), so the incentive structure doesn't need to
  distinguish them.

  **Open questions, flagged rather than decided:**
  - **Credit expiry** — does it lapse? Proposed default: 90 days from
    issue, stated on the credit itself so it's not a silent trap.
  - **Transferability** — usable by anyone, or tied to the phone
    number that registered? Proposed default: tied to the original
    phone number, matching how a returning-player lookup already works
    (`WalkInRegistrationForm`'s phone-based match). Revisit if
    transferability turns out to matter to real customers.
  - **Coverage** — does one credit cover exactly one future ₱150
    registration (since the fee is flat), or could partial credit
    exist (e.g. from a future variable-priced product)? Proposed
    default: exactly one registration, in full, no partial/fractional
    credit — matches the flat-fee shape of what's being credited.

  None of these are decided — Phase 8 needs an explicit answer before
  building the credit mechanism, not an assumption baked in silently.

  **Shape (spec only, not a schema decision):**
  ```
  OpenPlayCredit
    id, phone, amountCents, reason (e.g. "cancelled registration X")
    sourceRegistrationId
    issuedAt, expiresAt
    usedAt (nullable), usedByRegistrationId (nullable)
  ```

**2. Staff-initiated refunds must exist, separately.** Non-refundable
governs *customer* cancellation. It says nothing about the business's
own errors: a valid payment wrongly rejected, a genuine double
payment, or a night the business itself cancels (e.g. a facility
issue). Those need real cash back, not credit — a staff refund action,
distinct from the customer-facing non-refundable policy:
- Requires a real **Employee** (no anonymous refunds — same "no
  anonymous write-offs" reasoning from §9's review, same shape:
  Employee + a required free-text reason).
- Surfaced on `/dashboard/sales` as **its own card** — count and
  total, never folded into net revenue. Same treatment as write-offs,
  same reasoning: a refund is a real cash outflow that must be
  visible, not silently netted against gross revenue.
- **Bulk case:** cancelling a whole session (the business calls off a
  Friday night) must refund every paid registration on that session in
  one staff action, not force refunding one registration at a time.
  Spec: a session-level cancel action that, for every `CONFIRMED`
  (paid) registration on it, creates a refund with the same
  session-level reason, in one transaction — not a loop of individually
  staff-triggered refunds.

**3. "Rejected" and "cancelled" are not the same event, and the
customer must be told which happened.** Rejecting submitted proof at
verification is not a cancellation — it's a judgment about whether a
valid payment ever actually arrived:
- **No valid payment ever arrived** (blurry screenshot, wrong amount,
  reference doesn't resolve, fabricated proof) → status `REJECTED`.
  Nothing to refund — there was never a real payment to return. The
  slot releases. The customer sees why, and that they're welcome to
  **resubmit** — a rejection isn't a ban, most rejections are honest
  mistakes (wrong screenshot, amount off by a few pesos), not fraud.
- **Payment arrived but was misattributed or wrong** (matched to the
  wrong booking, a genuine double-payment, an amount that's real money
  but doesn't reconcile cleanly) → goes to the **staff refund path**
  above, not `REJECTED`. Real money moved and needs to move back.
- The customer-facing message must say which of these happened and,
  for `REJECTED` specifically, that resubmission is possible — "silence
  after submission" (§8's existing customer-clarity rule) applies
  exactly as much to a rejection as to a pending review.

**4. Snapshot the terms, don't just state them.** The non-refundable
policy must be displayed prominently **before payment** (on the
QR/checkout screen) **and on the confirmation** — not buried in a
footer link. And the registration row must store **which version of
the terms text the customer accepted**, not just that they clicked
something. A dispute six months out needs an answer that isn't "we
think it said that then." Spec: a `termsVersion` identifier (a stable
version string or hash, not the live/mutable CMS text itself) plus
`termsAcceptedAt`, both on the registration row; the terms text itself
needs an append-only version history somewhere resolvable, so a stored
version identifier can always be traced back to the exact wording
shown at that moment — not overwritten in place the way most CMS
content in this app currently is.

**Same reasoning applies to court bookings' own prepayment flow**
(§8's "Court bookings" section, above) — verification exists there
too, so `REJECTED` vs. staff-refund and the terms-snapshot requirement
both apply symmetrically. The credit-on-cancellation mechanism is
open-play-specific (tied to the flat ₱150 fee); court bookings' own
cancellation/refund policy is still an open question (§17) independent
of this decision.

**Status reconciliation — `OpenPlayNightRegistrationStatus`,
current vs. implied:**

Current (`prisma/schema.prisma`): `AWAITING_PAYMENT`,
`PENDING_VERIFICATION`, `CONFIRMED`, `CHECKED_OUT`, `NO_SHOW`,
`CANCELLED`.

- `AWAITING_PAYMENT`, `PENDING_VERIFICATION`, `CONFIRMED` — unchanged.
- `CHECKED_OUT` — unchanged, and *not* part of this reconciliation at
  all: it's an operational "left for the night" state (§7's `markDone`
  already uses it), orthogonal to payment/refund status. Not a payment
  concept, doesn't get folded into anything below.
- `CANCELLED` — status value unchanged, but its meaning now branches:
  fee **retained** by default, or **credited** if cancelled before the
  4-hour cutoff (item 1, above). This is *not* two status values — a
  registration is simply cancelled or it isn't. The fee disposition is
  a separate fact, carried by whether an `OpenPlayCredit` row with
  `sourceRegistrationId` pointing at it exists, not by the status enum
  itself.
- `NO_SHOW` — unchanged; fee always retained, no credit path (a
  no-show is definitionally past the cancellation cutoff).
- `REJECTED` — **new.** Proof submitted, no valid payment behind it,
  nothing to refund, slot released, resubmission allowed (item 3).
- `REFUNDED` — **new.** Staff-initiated only (item 2) — a valid
  payment that needs to be returned in cash, distinct from both
  `CANCELLED` (customer-initiated, non-refundable-or-credited) and
  `REJECTED` (no real payment ever existed).

`BookingStatus` needs the same two additions (`REJECTED`, `REFUNDED`)
for the same reasons once its own verification queue exists — not
detailed further here since the credit mechanism is open-play-specific,
but the split itself is not.

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

**Resolved (Phase 7): what "closing out the night" means per night type.**
"A session cannot close while tabs are open" (Correctness #6, below)
only makes sense for Fri/Sat, which has a session with a `status` to
flip OPEN → CLOSED (`OpenPlayCapacityService.closeSession`). A weeknight
has no `OpenPlayNightSession` row at all — there is no status field to
guard, and building one just to have somewhere to hang this check would
resurrect the exact fork §0 already resolved the other way. So for a
weeknight, "closing out the night" is **not a status transition** —
it's purely the Unsettled tab list (`PlayerTabService.listUnsettledForDate`)
being empty. There is no "close weeknight" action for staff to click;
the Unsettled list on the check-in screen is the entire mechanism, for
both night types — Fri/Sat additionally gets a "Close session" button
gated on that same list being empty. Don't add a weeknight status field
later just to make this symmetrical with Fri/Sat; the asymmetry is the
correct reflection of one night type having a session and the other not.

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

### Analytics: Fri/Sat participation scope (resolved, Phase 7 review)

`analyticsService.getOpenPlayParticipation` (the `/dashboard/analytics`
and `/dashboard`'s "Open Play sessions" KPIs) previously read the old,
dormant `OpenPlaySession` model and rendered plausible but wrong
numbers — the same class of problem as the deleted `/dashboard/reports`
"Open Play report" (§9's Correctness section). Rewired to the real
`OpenPlayNightSession`/`OpenPlayNightRegistration` data, with two scope
decisions recorded here so they aren't silently re-litigated:

**Fri/Sat only, not weeknight.** `sessionsCount` only ever has rows for
Fri/Sat — weeknights have no `OpenPlayNightSession`. Scoping
`registrationsCount`/`checkedInCount` to `sessionId != null` keeps the
three numbers coherent as a set ("registrations per session" is a
real ratio); including weeknight signups (which have no session to
divide by) would make that ratio meaningless. Every field name and every
place this renders says "(Fri/Sat)" explicitly — a silently-scoped
number is exactly the stale-report failure this section exists to
prevent. Weeknight activity is not dropped: `weeknightCheckedInCount`
exposes it separately, its own explicitly-labeled figure.

**CANCELLED excluded, NO_SHOW included.** A cancellation is a genuine
opt-out before the night — not participation. A no-show is a real,
usually-paid commitment that failed to show up — a materially different
thing. This matters beyond semantics: **the gap between
`registrationsCount` and `checkedInCount` is the no-show rate**, and
that rate is exactly the metric that will show whether Phase 8's GCash
prepayment (§8) actually reduces no-shows from strangers. Collapsing
that gap by excluding no-shows from the count would delete the ability
to measure the policy's own effect. `noShowCount` is exposed as its own
explicit field rather than left as an implied subtraction, since
`AWAITING_PAYMENT`/`PENDING_VERIFICATION` registrations (not reachable
from any service method yet, but real enum values Phase 8 will make
reachable) would otherwise silently pollute that subtraction later.

**Operational note, not yet actioned:** record a no-show-rate baseline
from real data before Phase 8's prepayment requirement ships — once
prepayment is live, the pre-prepayment comparison point is gone. See
§17.

**Cancellation and the ₱150 fee — confirmed current behavior:**
`OpenPlayRegistrationService.cancelRegistration` only flips status to
`CANCELLED` and releases the seat/promotes the waitlist — there is no
refund logic anywhere in that path, because there is no payment logic
anywhere in that path. The ₱150 fee isn't tracked as a real payment yet
at all (§9's Fri/Sat-fee gap, above), so today a cancellation is not a
"paid opt-out" in any accounting sense — there's nothing recorded to
refund. This changes the moment Phase 8 wires the fee into a real
payment: at that point, "does cancelling a Fri/Sat registration refund
the ₱150" stops being moot and becomes a real accounting question
(still revenue? refunded? something else?) — see §17's existing
"Cancellation and refund policy" open question, which Phase 8 must
resolve before, not after, wiring the fee into revenue.

### Correctness

1. Game counts derive from assignments, never a stored counter
2. Prices snapshot at transaction time
3. Every tab reconciles: sum of line items == `totalCents`
4. Voided assignments credit no games and bill nothing
5. Write-offs never count as revenue
6. A session cannot close while tabs are open — warn and list them
7. All money in integer centavos
8. Crediting a game is safe under concurrency — never a double credit
9. Settling or writing off a tab twice has exactly one effect, not two
10. A write-off always has an attributed employee and a reason
11. A rental line item's amount is fixed at creation — repricing the
    underlying equipment must never rewrite an already-added charge

**On #8, stated plainly (review requirement):** `creditGame`'s
idempotency check (does an active, non-voided GAME credit already
exist for this tabId+gameAssignmentId?) is application-level, not a
database constraint — a database-level unique index can't express
"unique among non-voided rows" here, because voids are separate,
append-only rows (`TabLineItem.voidsLineItemId`), not a flag on the
original, and a partial index's predicate can only see the row being
inserted's own columns. This is safe **only because** its one caller,
`completeAssignment`, takes a `SELECT ... FOR UPDATE` lock on the
`GameAssignment` row before ever reaching it — two concurrent
`completeAssignment` calls for the same assignment cannot both be
"inside" `creditGame` at once. This is an invariant held by a
*different* method than the one relying on it — documented here and in
both methods' code comments specifically so it doesn't get silently
invalidated by a future second caller of `creditGame` that doesn't
take the same lock.

**Full blast radius, investigated (not just the credit) — the lock
fixed three confirmed corruptions, not one.** With the lock disabled,
10 concurrent `completeAssignment` calls against one `ACTIVE`
assignment: all 10 "succeeded" (the core invariant — DONE happens
exactly once — was already broken). Checking every side effect that
transaction body performs, not just the one the original test happened
to assert on:
- `QueueEntry.gamesPlayed` — incremented **10 times per player**
  instead of once (confirmed: landed at 10, not 1).
- `RecentPairing.gameCount` — incremented **10 times per pair**
  instead of once (confirmed: landed at 10, not 1, for all 6 pairs).
- `TabLineItem` GAME credits — did **not** actually double in this
  specific investigation (landed at 1 per participant, correctly,
  across three repeated runs) — likely because `completeAssignment`
  does substantial sequential DB work (`queueEntry.updateMany`, six
  `recentPairing.upsert` calls) *before* reaching `creditGame`, giving
  the 10 concurrent transactions time to commit and become visible to
  each other's check-then-insert before most of them got there. **This
  is not a safety guarantee** — it's this test harness's timing, not a
  property of the code, and the code as it stood was genuinely
  vulnerable to a duplicate credit by the same reasoning that produced
  the other two confirmed duplications. Treat it as "didn't reproduce
  this run," not "wasn't a bug."
- `GameAssignment.status` — ends at `DONE` correctly either way (10
  redundant writes to the same row, but the final value happens to be
  right), so this one is invisible from final-state inspection alone.

With the lock restored: all three (gamesPlayed, RecentPairing,
credits) land at exactly 1, every time, confirmed by re-running the
same investigation. See `player-tab.concurrency.integration.ts` for the
committed regression test (asserts the credit and the fulfilled/
rejected split; the gamesPlayed/RecentPairing inflation was confirmed
via a throwaway investigation script, not a permanent test, since the
lock protects the entire transaction body identically — a second,
narrower test would not catch anything the first doesn't already
guard against).

**What the losing calls return.** Before this fix, a losing concurrent
`completeAssignment` call threw a plain `Error`, which surfaced to
staff as an error toast — including for the ordinary case of a
double-tap on a slow connection, which is not actually an error. Fixed
with a distinct `AssignmentAlreadyCompletedError` (same named-error
precedent as `shift.service.ts`'s `ShiftAlreadyOpenError`), thrown only
when the assignment is already `DONE` — `completeAssignmentAction`
catches this one specifically and returns a benign no-op (`{error:
null}`, logged server-side, no toast) instead of routing it through the
generic error path. A `PROPOSED` or `CANCELLED` assignment still throws
a real error — that's genuine misuse, not a benign race. Verified live:
a rapid double-click on "Complete game" in a real browser produces no
error toast.

Tests: 3 games + 1 paddle == ₱125; a voided game reduces the tab; a
Fri/Sat player with 6 games owes ₱0; closing a session with an open
tab is blocked; N concurrent completeAssignment calls against one
assignment yield exactly one credit; settling or writing off the same
tab twice is rejected the second time, not duplicated; a write-off
with no reason or no employee is rejected; repricing equipment after a
rental line item was added doesn't change that tab's total.

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
11. **Party rotation order uses the last member's join time
    (`joinedQueueAt`)** — the moment the party actually became
    playable, not the earliest member's arrival. Using the earliest
    member here would let a still-assembling party leapfrog a solo
    player who was playable the whole time. (The Fri/Sat *waitlist*
    seat order, §5, is the opposite — earliest member — because that's
    about claiming a seat, not turn order in a live rotation.)

### Concurrency audit (Phase 7 review — mapped, not yet patched)

Three guards existed by this point — `lockSessionRow` (§5),
settlement's status-guarded `updateMany` (§9), `completeAssignment`'s
row lock (§9) — each found one at a time, by accident, after something
broke. This audit covers every open-play service method that
transitions a status, moves money, or mutates the rotation queue,
checked against the actual code, not assumed. **Findings below are
mapped only — none are fixed yet.** Ranked by real-world severity for
Phase 8 triage:

**Serious — plausible in normal staff use, real corruption or data loss:**
- `proposeNextAssignment` — the waiting-players read and the
  assignment-creating write run in *separate* transactions. Two
  concurrent proposals (even for two different courts) can read the
  same waiting pool before either writes; nothing stops the same
  registration from becoming a participant in two simultaneous
  `GameAssignment`s. No constraint prevents a registration appearing in
  more than one non-terminal assignment.
- `cancelAssignment` — does not take the same `FOR UPDATE` lock
  `completeAssignment` does. A `cancelAssignment` call can block on
  that lock, then — once unblocked — write `CANCELLED` over a
  freshly-committed `DONE` using its own stale pre-lock read, even
  though the game was already credited and billed. The historical
  record ends up mislabeled despite being paid and completed.
- `releaseRegistration` (backs `cancelRegistration`/`markNoShow`/
  `markCheckedOut`, so also `markDone`) — locks the *session* row, but
  the registration's own `status`/`waitlistPos` (used to decide whether
  to promote the waitlist) are read *before* that lock and never
  re-validated after acquiring it. Two concurrent releases of the
  *same* registration can each compute "this freed a seat" from stale
  data and both run the promotion block — over-promoting the waitlist
  for one freed seat.
- `closeSession` — the "no open tabs" check and the status write are
  not atomic. A tab can become non-zero in the gap between them,
  letting a session close with real money still outstanding.
- `checkIn` (party path) — two members of the same party checking in
  at the same instant can each read a `partyMembers` snapshot that
  doesn't yet include the other's uncommitted arrival. Both conclude
  "not everyone's here" and neither creates queue entries — the party
  silently never enters the queue, with no error and no retry.
- `addRentalLineItem` / `addAdjustment` / `voidLineItem` — the
  tab-is-`OPEN` check is a plain read, not inside `settleTab`'s atomic
  update. A charge added in that window can land after a racing
  settlement already computed its total — recorded as a line item, but
  never billed, silently.

**Lower severity — throws instead of corrupting, or genuinely
low-likelihood:**
- `checkIn` (solo path) / `getOrCreateTab` — protected against
  duplicate rows by real unique constraints
  (`QueueEntry.registrationId`, `PlayerTab.registrationId`), but the
  losing concurrent call gets an unhandled database error, not the
  graceful "already checked in" no-op the sequential double-tap path
  already provides.
- `getOrCreateSessionForDate` — same shape: protected by
  `OpenPlayNightSession.date`'s unique constraint, loser throws
  unhandled. Owner-only and rare to trigger concurrently.

**Unprotected but effectively harmless — no corruption results:**
- `confirmAssignment`, `cancelAssignmentTx` (racing only against
  another cancel, not against `completeAssignment`), `markResting`,
  `markWaitingAgain` — each ends at the same status regardless of how
  many concurrent callers race, and none duplicates a side effect (no
  money, no queue-position, no credit). A double-call is redundant
  work, not wrong data.

**Not applicable — no shared invariant to protect:**
- `registerWeeknightWalkIn` (uncapped by design, no capacity to race
  over), `setCapacityDefault`/`setSessionCapacityOverride` (settings
  values — last-write-wins is the expected behavior for an admin
  field, not corruption).

**Protected, confirmed:**
- `registerWalkIn`, `releaseRegistration`'s session-level serialization
  — `lockSessionRow` (§5's named technique).
- `completeAssignment`, and `creditGame` by extension (only because its
  one caller holds the same lock — see that method's comment) — `FOR
  UPDATE` on `GameAssignment` (§9, this review round).
- `settleTab`, `writeOffTab` — status-guarded `updateMany` (§9, prior
  review round).

`booking.service.ts` was originally marked out of scope for this audit
("already-reviewed pattern, not re-audited") — that review predated
every concurrency bug this session found, so it was re-audited properly.
Findings:
- `createBooking` — already used Serializable isolation + P2034 retry
  (Phase 10), but that protection had never actually been proven against
  a real concurrent-request test, only reasoned about. Now proven live
  (`services/booking/booking.concurrency.integration.ts`): two
  concurrent `createBooking` calls for the same court/overlapping time
  never both succeed — confirmed by temporarily downgrading the
  transaction to READ COMMITTED with no retry (see the extracted helper
  below) and watching the SAME test fail 4/4 with two overlapping active
  bookings, then restoring and confirming 5/5 clean.
- `rescheduleBooking` — did **not** have the same protection: a plain
  (READ COMMITTED, no retry) transaction. Two concurrent reschedules
  onto overlapping times could each read "available" from their own
  snapshot before either wrote — there is no unique constraint shaped
  like "no two active bookings on one court may overlap" to catch this
  at the write, unlike a simple duplicate-row case. Reproduced 3/3 under
  the same downgrade; fixed by routing through the same helper
  `createBooking` uses. Proven live, 5/5 clean — then deleted (see
  below): it had zero callers and no committed phase to wire it in, so
  it didn't ship. The fix and its proof are preserved here and in git
  history, not in the running code.

The fix extracted the inline Serializable+retry loop `createBooking` had
into `lib/serializable-retry.ts`'s `runSerializableWithRetry`. Note for
later: the identical loop is independently duplicated in
`locker-rental.service.ts`, `match.service.ts`, and
`equipment-rental.service.ts` — none of those were touched this pass
(out of scope, and per §0/§15's own rule below, a hardening phase fixes
findings, it doesn't consolidate working guards).

`rescheduleBooking` itself was removed after this audit landed: zero
callers anywhere outside its own test (no action, no route, no
component), and the build order (§16) names nothing for the phase after
Phase 8 (Phase 9 is payment settings) that would wire it in. Per this
session's own rule against fixed-but-unreachable paths, it was deleted
rather than kept "pending a wiring pass" with no phase attached —
recoverable from git (`git log -- services/booking/booking.service.ts`)
along with `testRescheduleBookingNeverDoubleBooks` whenever a real
caller exists.

### Which concurrency pattern, and when (BUILD-SPEC.md §0 process rule)

Four patterns now exist across five services. Picking the wrong one for
a given situation is itself a bug — write down which applies where, so
nobody reaches for the nearest one out of habit.

1. **`SELECT ... FOR UPDATE` row lock.** Acquire the lock on the row(s)
   that own the invariant *before* reading anything the decision depends
   on, so a concurrent caller blocks and, once it's their turn, re-reads
   genuinely fresh state instead of acting on a stale snapshot. Use when
   the decision requires a read-then-decide-then-write sequence against
   a specific, identifiable row (or a small, enumerable set of rows —
   see the party lock below), contention is expected to be brief, and
   blocking (queueing) is an acceptable cost. No retry logic needed —
   the lock IS the serialization. Every open-play use: `lockSessionRow`
   (`OpenPlayNightSession`, §5), `completeAssignment`/
   `cancelAssignmentTx` (`GameAssignment`), `lockAndCheckTabOpen`/
   `assertSessionNotClosed` (`PlayerTab`, `OpenPlayNightSession`),
   `proposeNextAssignment` (`QueueEntry`), `checkIn`'s party branch (all
   of a party's `OpenPlayNightRegistration` rows, in a stable order —
   see §15's lock-order note below), `releaseRegistration` (session row,
   plus a fresh re-read of the registration's own row after acquiring
   it).
2. **Atomic conditional `UPDATE` (a `WHERE` clause that IS the check).**
   No lock is taken at all — the check and the write are the same
   Postgres statement, so there's no gap for anything to land in between.
   Use when the entire invariant can be expressed as one row's `WHERE`
   clause (`status = 'OPEN'`, optionally with a `NOT EXISTS` subquery)
   and nothing else needs to be read as part of the decision. Cheaper
   than a lock — no blocking, no held connection while other work
   happens — but only works when the check and the write really are one
   statement; `closeSession`'s `NOT EXISTS` subquery is the ceiling of
   what this pattern can express before it needs to become a lock
   instead. Uses: `closeSession` (conditional `$executeRaw` `UPDATE`),
   `settleTab`/`writeOffTab` (status-guarded `updateMany`).
3. **Serializable isolation + retry-on-conflict.** Let Postgres's own
   Serializable Snapshot Isolation detect a conflict across the whole
   transaction's read/write set — which can span multiple independent
   rows read at different points, not just one lockable row — and abort
   the losing side (P2034, or P2010-wrapping-40001 for a raw query);
   catch that specific error and retry the whole transaction from
   scratch. Use when the invariant ("no two active bookings on this
   court may overlap in time") can't be pinned to a single row's `WHERE`
   clause or a single row's lock, and genuine conflicts are rare enough
   that abort-and-retry is cheaper than reasoning about which rows to
   lock and in what order. Uses: `createBooking` (via the shared
   `runSerializableWithRetry` helper — see above), and independently,
   `locker-rental.service.ts`, `match.service.ts`,
   `equipment-rental.service.ts`. Retries in the shared helper use full
   jitter (`random(0, min(400ms, 25ms * 2^attempt))`) between the 5
   attempts, not an instant retry — an immediate retry after a genuine
   conflict is likely to hit the same conflict again, since nothing
   about the contention changed a microsecond later, and several
   concurrent conflicting callers retrying instantly synchronizes them
   into colliding repeatedly instead of spreading out.
4. **Named benign-error / duck-typed unique-constraint catch, no-op the
   loser.** Not actually a concurrency *fix* — a real database unique
   constraint already prevents the corruption (two rows where one must
   exist). The only problem is the LOSING side of the race surfaces a
   raw, confusing DB error instead of the same graceful result a
   sequential double-tap already gets. Use when a unique constraint
   already owns the invariant and the remaining work is purely UX: catch
   the specific error (`AssignmentAlreadyCompletedError`'s status check,
   or a duck-typed P2002 check), re-read the now-committed row, return
   it as a no-op. Uses: `completeAssignment` (status-based, not a raw DB
   error), `checkIn`'s solo path (`QueueEntry`/`PlayerTab` unique
   constraints), `getOrCreateSessionForDate`
   (`OpenPlayNightSession.date`).

None of the four is a candidate to eliminate in favor of another —
they answer different questions (single-row exclusivity, whole-statement
atomicity, whole-transaction conflict detection, and error-message
quality on top of a constraint that already works) and each is already
the cheapest tool that solves its specific case. Pattern 1 could
technically subsume pattern 3's cases too (lock every row a booking's
availability check touches instead of trusting SSI) but would be more
code and more surface for a lock-ordering mistake for no real benefit —
not worth it during a hardening phase, and not worth it after one
either, absent a concrete problem with pattern 3 as used today.

### Canonical lock order (new, urgent)

`FOR UPDATE` (pattern 1) now spans five call sites across four tables.
Nothing previously defined the order in which they may be acquired — a
path that ever takes two of these locks in the opposite order to another
path is a deadlock waiting for a busy night, and no correctness test
would catch it (deadlocks aren't wrong data, they're two transactions
each waiting on a lock the other holds).

Every lock site, and what (if anything) it acquires afterward in the
same transaction:

| Method | Locks | Then also locks (same tx) |
|---|---|---|
| `registerWalkIn`, `releaseRegistration` (`lockSessionRow`) | `OpenPlayNightSession` | — |
| `proposeNextAssignment` | `QueueEntry` (all WAITING for the date, `ORDER BY id`) | `GameAssignment` — but only via **INSERT** of a brand-new row, see below |
| `completeAssignment`, `cancelAssignmentTx` | `GameAssignment` (single row) | `QueueEntry` — via `updateMany` on that assignment's participants |
| `checkIn` (party branch) | `OpenPlayNightRegistration` (party members, `ORDER BY id`) | — |
| `addRentalLineItem`, `addAdjustment` (`lockAndCheckTabOpen` → `assertSessionNotClosed`) | `PlayerTab` | `OpenPlayNightSession` |

**The one real multi-table chain:** `addRentalLineItem`/`addAdjustment`
lock `PlayerTab` *then* `OpenPlayNightSession`. Chosen because the tab is
the method's primary subject (must confirm it's `OPEN` first) and the
session check is conditional on the tab even having one (weeknight tabs
have `sessionId: null` and skip it entirely) — tab-first is the natural
order for this code path, not an arbitrary choice.

**`releaseRegistration` locks `OpenPlayNightSession` first, then reads
the registration's own row — confirmed a plain read, not `FOR UPDATE`,
so this is not a second lock and not an ordering conflict.** The
canonical order below ranks `OpenPlayNightRegistration` before
`OpenPlayNightSession`, and at a glance `releaseRegistration` looks like
it does the opposite. It doesn't: the re-read
(`open-play-registration.service.ts`, right after `lockSessionRow`) is a
plain `findUniqueOrThrow`, no `FOR UPDATE`. It's race-free without being
a lock because the session lock already serializes every concurrent
`releaseRegistration` call for that session — by the time this read
runs, no other transaction touching this registration can be
interleaved, so there's nothing for a second lock to protect against.
**Do not "fix" this into a `FOR UPDATE`** — that would turn a
non-conflict into a real `OpenPlayNightSession`-before-
`OpenPlayNightRegistration` violation of the order below, for no
behavioral gain (the read is already correct).

**Canonical order, for any future code that needs more than one of
these locks on *existing* rows in one transaction** (top acquired
first):

1. `QueueEntry`
2. `GameAssignment`
3. `OpenPlayNightRegistration`
4. `PlayerTab`
5. `OpenPlayNightSession`

Ranked by contention breadth and lifetime — `QueueEntry` rows are
locked broadest (a whole date's WAITING pool) and live shortest;
`OpenPlayNightSession` is locked narrowest (one row) and lives longest
(a whole night). The existing chain (`PlayerTab` before
`OpenPlayNightSession`) matches this order.

**`completeAssignment`/`cancelAssignmentTx` locking `GameAssignment`
then touching `QueueEntry` looks like it violates the order above
(`QueueEntry` is ranked first) — verified safe, not just assumed.** A
`GameAssignment`'s participants are marked `PLAYING` (not `WAITING`) the
moment the assignment is *proposed* (`createAssignmentTx`, BUILD-SPEC.md
§7 rotation service), before it can ever reach `ACTIVE` or be
completed/cancelled. `proposeNextAssignment`'s `QueueEntry` lock query
is scoped to `status = 'WAITING'` — by construction, it can never select
a row that `completeAssignment`/`cancelAssignmentTx` might simultaneously
be touching (those rows are `PLAYING`, structurally excluded from the
`WHERE` clause). The two operations never contend for the same physical
row, so the nominal order mismatch cannot form a wait cycle. Similarly,
`proposeNextAssignment`'s own `GameAssignment` touch is always an
**INSERT of a brand-new row** — a row that didn't exist a moment ago
can't already be locked by any other transaction, so creating it is
exempt from ordering concerns entirely. The rule above governs locks on
*existing* rows only.

**This exception has a single load-bearing dependency — name it so it
can't be silently broken:** the safety of the order above rests entirely
on `createAssignmentTx` (private, called by `proposeNextAssignment`)
marking every participant's `QueueEntry.status` `PLAYING` **inside the
same transaction** that creates the `GameAssignment` row and inserts
those participants. If a future change ever splits proposal into two
phases — e.g. "tentatively select candidates in one transaction, create
the `GameAssignment` in a second, later one" — the `WAITING`→`PLAYING`
transition and the `GameAssignment` INSERT stop being atomic with each
other. That reopens the exact race this exception depends on being
closed: a `QueueEntry` could sit in an ambiguous state where a second
`proposeNextAssignment` call (still scoped to `WAITING`) and a
`completeAssignment`/`cancelAssignmentTx` call (already holding a
`GameAssignment` lock) end up contending for the same row after all —
at that point the nominal `GameAssignment`-before-`QueueEntry` order
becomes real and needs an actual lock, not this argument. The same
warning is repeated as a code comment directly on `proposeNextAssignment`
(BUILD-SPEC.md §7 rotation service) — §15 is not where someone
refactoring that method will be looking.

**Proof, not just reasoning:**
`player-tab.lock-order.concurrency.integration.ts` fires
`addRentalLineItem` and `addAdjustment` — the two different call paths
that share the one real two-table chain — concurrently against the same
tab, wrapped in an explicit timeout guard (10s) and a check for
Postgres's own deadlock-detection error code (40P01), not just an
implicit "the test finished." Passes 5/5 clean: neither hangs, neither
reports a real deadlock, and both charges land. This is a regression
guard for the *current* paths, not a static analyzer — if a future
change makes some new path acquire two of these locks in a genuinely
conflicting order on overlapping rows, it needs its own test in this
same shape; this one only proves what it exercises.

### Known tradeoff: `proposeNextAssignment` locks broader than the court it's filling

`proposeNextAssignment(date, courtId, ...)` takes a courtId, but the
lock it acquires — `SELECT ... FROM "QueueEntry" WHERE date = ... AND
status = 'WAITING' FOR UPDATE` — is scoped to the whole *date*, not the
court. Two proposals fired for two *different* courts on the same night
still serialize behind each other: the second blocks until the first's
transaction commits, even though they were never going to draw from
disjoint pools.

This is deliberate, not an oversight, and it's the fix that closed the
double-booking bug this exact test was written for
(`testProposalsNeverDoubleBook`,
open-play-rotation.concurrency.integration.ts): the whole reason two
concurrent proposals for different courts could double-book the same
player is that BOTH courts draw candidates from the SAME shared waiting
pool — a player waiting for a court doesn't belong to one court over
another until an assignment actually claims them. A lock scoped to
"only the rows this proposal ends up choosing" is exactly the thing that
can't be known in advance — the whole point of the lock is to make that
choice safe against a second reader. Narrowing it to per-court would
mean two concurrent proposals for different courts could once again both
read the same available player before either commits, reopening the
original bug.

The cost: on a busy night, a court freeing up cannot get its next
foursome proposed while a DIFFERENT court's proposal is mid-transaction
— proposals queue across the whole facility, not just per court. At one
small venue's scale (a handful of courts, a proposal transaction that's
a handful of fast local queries) this is very unlikely to be felt as
real latency. If this venue ever runs enough courts that this becomes a
measurable bottleneck, the fix is not "lock per court" — it would need
to be finer-grained pool partitioning that's still provably race-free
(e.g. only after a candidate foursome is tentatively selected, or by
skill-window partitioning if that ever becomes a stable enough boundary)
— not a smaller lock over the same shared pool. Documented here
specifically so a future optimization pass doesn't narrow this lock
without re-deriving why it's this wide in the first place.

### Postmortem: `settleTab`'s stale pre-transaction read

The bug: `settleTab` read `totalCents` via `getTabView` *before* its own
transaction opened, then trusted that value inside the transaction that
later claimed the row — no lock anywhere could protect a value computed
before the lock existed. It shipped in Phase 7 through review. The
general rule: any value a transaction acts on must be *read inside that
transaction*, not carried in from before it started — this generalizes
past `settleTab` to every transaction in this codebase.

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
- **Refund on a Fri/Sat no-show** — **resolved (§8):** non-refundable,
  no exceptions. A no-show is by definition past the cancel-before-
  cutoff window, so it never qualifies for credit either.
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
- **Cancellation and refund policy** — **resolved (§8):**
  non-refundable in cash, always. Cancelling at least 4 hours before
  session start converts the fee to open-play credit instead (never
  cash); cancelling later, or a no-show, forfeits it entirely. Staff-
  initiated refunds exist as a separate mechanism for the business's
  own errors (wrongly-rejected valid payment, double payment, a
  business-cancelled night) — not reachable through customer
  cancellation at all. Three sub-questions this raises are newly open,
  below (credit expiry/transferability/coverage).
- **No-show-rate baseline, before Phase 8 ships prepayment** — §9's
  Fri/Sat participation KPIs (`registrationsCount` vs. `checkedInCount`
  vs. `noShowCount`) make the no-show rate measurable for the first
  time. Record a real baseline from actual nights before Phase 8's
  GCash-prepayment requirement goes live — once prepayment is
  mandatory, the pre-prepayment comparison point is gone for good, and
  "did this policy actually reduce no-shows" becomes unanswerable.
- **GCash receiving limits** — a personal wallet has a monthly ceiling.
  Worth watching once volume picks up.
- **Open-play credit expiry** (§8) — does credit issued from a
  before-cutoff cancellation lapse? Proposed default: 90 days from
  issue. Not decided.
- **Open-play credit transferability** (§8) — usable by anyone, or
  tied to the phone number that registered? Proposed default: tied to
  the original phone, matching the existing returning-player lookup.
  Not decided.
- **Open-play credit coverage** (§8) — exactly one future ₱150
  registration in full, or could partial/fractional credit exist?
  Proposed default: exactly one registration, in full — matches the
  flat-fee shape of what's being credited. Not decided.
- **Fri/Sat ₱150 registration fee is real cash with no revenue tracking
  yet** — Phase 7 built tabs/settlement/sales for game and rental
  revenue only; the ₱150 fee is collected today (§8's cash-at-the-desk
  walk-in path) but doesn't appear on /dashboard/sales at all. A banner
  on that page says so. **Phase 8 must close this gap** as part of
  building the payment flow §8 already specifies — don't let the
  banner quietly become permanent. Remove the banner only once Phase 8
  actually records this revenue somewhere.
