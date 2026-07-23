"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setBusinessInfoAction } from "@/actions/cms.actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { BusinessInfo } from "@/features/cms/schemas/cms.schema";

const FIELDS: { key: keyof BusinessInfo; label: string; placeholder?: string }[] = [
  { key: "name", label: "Business name" },
  { key: "phone", label: "Contact number" },
  { key: "email", label: "Email" },
  { key: "address", label: "Address" },
  { key: "hours", label: "Operating hours", placeholder: "Mon–Sun, 6:00 AM – 10:00 PM" },
  { key: "facebookUrl", label: "Facebook link" },
  { key: "mapsUrl", label: "Google Maps link" },
];

export function BusinessInfoPanel({ businessInfo }: { businessInfo: BusinessInfo }) {
  const router = useRouter();
  const [values, setValues] = useState(businessInfo);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    startTransition(async () => {
      const result = await setBusinessInfoAction(values);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Business info saved.");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Business information</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {FIELDS.map((field) => (
          <div key={field.key} className="flex flex-col gap-1.5">
            <Label htmlFor={field.key}>{field.label}</Label>
            {field.key === "address" ? (
              <Textarea
                id={field.key}
                rows={2}
                value={values[field.key]}
                onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}
              />
            ) : (
              <Input
                id={field.key}
                placeholder={field.placeholder}
                value={values[field.key]}
                onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}
              />
            )}
          </div>
        ))}
        <Button type="button" size="sm" disabled={isPending} onClick={handleSave} className="self-start">
          {isPending ? "Saving…" : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}
