import { generateBookingCheckInQrCode } from "@/services/booking/qr-code";

interface BookingQrCodeProps {
  token: string;
}

// A base64 data: URL is generated server-side, not a remote asset — next/image
// doesn't optimize data URLs anyway, so a plain <img> is the correct choice.
export async function BookingQrCode({ token }: BookingQrCodeProps) {
  const dataUrl = await generateBookingCheckInQrCode(token);

  return (
    // eslint-disable-next-line @next/next/no-img-element -- data: URL, not an optimizable remote image
    <img
      src={dataUrl}
      alt="Booking check-in QR code"
      width={240}
      height={240}
      className="rounded-lg border"
    />
  );
}
