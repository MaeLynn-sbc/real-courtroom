import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/action-auth";
import { getUploadService } from "@/services/upload/upload-service.factory";
import { PERMISSIONS } from "@/types/permissions";

// Mirrors app/api/booking-payment-proof/[key]/route.ts exactly — staff-
// only, same reason: a GCash screenshot must never be reachable at a
// guessable-but-unauthenticated static path.
export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const authz = await requirePermission(
    PERMISSIONS.OPEN_PLAY_MANAGE,
    "You don't have permission to view payment verification screenshots.",
  );
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: 403 });
  }

  const { key } = await params;
  const data = await getUploadService().get(key);
  if (!data) {
    return NextResponse.json({ error: "Screenshot not found." }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": sniffImageContentType(data),
      "Cache-Control": "private, no-store",
    },
  });
}

function sniffImageContentType(data: Buffer): string {
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return "image/png";
  }
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }
  return "application/octet-stream";
}
