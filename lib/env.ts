import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  AUTH_SECRET: z.string().min(1, "AUTH_SECRET is required"),
  AUTH_URL: z.string().min(1).optional(),
  FEATURE_PAYMENTS: z.string().default("false"),
  FEATURE_OPEN_PLAY: z.string().default("false"),
  FEATURE_TOURNAMENTS: z.string().default("false"),
  FEATURE_MEMBERSHIPS: z.string().default("false"),
  FEATURE_EQUIPMENT_RENTALS: z.string().default("false"),
  PAYMENT_PROVIDER: z.enum(["local"]).default("local"),
  EMAIL_PROVIDER: z.enum(["console"]).default("console"),
  UPLOAD_PROVIDER: z.enum(["local"]).default("local"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Validated before the logger exists (the logger itself reads env), so this
  // is the one deliberate exception to the "no console.log" rule in the app.
  console.error(
    "Invalid environment variables:",
    z.treeifyError(parsed.error),
  );
  throw new Error(
    "Invalid environment variables. Check .env against .env.example.",
  );
}

export const env = parsed.data;
