import { env } from "@/lib/env";
import { LocalUploadService } from "@/services/upload/local-upload.service";
import { SpacesUploadService } from "@/services/upload/spaces-upload.service";
import type { UploadService } from "@/services/upload/upload-service.interface";

let cachedService: UploadService | undefined;

export function getUploadService(): UploadService {
  if (cachedService) {
    return cachedService;
  }

  // *** SWAP POINT (deploy) *** — no application code outside this file
  // changes when the provider changes; lib/env.ts's UPLOAD_PROVIDER
  // selects which implementation this factory hands back.
  switch (env.UPLOAD_PROVIDER) {
    case "local":
      cachedService = new LocalUploadService();
      break;
    case "spaces":
      cachedService = new SpacesUploadService();
      break;
    default:
      throw new Error(`Unsupported UPLOAD_PROVIDER: ${env.UPLOAD_PROVIDER}`);
  }

  return cachedService;
}
