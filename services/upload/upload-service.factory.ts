import { env } from "@/lib/env";
import { LocalUploadService } from "@/services/upload/local-upload.service";
import type { UploadService } from "@/services/upload/upload-service.interface";

let cachedService: UploadService | undefined;

export function getUploadService(): UploadService {
  if (cachedService) {
    return cachedService;
  }

  switch (env.UPLOAD_PROVIDER) {
    case "local":
      cachedService = new LocalUploadService();
      break;
    default:
      throw new Error(`Unsupported UPLOAD_PROVIDER: ${env.UPLOAD_PROVIDER}`);
  }

  return cachedService;
}
