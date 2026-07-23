import type { DefaultSession } from "next-auth";

// v1.1: roles are no longer a fixed enum-like set (see the Roles
// workspace — an Owner can create arbitrary new roles from the
// database), so this widens from the old `SystemRoleName | null` to a
// plain string — the role's `name` column, whatever it is.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string | null;
      permissions: string[];
    } & DefaultSession["user"];
  }
}

// NextAuth's callback types import JWT from "@auth/core/jwt" internally;
// "next-auth/jwt" only re-exports it via `export *`, which does not merge
// declaration augmentations, so this must target the original module.
declare module "@auth/core/jwt" {
  interface JWT {
    id?: string;
    role?: string | null;
    permissions?: string[];
  }
}
