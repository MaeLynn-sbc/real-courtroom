import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

// Serves the local upload provider's PUBLIC files from disk, per request.
//
// Real incident (2026-08-21, and at least twice before): the GCash QR
// "disappeared" from the public site. Nothing was actually missing — the
// file was on disk and cms.gcashPaymentInfo pointed at it correctly. The
// problem was serving. LocalUploadService writes into public/uploads and
// returned /uploads/<name>, but Next.js indexes public/ at BUILD time, so
// a file that appears afterwards is never served. Confirmed on production
// by a clean split at the last build (2026-08-17 13:27 UTC):
//
//     uploaded Jul-28 -> 200      uploaded Aug-18 -> 404
//     uploaded Aug-14 -> 200      uploaded Aug-21 -> 404  (the live QR)
//
// So a public upload worked until someone replaced it, then stayed broken
// until the next deploy — which made it look intermittent and
// self-healing. It affected every public upload, not just the QR:
// tournament logos and CMS gallery images take the same path.
//
// The private-upload routes never had this bug because they already read
// from disk on each request (see app/api/expense-receipt/[key]/route.ts).
// This is that same shape for public files, minus the auth gate — these
// are deliberately public, exactly as they were when served statically.
//
// Deliberately NOT auth-gated and NOT `no-store`: a gallery image or a
// GCash QR on the public booking page must be readable by anonymous
// visitors, which is what upload()'s own interface comment already
// records as the distinction between upload() and uploadPrivate().

const UPLOADS_DIR = path.join(process.cwd(), "public", "uploads");

// The upload service names every file `${randomUUID()}${extension}` — so
// anything that isn't that shape did not come from us. An allowlist, not
// an escaping attempt: it makes traversal ("../../.env"), absolute paths
// and nested segments unrepresentable rather than merely filtered.
const SAFE_KEY = /^[0-9a-f-]{36}\.[a-z0-9]{1,5}$/i;

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;

  if (!SAFE_KEY.test(key)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  // Belt and braces on top of SAFE_KEY: resolve, then confirm the result
  // is still inside the uploads directory before reading anything.
  const filePath = path.resolve(UPLOADS_DIR, key);
  if (path.dirname(filePath) !== path.resolve(UPLOADS_DIR)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  let data: Buffer;
  try {
    data = await readFile(filePath);
  } catch {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": CONTENT_TYPES[path.extname(key).toLowerCase()] ?? "application/octet-stream",
      // Filenames are UUIDs, so a given name's bytes never change —
      // replacing an image always produces a new name. Safe to cache hard.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
