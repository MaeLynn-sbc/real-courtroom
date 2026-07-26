import { env } from "@/lib/env";
import { LocalUploadService } from "@/services/upload/local-upload.service";
import type { UploadService } from "@/services/upload/upload-service.interface";

let cachedService: UploadService | undefined;

export function getUploadService(): UploadService {
  if (cachedService) {
    return cachedService;
  }

  // *** SWAP POINT (deploy) *** — Digital Ocean Spaces isn't provisioned
  // yet. When it is: add "spaces" to UPLOAD_PROVIDER's enum in lib/env.ts,
  // add a SpacesUploadService implementing UploadService (all four
  // methods, including the private-upload/get/delete/getSignedUrl quartet
  // added for Phase 8 — see upload-service.interface.ts), and a case here.
  // No application code outside this file changes.
  switch (env.UPLOAD_PROVIDER) {
    case "local":
      cachedService = new LocalUploadService();
      break;
    default:
      throw new Error(`Unsupported UPLOAD_PROVIDER: ${env.UPLOAD_PROVIDER}`);
  }

  return cachedService;
}
