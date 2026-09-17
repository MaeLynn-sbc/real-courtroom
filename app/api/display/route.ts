import { NextRequest, NextResponse } from "next/server";

import { displayService } from "@/services/display/display.service";
import { settingsService } from "@/services/settings/settings.service";

// BUILD-SPEC.md §12: "Enforce by excluding the fields from /api/display
// entirely, not by omitting them in the template." displayService's
// return shape has no skillLevel/phone/email/payment field to omit in
// the first place — nothing here selects them off the database, so
// there's nothing a future card redesign could accidentally render.
//
// Deliberately public, no auth, no slug param: the unguessable slug on
// /display/[slug] gates discovery of the *page*; this data is already
// scrubbed of anything sensitive, so the endpoint itself needs no
// gate — matching the reference design's own
// `fetch('/api/display')` call, unparameterized.
//
// ?names=first — the mobile /phone view's genuinely public URL (no
// unguessable slug, unlike /display/[slug]) needs a stricter privacy
// bound than the TV kiosk's "First L." format. Since this endpoint is
// unauthenticated, its raw JSON is directly fetchable by anyone
// regardless of what any page renders — a client-side truncation on
// /phone would hide the last initial from a casual glance but not from
// someone reading the network response directly, so the format is
// decided here, before a name ever leaves the server. Omitting the
// param (the TV's own poll) keeps today's "First L." behavior exactly
// as it was.
export async function GET(request: NextRequest) {
  const nameFormat = request.nextUrl.searchParams.get("names") === "first" ? "first" : "initial";
  // /rtv asks with screen=rtv, and the server decides whether that is
  // live open play or practice (owner switch on the Practice page), so an
  // open TV follows the switch on its next poll. /tv never passes it.
  const practice =
    request.nextUrl.searchParams.get("screen") === "rtv" && (await settingsService.getPracticeTakeoverRtv());
  const data = await displayService.getDisplayData({ nameFormat, practice });

  return NextResponse.json(data, {
    headers: {
      // Polled every 10-30s by unattended kiosk/phone browsers — never
      // let a browser or intermediate cache serve stale court state.
      "Cache-Control": "no-store",
    },
  });
}
