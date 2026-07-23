import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { logger } from "@/lib/logger";
import type {
  UploadFileInput,
  UploadResult,
  UploadService,
} from "@/services/upload/upload-service.interface";

const UPLOADS_DIR = path.join(process.cwd(), "public", "uploads");

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
}
