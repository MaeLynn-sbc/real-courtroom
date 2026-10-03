// Browser-side: turns a picked file into the { fileName, contentType,
// dataBase64 } shape every upload action takes.
//
// Reported live (2026-10-03): customers "can't push through" registering
// for open play or booking a court. nginx in front of the app was on its
// 1 MB default request-body limit, so any payment screenshot over ~750 KB
// (base64 adds a third) was refused with a 413 before reaching the app —
// 130 refusals across /open-play/register and /book in two weeks, each
// one auto-cancelling the customer's hold. nginx is fixed too
// (docs/DEPLOYMENT.md); this is the second layer: a phone screenshot or
// photo is scaled down and re-encoded as JPEG here, so the request stays
// a few hundred KB whatever the phone produced and no proxy limit
// matters. Still perfectly readable for staff verifying a GCash receipt.

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.8;
// Small files go up untouched — nothing to gain, and it keeps a crisp
// original whenever one is already cheap to send.
const COMPRESS_ABOVE_BYTES = 400 * 1024;
const DECODE_TIMEOUT_MS = 10_000;

export interface UploadPayload {
  fileName: string;
  contentType: string;
  dataBase64: string;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    const timer = setTimeout(() => {
      URL.revokeObjectURL(url);
      reject(new Error("Image decode timed out."));
    }, DECODE_TIMEOUT_MS);
    image.onload = () => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      reject(new Error("Image could not be decoded."));
    };
    image.src = url;
  });
}

async function compressImage(file: File): Promise<Blob | null> {
  const image = await loadImage(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }
  // JPEG has no transparency — paint white first so a transparent PNG
  // doesn't come out black.
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
}

function withJpegExtension(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "") || "upload";
  return `${base}.jpg`;
}

// Never fails because compression did: anything that can't be decoded
// (a PDF receipt, an unsupported format, a browser without canvas) goes
// up as the original file, exactly as before this existed.
export async function toUploadPayload(file: File, fallbackContentType = "image/png"): Promise<UploadPayload> {
  const original = { fileName: file.name, contentType: file.type || fallbackContentType };

  const isCompressible = file.type.startsWith("image/") && file.type !== "image/gif";
  if (isCompressible && file.size > COMPRESS_ABOVE_BYTES) {
    try {
      const compressed = await compressImage(file);
      if (compressed && compressed.size < file.size) {
        return {
          fileName: withJpegExtension(file.name),
          contentType: "image/jpeg",
          dataBase64: await blobToBase64(compressed),
        };
      }
    } catch {
      // Fall through to the original file.
    }
  }

  return { ...original, dataBase64: await blobToBase64(file) };
}
