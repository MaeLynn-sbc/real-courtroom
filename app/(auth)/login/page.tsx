import type { Metadata } from "next";

import { LoginForm } from "@/features/auth/components/login-form";

export const metadata: Metadata = {
  title: "Sign in",
};

interface LoginPageProps {
  searchParams: Promise<{ callbackUrl?: string; passwordChanged?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { callbackUrl, passwordChanged } = await searchParams;

  return (
    <div className="flex flex-col gap-3">
      {passwordChanged === "1" ? (
        <p className="text-success text-sm" role="status">
          Password changed. Sign in with your new password.
        </p>
      ) : null}
      <LoginForm callbackUrl={callbackUrl ?? "/dashboard"} />
    </div>
  );
}
