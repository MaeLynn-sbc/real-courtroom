export interface UploadFileInput {
  fileName: string;
  contentType: string;
  data: Buffer;
}

export interface UploadResult {
  url: string;
  path: string;
}

export interface UploadService {
  upload(input: UploadFileInput): Promise<UploadResult>;
}
