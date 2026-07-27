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
  // Local dev (LocalUploadService) has no real object storage to sign a
  // URL against — see that class for exactly what it does instead, and
  // why that's a documented stand-in, not a real access-control
  // mechanism. SpacesUploadService (services/upload/spaces-upload.service.ts)
  // generates a genuinely time-limited, cryptographically signed URL via
  // the AWS S3 SDK (Spaces is S3-compatible) — not currently called from
  // anywhere in the app (every real proof/receipt screenshot is served
  // through an authenticated proxy route calling get() instead), but
  // implemented for interface completeness and any future caller that
  // wants a direct, time-limited link instead of proxying bytes through
  // the app server.
  getSignedUrl(key: string, options?: { expiresInSeconds?: number }): Promise<string>;
}
