import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl as presignS3Url } from "@aws-sdk/s3-request-presigner";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import type {
  UploadFileInput,
  UploadPrivateResult,
  UploadResult,
  UploadService,
} from "@/services/upload/upload-service.interface";

// DigitalOcean Spaces swap-point implementation — Spaces is S3-compatible,
// so the standard AWS SDK works against it unmodified once pointed at
// Spaces' own regional endpoint (SPACES_ENDPOINT) with `forcePathStyle:
// false` (Spaces, like S3, expects the bucket in the hostname, not the
// path). Only constructed when UPLOAD_PROVIDER=spaces — lib/env.ts's
// superRefine already guarantees every SPACES_* var below is present by
// the time this class is ever instantiated, so no further null-checking
// of them happens here.
//
// Public vs private mirrors LocalUploadService's own split exactly:
// upload() writes with a public-read ACL under a "public/" prefix and
// returns a directly-servable URL (today's one caller: CMS gallery
// images); uploadPrivate() writes with a private ACL under a
// "private/" prefix and is only ever retrievable through get() — never
// a direct URL — so a payment-proof screenshot can't be reached by
// guessing its path, matching the interface's own documented contract.
export class SpacesUploadService implements UploadService {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;

  constructor() {
    const endpoint = env.SPACES_ENDPOINT!;
    const region = env.SPACES_REGION!;
    this.bucket = env.SPACES_BUCKET!;
    this.client = new S3Client({
      endpoint,
      region,
      forcePathStyle: false,
      credentials: {
        accessKeyId: env.SPACES_KEY!,
        secretAccessKey: env.SPACES_SECRET!,
      },
    });
    // e.g. "https://sgp1.digitaloceanspaces.com" -> "https://<bucket>.sgp1.digitaloceanspaces.com"
    const endpointUrl = new URL(endpoint);
    this.publicBaseUrl = `${endpointUrl.protocol}//${this.bucket}.${endpointUrl.host}`;
  }

  async upload(input: UploadFileInput): Promise<UploadResult> {
    const extension = path.extname(input.fileName);
    const key = `public/${randomUUID()}${extension}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: input.data,
        ContentType: input.contentType,
        ACL: "public-read",
      }),
    );

    logger.info({ key, contentType: input.contentType }, "File uploaded to Spaces (public)");

    return { url: `${this.publicBaseUrl}/${key}`, path: key };
  }

  async uploadPrivate(input: UploadFileInput): Promise<UploadPrivateResult> {
    const extension = path.extname(input.fileName);
    const key = `private/${randomUUID()}${extension}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: input.data,
        ContentType: input.contentType,
        ACL: "private",
      }),
    );

    logger.info({ contentType: input.contentType }, "Private file uploaded to Spaces");

    return { key };
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const bytes = await result.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : null;
    } catch (error) {
      // Duck-typed check, matching this codebase's established
      // isUniqueConstraintViolation-style convention elsewhere — avoids
      // importing the SDK's NoSuchKey error class just to check a name.
      if (error && typeof error === "object" && "name" in error && error.name === "NoSuchKey") {
        return null;
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async getSignedUrl(key: string, options?: { expiresInSeconds?: number }): Promise<string> {
    return presignS3Url(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: options?.expiresInSeconds ?? 900,
    });
  }
}
