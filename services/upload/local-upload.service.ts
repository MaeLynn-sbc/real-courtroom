import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { logger } from "@/lib/logger";
import type {
  UploadFileInput,
  UploadPrivateResult,
  UploadResult,
  UploadService,
} from "@/services/upload/upload-service.interface";

const UPLOADS_DIR = path.join(process.cwd(), "public", "uploads");

// Phase 8 plumbing: deliberately OUTSIDE `public/` — anything under
// `public/` is served unconditionally by Next.js regardless of
// application-level auth, which is exactly wrong for a GCash payment-
// proof screenshot. `.gitignore`'d, same as `public/uploads`'s own
// runtime-only content.
const PRIVATE_UPLOADS_DIR = path.join(process.cwd(), "storage", "private-uploads");

// Dev implementation: writes to /public/uploads. Interface-shaped so a
// Cloudinary (or similar) implementation is a drop-in later — swap
// UPLOAD_PROVIDER + upload-service.factory.ts without touching call sites.
export class LocalUploadService implements UploadService {
  async upload(input: UploadFileInput): Promise<UploadResult> {
    await mkdir(UPLOADS_DIR, { recursive: true });

    const extension = path.extname(input.fileName);
    const fileName = `${randomUUID()}${extension}`;
    const filePath = path.join(UPLOADS_DIR, fileName);

    await writeFile(filePath, input.data);

    const result: UploadResult = {
      url: `/uploads/${fileName}`,
      path: filePath,
    };

    logger.info(
      { fileName, contentType: input.contentType },
      "File uploaded to local dev storage",
    );

    return result;
  }

  async uploadPrivate(input: UploadFileInput): Promise<UploadPrivateResult> {
    await mkdir(PRIVATE_UPLOADS_DIR, { recursive: true });

    const extension = path.extname(input.fileName);
    const key = `${randomUUID()}${extension}`;
    await writeFile(this.resolvePrivatePath(key), input.data);

    logger.info(
      { contentType: input.contentType },
      "Private file uploaded to local dev storage",
    );

    return { key };
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.resolvePrivatePath(key));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolvePrivatePath(key), { force: true });
  }

  // Dev stand-in, not a real access-control mechanism — local disk has
  // no concept of a signed, time-limited URL. Returns the key-based path
  // an authenticated app route resolves (that route is Gate 3's
  // verification-screen work, not built here — this method exists now so
  // the interface is exercisable end-to-end in dev without waiting for a
  // real Spaces account). The interface's `options.expiresInSeconds` has
  // nothing to apply to here, so it's omitted rather than accepted and
  // ignored — fewer parameters than the interface declares is a valid
  // implementation, same as any JS/TS callback.
  async getSignedUrl(key: string): Promise<string> {
    return `/api/booking-payment-proof/${encodeURIComponent(key)}`;
  }

  private resolvePrivatePath(key: string): string {
    return path.join(PRIVATE_UPLOADS_DIR, key);
  }
}
