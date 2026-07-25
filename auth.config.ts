import type { NextAuthConfig } from "next-auth";

// Edge-safe subset of the Auth.js config — imported by middleware.ts (Edge
// runtime). Must never import Prisma, bcrypt, or lib/logger. The Credentials
// provider's real authorize() (Node-only) is added on top of this in auth.ts.
export const authConfig = {
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: {
    strategy: "jwt",
  },
  trustHost: true,
  providers: [],
  callbacks: {
    // Pure token -> session shaping, no DB access — must live here (not only
    // in auth.ts) because middleware.ts builds its own NextAuth(authConfig)
    // instance for the Edge runtime. Without this callback here too,
    // middleware would decode a JWT that already has role/permissions but
    // never copy them onto session.user, so every permission check would
    // silently see an empty permissions array.
    session({ session, token }) {
      session.user.id = typeof token.id === "string" ? token.id : "";
      session.user.role = token.role ?? null;
      session.user.permissions = token.permissions ?? [];
      session.user.mustChangePassword = token.mustChangePassword ?? false;
      return session;
    },
  },
} satisfies NextAuthConfig;
