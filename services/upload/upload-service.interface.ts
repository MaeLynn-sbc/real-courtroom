export interface UploadFileInput {
  fileName: string;
  contentType: string;
  data: Buffer;
}

export interface UploadResult {
  url: string;
  path: string;
}

// Phase 8 plumbing (BUILD-SPEC.md §8): a private-file counterpart to
// upload() above. upload() is untouched — its one existing caller
// (actions/cms.actions.ts, gallery images) always wants a directly-
// servable public url, and always will. GCash payment-proof screenshots
// must NOT be servable that way — retrieval has to go through get()/
// getSignedUrl() so a real backend can gate access, instead of sitting
// at a guessable-but-unauthenticated static path the way upload() files
// do. A visibility flag on the existing upload() would have made every
// existing call site need to reason about a distinction that, for them,
// never varies — a second, narrowly-named method is less surface, not
// more, for the one thing that actually needs it.
export interface UploadPrivateResult {
  // The swappable-storage identifier — pass this to get()/delete()/
  // getSignedUrl(). Never a directly-usable URL.
  key: string;
}

export interface UploadService {
  upload(input: UploadFileInput): Promise<UploadResult>;
  uploadPrivate(input: UploadFileInput): Promise<UploadPrivateResult>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  // *** SWAP POINT ***
  // Local dev (LocalUploadService) has no real object storage to sign a
  // URL against — see that class for exactly what it does instead, and
  // why that's a documented stand-in, not a real access-control
  // mechanism. A Digital Ocean Spaces (or equivalent) implementation
  // added at deploy generates a genuinely time-limited, cryptographically
  // signed URL directly from the provider's SDK — no change needed
  // anywhere that calls getSignedUrl(), only a new class here plus a new
  // case in upload-service.factory.ts (same shape as this file's upload()
  // already established for UPLOAD_PROVIDER).
  getSignedUrl(key: string, options?: { expiresInSeconds?: number }): Promise<string>;
}
