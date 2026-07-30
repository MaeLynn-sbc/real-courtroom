"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { uploadGcashQrAction } from "@/actions/payment-settings.actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { GcashPaymentInfo } from "@/features/cms/schemas/cms.schema";
import { cn } from "@/lib/utils";

// Owner decision: ONE static GCash QR, shown to every customer on the
// public payment step (see uploadGcashQrAction's own comment). Account
// name/number are required text; the QR image itself is optional on
// each save — leaving the file input empty keeps whatever image is
// already stored, so an owner can fix a typo'd account name without
// re-uploading the QR every time.
export function GcashPaymentInfoPanel({ info }: { info: GcashPaymentInfo }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [accountName, setAccountName] = useState(info.accountName);
  const [accountNumber, setAccountNumber] = useState(info.accountNumber);
  const [previewUrl, setPreviewUrl] = useState<string | null>(info.qrImageUrl);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      setPreviewUrl(URL.createObjectURL(file));
      setSelectedFileName(file.name);
    }
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!accountName.trim() || !accountNumber.trim()) {
      toast.error("Enter both the GCash account name and number.");
      return;
    }

    startTransition(async () => {
      const formData = new FormData();
      formData.set("accountName", accountName.trim());
      formData.set("accountNumber", accountNumber.trim());
      const file = fileInputRef.current?.files?.[0];
      if (file) {
        formData.set("file", file);
      }

      const result = await uploadGcashQrAction(formData);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("GCash payment info saved.");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setSelectedFileName(null);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>GCash payment info</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          {previewUrl ? (
            <Image
              src={previewUrl}
              alt="GCash QR code"
              width={160}
              height={160}
              unoptimized
              className="rounded-lg border"
            />
          ) : (
            <p className="text-muted-foreground text-xs">No QR code uploaded yet.</p>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="gcashQrFile">QR code image</Label>
            {/* Same fix as the public payment-proof upload fields: a raw
                Input type="file" relies on file:text-foreground fighting
                the browser's own native ::file-selector-button chrome,
                which can leave the button text nearly invisible. Hidden
                here, replaced with a label styled via this app's real
                button tokens plus a status span this component controls. */}
            <div className="flex items-center gap-3">
              <label htmlFor="gcashQrFile" className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "cursor-pointer")}>
                Choose file
              </label>
              <span className="text-muted-foreground truncate text-sm">
                {selectedFileName ?? "No new file selected"}
              </span>
            </div>
            <input
              id="gcashQrFile"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              ref={fileInputRef}
              onChange={handleFileChange}
            />
            <p className="text-muted-foreground text-xs">
              PNG, JPEG, or WebP, up to 5MB. Leave empty to keep the current image.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="gcashAccountName">Account name</Label>
            <Input
              id="gcashAccountName"
              value={accountName}
              onChange={(event) => setAccountName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="gcashAccountNumber">Account number</Label>
            <Input
              id="gcashAccountNumber"
              value={accountNumber}
              onChange={(event) => setAccountNumber(event.target.value)}
            />
          </div>
          <Button type="submit" size="sm" disabled={isPending} className="self-start">
            {isPending ? "Saving…" : "Save"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
