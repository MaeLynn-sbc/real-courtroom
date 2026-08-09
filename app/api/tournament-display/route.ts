import { NextResponse } from "next/server";

import { tournamentDisplayService } from "@/services/display/tournament-display.service";

// Mirrors app/api/display/route.ts exactly — deliberately public, no
// auth, no slug param: the returned shape is already scrubbed of
// anything sensitive (no skill level, phone/email, payment state — see
// tournament-display.service.ts's own comment), so the endpoint itself
// needs no gate.
export async function GET() {
  const data = await tournamentDisplayService.getDisplayData();

  return NextResponse.json(data, {
    headers: {
      // Polled every few seconds by an unattended kiosk browser — never
      // let a browser or intermediate cache serve stale match state.
      "Cache-Control": "no-store",
    },
  });
}
