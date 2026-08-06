import { z } from "zod";

export const homepageHeroSchema = z.object({
  title: z.string().min(1, "Enter a hero title.").max(100),
  subtitle: z.string().max(300),
  ctaText: z.string().min(1, "Enter a button label.").max(40),
  imageUrl: z.string().max(500).nullable(),
});

export type HomepageHero = z.infer<typeof homepageHeroSchema>;

export const businessInfoSchema = z.object({
  name: z.string().min(1, "Enter a business name.").max(200),
  phone: z.string().max(50),
  email: z.string().max(200),
  address: z.string().max(300),
  hours: z.string().max(300),
  facebookUrl: z.string().max(300),
  mapsUrl: z.string().max(500),
});

export type BusinessInfo = z.infer<typeof businessInfoSchema>;

export const otherRateLineSchema = z.object({
  label: z.string().min(1, "Enter a label.").max(120),
  priceText: z.string().min(1, "Enter a price.").max(60),
});

export type OtherRateLine = z.infer<typeof otherRateLineSchema>;

export const otherRatesSchema = z.array(otherRateLineSchema).max(50);

export const galleryImageSchema = z.object({
  url: z.string().min(1),
  alt: z.string().max(200),
});

export type GalleryImage = z.infer<typeof galleryImageSchema>;

export const galleryImagesSchema = z.array(galleryImageSchema).max(50);

// Owner decision: ONE static GCash QR image, shown to every customer —
// no per-booking dynamic QR. accountName/accountNumber are shown right
// alongside the QR (a customer scanning wrong, or paying by manually
// searching the account, needs both).
export const gcashPaymentInfoSchema = z.object({
  qrImageUrl: z.string().max(500).nullable(),
  accountName: z.string().max(200),
  accountNumber: z.string().max(50),
});

export type GcashPaymentInfo = z.infer<typeof gcashPaymentInfoSchema>;

// Owner decision (2026-08-03): every customer-facing string that
// mentions timing, contact channel, or the phone number must be
// configurable, not hardcoded — so a confirmation-window promise or a
// channel that changes later (e.g. SMS provider swapped, hours
// changed) never needs a code deploy to fix. {phone} is the only
// placeholder substituted at render time (the booking's own guestPhone)
// — deliberately not court/date/time, which already have their own
// dedicated summary line above this text, not embedded in prose.
export const bookingCommunicationSettingsSchema = z.object({
  // Optional: Semaphore's own default sender ("SEMAPHORE") is used
  // whenever this is empty — a CUSTOM sender name requires Semaphore's
  // approval first (services/sms/semaphore-sms.service.ts's own
  // comment). Never required to have real SMS sending working.
  smsSenderName: z.string().max(20).optional(),
  // {reference}/{shortCode}/{court}/{date}/{time}/{duration}
  // placeholders, substituted by whatever sends this (services/sms/ once
  // wired — confirmed not yet connected to any actual send call, unlike
  // the 3 hardcoded payment-proof SMS templates in booking-payment-proof.
  // service.ts, which already use {shortCode}). Sender reads "SEMAPHORE"
  // by default, so the body must self-identify — see the default
  // value's own "The Courtroom Kalibo:" lead-in.
  smsConfirmationTemplate: z.string().min(1, "Enter a confirmation message.").max(320),
  // Shown on the booking confirmation page once a screenshot is
  // uploaded — {phone} substituted with the booking's own guestPhone.
  pageConfirmationCopy: z.string().min(1, "Enter the confirmation page copy.").max(500),
});

export type BookingCommunicationSettings = z.infer<typeof bookingCommunicationSettingsSchema>;

// Plain "HH:MM" 24-hour time. "00:00" is a valid value everywhere this is
// used — for courtCloseTimes specifically it doubles as a sentinel (see
// courtHoursSchema below), not a real midnight cutoff.
const timeStringSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM format.");

// BUILD-SPEC.md §0. Fixed weekday keys "0"-"6" (Sun-Sat, Date#getDay()
// convention) — z.record needs string keys, JSON can't hold numeric ones.
const weekdayTimesSchema = z.record(z.enum(["0", "1", "2", "3", "4", "5", "6"]), timeStringSchema);

export const courtHoursSchema = z.object({
  facilityOpenTime: timeStringSchema,
  // The building's own closing time per weekday — a hard cap independent
  // of any court's individual cutoff below (BUILD-SPEC.md §0 "Facility
  // close is a PUBLIC limit, not a data limit"). Default 23:00 every day.
  facilityCloseTimes: weekdayTimesSchema,
  fridaySaturdayCloseTime: timeStringSchema,
  // Keyed by court name. "00:00" means "no per-court cutoff" — the court
  // is bookable right up to facilityCloseTimes for that weekday. It's a
  // sentinel, not a real midnight cutoff (BUILD-SPEC.md §0).
  courtCloseTimes: z.record(z.string(), timeStringSchema),
  // BUILD-SPEC.md §0 "Business date vs calendar date" — the hour at which
  // a new business day starts for reporting purposes (default 3AM), so a
  // session that runs past midnight still reports under the night it
  // started. See lib/business-date.ts.
  businessDateRolloverHour: z.number().int().min(0).max(23),
});

export type CourtHoursSettings = z.infer<typeof courtHoursSchema>;

// BUILD-SPEC.md §6/§7 owner settings for open play operations.
export const openPlaySettingsSchema = z.object({
  // BUILD-SPEC.md §6 "No-shows... default 30." A Fri/Sat registration not
  // checked in within this many minutes of session start is released.
  noShowReleaseMinutes: z.number().int().positive(),
  // BUILD-SPEC.md §7 "Starvation guard... default 20." Any waiting player
  // past this many minutes is force-anchored on the next court regardless
  // of skill fit.
  maxWaitMinutes: z.number().int().positive(),
  // BUILD-SPEC.md §7 "skill distance 1 of the anchor" — starting candidate
  // skill-level distance before widening to 2, then any level.
  skillWindow: z.number().int().min(0),
  // BUILD-SPEC.md §7 "An owner setting controls whether proposals
  // auto-confirm after N seconds." Off by default — this app has no
  // scheduler, so "after N seconds" isn't implemented; this flag is a
  // placeholder for when/if that becomes worth building.
  autoConfirmProposals: z.boolean(),
  // BUILD-SPEC.md §7 "informational, default 15" — not enforced anywhere,
  // shown to staff as a rough target only.
  targetGameMinutes: z.number().int().positive(),
  // BUILD-SPEC.md §9 "Weeknight (Mon-Thu): ₱35 x games played." Snapshotted
  // onto each weeknight PlayerTab at creation — a price change here never
  // rewrites an already-open tab's rate.
  weeknightGameRateCents: z.number().int().nonnegative(),
  // Open-play online self-registration, Gate 2 review follow-up: how many
  // days before a Fri/Sat session online registration opens for it. A
  // submission for a date further out than this is rejected with a clear
  // "opens on <date>" reason (services/open-play/public-open-play-
  // registration.service.ts), not silently treated as invalid input.
  // Distinct from onlineRegistrationEnabled (settings.service.ts) —
  // that's a hard on/off gate; this is a rolling window on top of it,
  // owner-editable, not hardcoded.
  onlineRegistrationLeadTimeDays: z.number().int().positive(),
  // Gate 2 review follow-up (BUILD-SPEC.md §9): the Fri/Sat walk-in
  // registration fee, real cash collected at the desk since Phase 7,
  // now actually recorded as a Sale (registerWalkIn) instead of being
  // invisible to sales reporting. Same "snapshotted at creation, a rate
  // change never rewrites history" shape as weeknightGameRateCents
  // above — not that this needs a snapshot column anywhere, since the
  // Sale itself is created (and its amountCents fixed) at registration
  // time, not read again later.
  friSatRegistrationFeeCents: z.number().int().nonnegative(),
  // Manual timer/announce (reported live): staff now decide when a
  // court's 15-minute clock starts, not the assignment itself — but a
  // distracted attendant can leave a court proposed-and-forgotten while
  // players wait and the waitlist backs up. After this many minutes with
  // no Start Timer press, the TV display and the rotation screen flag
  // that court as waiting to start. Purely a read-time comparison against
  // GameAssignment.proposedAt (no scheduler exists in this app, and this
  // doesn't need one) — see display.service.ts.
  forgottenAssignmentNudgeMinutes: z.number().int().positive(),
  // Global fallback for the closed-registration message shown on every
  // public open-play surface when a Fri/Sat night is blocked
  // (onlineRegistrationBlocked) and has no per-date override
  // (OpenPlayNightSession.closedMessage). Resolved by
  // resolveOpenPlayClosedMessage (lib/open-play-closed-message.ts).
  closedRegistrationMessage: z.string().max(200),
});

export type OpenPlaySettings = z.infer<typeof openPlaySettingsSchema>;
