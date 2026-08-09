import { NextResponse } from "next/server";

import { specialDisplayService } from "@/services/display/special-display.service";

// Owner request (2026-08-09): Special Open Play's own display feed —
// deliberately separate from /api/display and /api/tournament-display,
// zero shared code. Public, unauthenticated (a TV/kiosk screen can't
// stay signed in) — the shape is already scrubbed of anything sensitive
// (short names only, no phone/skill/payment).
export async function GET() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const data = await specialDisplayService.getDisplayData(today);

  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
