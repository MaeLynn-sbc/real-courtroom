import bcrypt from "bcryptjs";

import type { ChangePasswordInput } from "@/features/auth/schemas/change-password.schema";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

// Same cost factor as employee.service.ts's PASSWORD_HASH_COST and
// prisma/seed.ts's Owner password hash — kept as its own constant rather
// than importing that one, since this is a genuinely separate module
// (self-service account actions vs. admin employee management), not a
// shared dependency between them.
const PASSWORD_HASH_COST = 12;

export class AccountService {
  // Self-service only — the caller must already know their current
  // password, unlike employeeService.resetPassword (an admin overriding
  // it unilaterally with no such check). Always clears mustChangePassword
  // and bumps passwordChangedAt, which is also what invalidates this
  // user's other active sessions (see auth.ts's jwt() callback) — the
  // caller (actions/account.actions.ts) signs this session out too right
  // after, so every session including this one ends up needing a fresh
  // login with the new password.
  async changePassword(userId: string, input: ChangePasswordInput): Promise<{ ok: true } | { ok: false; error: string }> {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

    if (!user.passwordHash || !(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
      return { ok: false, error: "Current password is incorrect." };
    }

    const passwordHash = await bcrypt.hash(input.newPassword, PASSWORD_HASH_COST);

    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: false, passwordChangedAt: new Date() },
    });

    await this.writeAuditLog(userId);

    return { ok: true };
  }

  private async writeAuditLog(userId: string): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          userId,
          action: "user.password_changed",
          entityType: "User",
          entityId: userId,
        },
      });
    } catch (error) {
      logger.error({ err: error, userId }, "Failed to write audit log entry for user.password_changed");
    }
  }
}

export const accountService = new AccountService();
