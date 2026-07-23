"use server";

import { AuthError } from "next-auth";

import { signIn } from "@/auth";
import { loginSchema } from "@/features/auth/schemas/login.schema";

export interface LoginActionState {
  error: string | null;
}

export async function loginAction(
  _prevState: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const parsed = loginSchema.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: "Enter a valid username and password." };
  }

  const callbackUrl = formData.get("callbackUrl");
  const redirectTo =
    typeof callbackUrl === "string" && callbackUrl.startsWith("/") ? callbackUrl : "/dashboard";

  try {
    await signIn("credentials", {
      username: parsed.data.username,
      password: parsed.data.password,
      redirectTo,
    });
    return { error: null };
  } catch (error) {
    if (error instanceof AuthError) {
      switch (error.type) {
        case "CredentialsSignin":
          return { error: "Invalid username or password." };
        default:
          return { error: "Unable to sign in. Please try again." };
      }
    }

    // NEXT_REDIRECT (thrown by signIn on success) and any other error must
    // propagate so Next.js can complete the redirect / surface the failure.
    throw error;
  }
}
