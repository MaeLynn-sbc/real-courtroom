"use server";

import { revalidatePath } from "next/cache";

import {
  bookingCommunicationSettingsSchema,
  type BookingCommunicationSettings,
  type GcashPaymentInfo,
} from "@/features/cms/schemas/cms.schema";
import { requirePermission } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { settingsService } from "@/services/settings/settings.service";
import { getUploadService } from "@/services/upload/upload-service.factory";
import { PERMISSIONS } from "@/types/permissions";

export interface PaymentSettingsActionState {
  error: string | null;
}

export interface GcashPaymentInfoActionState extends PaymentSettingsActionState {
  info?: GcashPaymentInfo;
}

function requireSystemAdmin() {
  return requirePermission(
    PERMISSIONS.SYSTEM_ADMIN,
    "You don't have permission to manage payment settings.",
  );
}

// Phase 8 Gate 2 (BUILD-SPEC.md §8, §15 "Owner-only payment settings —
// enforced server-side"). This is the ONLY way to flip the public
// prepayment switch — same SYSTEM_ADMIN tier every other owner-only
// setting in this codebase already uses (payment methods, CMS, module
// toggles), not a new, stricter check invented just for this one.
export async function setBookingRequirePrepaymentAction(
  value: boolean,
): Promise<PaymentSettingsActionState> {
  const authz = await requireSystemAdmin();
  if (!authz.ok) {
    return { error: authz.error };
  }

  try {
    await settingsService.setBookingRequirePrepayment(value, authz.userId);
    revalidatePath("/book");
    revalidatePath("/dashboard/bookings");
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, {
        action: "setBookingRequirePrepaymentAction",
        userId: authz.userId,
      }),
    };
  }
}

// Owner-editable hold window (settingsService.getBookingHoldMinutes,
// default 30) — a public booking's unpaid slot reservation before it
// must be paid. Bounds: at least 5 minutes (anything shorter isn't
// realistically enough time to open GCash and send money), at most
// 240 (the old hardcoded value, kept as an explicit ceiling so this
// can't be misconfigured back into "hold the slot most of the day").
const MIN_HOLD_MINUTES = 5;
const MAX_HOLD_MINUTES = 240;

export async function setBookingHoldMinutesAction(
  value: number,
): Promise<PaymentSettingsActionState> {
  const authz = await requireSystemAdmin();
  if (!authz.ok) {
    return { error: authz.error };
  }

  if (!Number.isInteger(value) || value < MIN_HOLD_MINUTES || value > MAX_HOLD_MINUTES) {
    return {
      error: `Hold window must be a whole number between ${MIN_HOLD_MINUTES} and ${MAX_HOLD_MINUTES} minutes.`,
    };
  }

  try {
    await settingsService.setBookingHoldMinutes(value, authz.userId);
    revalidatePath("/book");
    revalidatePath("/dashboard/admin/settings");
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "setBookingHoldMinutesAction", userId: authz.userId }),
    };
  }
}

const MAX_QR_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_QR_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

// Owner decision: ONE static GCash QR, uploaded once, shown to every
// customer — not a per-booking dynamic QR. Uses the PUBLIC upload()
// method (same one gallery images use), not uploadPrivate() — this
// image must be directly, publicly servable to an unauthenticated
// customer on the payment step, unlike a payment-proof screenshot
// (uploadPrivate, proxied through an authenticated route). Same
// SYSTEM_ADMIN tier as every other owner-only payment setting.
export async function uploadGcashQrAction(
  formData: FormData,
): Promise<GcashPaymentInfoActionState> {
  const authz = await requireSystemAdmin();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const accountName = String(formData.get("accountName") ?? "").trim();
  const accountNumber = String(formData.get("accountNumber") ?? "").trim();
  const file = formData.get("file");

  const current = await settingsService.getGcashPaymentInfo();
  let qrImageUrl = current.qrImageUrl;

  if (file instanceof File && file.size > 0) {
    if (!ALLOWED_QR_IMAGE_TYPES.has(file.type)) {
      return { error: "Only PNG, JPEG, or WebP images are allowed." };
    }
    if (file.size > MAX_QR_IMAGE_BYTES) {
      return { error: "Image must be 5MB or smaller." };
    }
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const result = await getUploadService().upload({
        fileName: file.name,
        contentType: file.type,
        data: buffer,
      });
      qrImageUrl = result.url;
    } catch (error) {
      return {
        error: toActionError(error, { action: "uploadGcashQrAction", userId: authz.userId }),
      };
    }
  }

  try {
    const info: GcashPaymentInfo = { qrImageUrl, accountName, accountNumber };
    await settingsService.setGcashPaymentInfo(info, authz.userId);
    revalidatePath("/dashboard/admin/settings");
    revalidatePath("/book");
    revalidatePath("/open-play/register");
    return { error: null, info };
  } catch (error) {
    return { error: toActionError(error, { action: "uploadGcashQrAction", userId: authz.userId }) };
  }
}

// Owner decision (2026-08-03): every customer-facing string mentioning
// timing/contact channel/phone number must be owner-editable, not
// hardcoded — same SYSTEM_ADMIN tier as every other owner-only payment/
// communication setting on this page.
export async function setBookingCommunicationSettingsAction(
  input: BookingCommunicationSettings,
): Promise<PaymentSettingsActionState> {
  const authz = await requireSystemAdmin();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = bookingCommunicationSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid settings." };
  }

  try {
    await settingsService.setBookingCommunicationSettings(parsed.data, authz.userId);
    revalidatePath("/dashboard/admin/settings");
    revalidatePath("/book");
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, {
        action: "setBookingCommunicationSettingsAction",
        userId: authz.userId,
      }),
    };
  }
}
