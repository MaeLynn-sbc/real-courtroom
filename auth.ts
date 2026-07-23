import bcrypt from "bcryptjs";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

import { authConfig } from "@/auth.config";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { peekRateLimit, recordRateLimitFailure } from "@/lib/rate-limit";

// Keyed by username only (not IP) — trusting a forwarded-for header without
// a known, deployment-specific trusted-proxy configuration risks a
// rate-limit bypass via a spoofed header, and username-keying already
// stops the most common pattern (credential stuffing against one account)
// regardless of source IP.
const LOGIN_RATE_LIMIT = 10;
const LOGIN_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;

const credentialsSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

// Login-history writes (v1.1) reuse the AuditLog table every other service
// already writes to — never allowed to block a login attempt, same
// try/catch-and-log-only pattern as every service's writeAuditLog.
async function writeLoginAuditLog(entry: {
  userId: string | null;
  action: "auth.login_succeeded" | "auth.login_failed";
  username: string;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: entry.userId,
        action: entry.action,
        entityType: "User",
        entityId: entry.userId,
        metadata: { username: entry.username },
      },
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to write login audit log");
  }
}

// v1.1: username/password only — no self-service OAuth signup, since
// employee accounts are admin-created only. Credentials-only auth needs no
// DB-backed adapter (Account/Session/VerificationToken stay in the schema
// but are unused at runtime, same as before under the JWT session
// strategy).
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (rawCredentials) => {
        const parsed = credentialsSchema.safeParse(rawCredentials);
        if (!parsed.success) {
          return null;
        }

        const username = parsed.data.username.toLowerCase();
        const rateLimitKey = `login:${username}`;
        const rateLimit = peekRateLimit(rateLimitKey, LOGIN_RATE_LIMIT, LOGIN_RATE_LIMIT_WINDOW_MS);
        if (!rateLimit.allowed) {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { username },
          include: { employee: true },
        });

        if (
          !user ||
          !user.passwordHash ||
          user.deletedAt ||
          (user.employee && !user.employee.isActive)
        ) {
          recordRateLimitFailure(rateLimitKey, LOGIN_RATE_LIMIT_WINDOW_MS);
          await writeLoginAuditLog({ userId: user?.id ?? null, action: "auth.login_failed", username });
          return null;
        }

        const passwordsMatch = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!passwordsMatch) {
          recordRateLimitFailure(rateLimitKey, LOGIN_RATE_LIMIT_WINDOW_MS);
          await writeLoginAuditLog({ userId: user.id, action: "auth.login_failed", username });
          return null;
        }

        await writeLoginAuditLog({ userId: user.id, action: "auth.login_succeeded", username });

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      const userId = user?.id ?? (typeof token.id === "string" ? token.id : undefined);

      if (!userId) {
        token.permissions = token.permissions ?? [];
        return token;
      }

      if (user || !token.role) {
        const dbUser = await prisma.user.findUnique({
          where: { id: userId },
          include: {
            role: { include: { permissions: { include: { permission: true } } } },
          },
        });

        token.id = userId;
        token.role = dbUser?.role ? dbUser.role.name : null;
        token.permissions = dbUser?.role
          ? dbUser.role.permissions.map((rolePermission) => rolePermission.permission.key)
          : [];
      }

      return token;
    },
    async session({ session, token }) {
      session.user.id = typeof token.id === "string" ? token.id : "";
      session.user.role = token.role ?? null;
      session.user.permissions = token.permissions ?? [];
      return session;
    },
  },
});
