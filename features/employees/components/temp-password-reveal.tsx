"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

interface TempPasswordRevealProps {
  password: string;
  onDismiss: () => void;
}

// Shown exactly once, right after employeeService.createEmployee/
// resetPassword returns a plaintext temp password — the caller never gets
// another chance to see it (only its hash persists). onDismiss is the
// admin's explicit "I've given this to the employee" acknowledgement, not
// an auto-timeout, since a timed dismissal risks losing it before it's
// been copied down.
export function TempPasswordReveal({ password, onDismiss }: TempPasswordRevealProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(password);
    setCopied(true);
  }

  return (
    <div className="border-warning bg-warning/10 flex flex-col gap-3 rounded-lg border p-4">
      <div>
        <p className="text-sm font-medium">Temporary password — shown once</p>
        <p className="text-muted-foreground text-xs">
          Give this to the employee now. It won&apos;t be shown again — resetting generates a new one.
          They&apos;ll be required to change it at their first login.
        </p>
      </div>
      <code className="bg-card text-card-foreground rounded-md border px-3 py-2 text-center font-mono text-lg tracking-wider">
        {password}
      </code>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button type="button" size="sm" onClick={onDismiss}>
          I&apos;ve saved this password
        </Button>
      </div>
    </div>
  );
}
