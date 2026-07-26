import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/action-auth";
import { getUploadService } from "@/services/upload/upload-service.factory";
import { PERMISSIONS } from "@/types/permissions";

// Gate 3: the authenticated route LocalUploadService.getSignedUrl's dev
// stand-in points at (services/upload/local-upload.service.ts). Staff-
// only — this is the whole reason payment-proof screenshots go through
// uploadPrivate() instead of the pre-existing public upload(): a GCash
// screenshot must never be reachable at a guessable-but-unauthenticated
// static path the way /public/uploads files are.
export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const authz = await requirePermission(
    PERMISSIONS.BOOKINGS_MANAGE,
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
      // Staff-only, permission-checked on every request above — never let
      // an intermediate cache (browser or otherwise) serve a stale copy
      // to a since-de-permissioned viewer.
      "Cache-Control": "private, no-store",
    },
  });
}

// The storage interface doesn't round-trip contentType (services/upload/
// upload-service.interface.ts's uploadPrivate only returns a key) —
// sniffing magic bytes for the two formats a phone screenshot will
// realistically ever be is simpler than threading contentType through
// storage as a second piece of metadata for this one route.
function sniffImageContentType(data: Buffer): string {
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return "image/png";
  }
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }
  return "application/octet-stream";
}
