import type { Metadata } from "next";

import { auth } from "@/auth";
import { ChangePasswordForm } from "@/features/auth/components/change-password-form";

export const metadata: Metadata = {
  title: "Change password",
};

export default async function ChangePasswordPage() {
  const session = await auth();

  return (
    <div className="mx-auto w-full max-w-md">
      <ChangePasswordForm forced={Boolean(session?.user.mustChangePassword)} />
    </div>
  );
}
