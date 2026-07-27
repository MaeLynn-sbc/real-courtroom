import QRCode from "qrcode";

// Shared by every QR code this app generates (booking check-in, TV
// display setup, open-play registration, ...) — one encoding call, one
// set of visual defaults, so a new QR need is never a reason to pull in
// the `qrcode` package a second way. Server-only.
export async function generateQrCodeDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, { margin: 1, width: 240 });
}
