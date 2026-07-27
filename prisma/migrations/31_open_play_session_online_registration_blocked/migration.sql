-- Date-specific online-registration blockout for a single
-- OpenPlayNightSession — independent of the feature-wide switch and
-- the per-day-of-week default (e.g. "this particular Friday is a
-- tournament night, no online registration" even though Fridays are
-- normally open). Defaults false so every existing session keeps its
-- current behavior.
ALTER TABLE "OpenPlayNightSession" ADD COLUMN "onlineRegistrationBlocked" BOOLEAN NOT NULL DEFAULT false;
