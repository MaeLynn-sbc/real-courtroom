-- Open-play online self-registration, Gate 1 follow-up (BUILD-SPEC.md
-- §6). Answers "how does the app decide capacity nights are Fri/Sat":
-- hardcoded (OPEN_PLAY_DAYS_OF_WEEK in open-play-capacity.service.ts,
-- plus a DB CHECK constraint — migration 11/12). This migration does NOT
-- touch that. It adds a narrower, separate, owner-editable question:
-- which of those (already-hardcoded) capacity nights also offer ONLINE
-- registration. Defaults true for the existing Friday/Saturday rows —
-- see the column's comment in schema.prisma for why true is the correct
-- default here even though the feature-wide switch (settingsService.
-- getOpenPlayOnlineRegistrationEnabled, migration 21) defaults false.
-- This migration changes zero existing behavior on its own: nothing
-- reads this column yet, same "plumbing only" shape as migration 21.

-- AlterTable
ALTER TABLE "OpenPlayCapacityDefault" ADD COLUMN     "onlineRegistrationEnabled" BOOLEAN NOT NULL DEFAULT true;
