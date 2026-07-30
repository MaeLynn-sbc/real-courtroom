import type { Metadata } from "next";

import { PhoneDisplayClient } from "@/features/display/components/phone-display-client";
import { displayService } from "@/services/display/display.service";

export const metadata: Metadata = {
  title: "Who's Playing",
  // Same as /display/[slug] — meant for someone standing at (or heading
  // to) the venue with the link in hand, not for search results.
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

// A fixed, guessable path (unlike /display/[slug]'s unguessable one) is
// fine here: /api/display was already fully public and unauthenticated
// before this page existed (see that route's own comment) — this only
// adds a more-discoverable UI surface, not new data exposure. ?names=first
// requests the stricter, server-enforced name format this genuinely
// public URL needs — see display.service.ts's own comment on why
// client-side truncation alone wouldn't be enough.
export default async function PhoneDisplayPage() {
  const initialData = await displayService.getDisplayData({ nameFormat: "first" });

  return <PhoneDisplayClient initialData={initialData} />;
}
