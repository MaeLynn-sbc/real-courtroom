import { NextResponse } from "next/server";

import { displayService } from "@/services/display/display.service";

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
export async function GET() {
  const data = await displayService.getDisplayData();

  return NextResponse.json(data, {
    headers: {
      // Polled every 30s by an unattended kiosk browser — never let a
      // browser or intermediate cache serve stale court state.
      "Cache-Control": "no-store",
    },
  });
}
