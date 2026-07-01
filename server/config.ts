import { z } from "zod";

const isTest = process.env.BUN_TEST === "1" || process.env.NODE_ENV === "test";

const EnvSchema = z.object({
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  UPSTASH_REDIS_URL: z.string().min(1).optional(),
  ANGELONE_MASTER_KEY: z.string().min(32, "ANGELONE_MASTER_KEY must be at least 32 chars").optional(),
  ANGELONE_API_KEY: z.string().min(8, "ANGELONE_API_KEY looks too short").optional(),
  ANGELONE_CLIENT_ID: z.string().min(4, "ANGELONE_CLIENT_ID looks too short").optional(),
  ANGELONE_PIN: z.string().regex(/^\d{4,8}$/, "ANGELONE_PIN must be 4-8 digits").optional(),
  ANGELONE_TOTP_SECRET: z.string().min(16, "ANGELONE_TOTP_SECRET looks too short").optional(),
  ALERT_WEBHOOK_URL: z.string().url().optional(),
  NSE_HOLIDAYS_JSON: z.string().optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.string().default("3000"),
});

export type AppConfig = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceKey: string;
  redisUrl: string;
  angeloneMasterKey: string;
  angeloneApiKey: string;
  angeloneClientId: string;
  angelonePin: string;
  angeloneTotpSecret: string;
  alertWebhookUrl?: string;
  nseHolidays: Date[];
  nodeEnv: "development" | "production" | "test";
  port: number;
};

let cached: AppConfig | undefined;

function requireEnv(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function getConfig(): AppConfig {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const d = parsed.data;
  if (isTest) {
    // Return safe test defaults — real values are injected by individual tests.
    cached = {
      supabaseUrl: d.SUPABASE_URL ?? "postgresql://test:test@localhost/test",
      supabaseAnonKey: d.SUPABASE_ANON_KEY ?? "test-anon-key",
      supabaseServiceKey: d.SUPABASE_SERVICE_ROLE_KEY ?? "test-service-key",
      redisUrl: d.UPSTASH_REDIS_URL ?? "redis://localhost:6379",
      angeloneMasterKey: d.ANGELONE_MASTER_KEY ?? "test-master-key-00000000000000000000000000000000",
      angeloneApiKey: d.ANGELONE_API_KEY ?? "test-api-key",
      angeloneClientId: d.ANGELONE_CLIENT_ID ?? "test-client",
      angelonePin: d.ANGELONE_PIN ?? "1234",
      angeloneTotpSecret: d.ANGELONE_TOTP_SECRET ?? "test-totp-secret-0000000000000000",
      alertWebhookUrl: d.ALERT_WEBHOOK_URL,
      nseHolidays: [],
      nodeEnv: "test",
      port: Number(d.PORT ?? "3000"),
    };
    return cached;
  }
  // Production / development — all values required.
  const holidays = d.NSE_HOLIDAYS_JSON
    ? (JSON.parse(d.NSE_HOLIDAYS_JSON) as string[]).map((s) => new Date(s))
    : [];
  cached = {
    supabaseUrl: requireEnv("SUPABASE_URL", d.SUPABASE_URL),
    supabaseAnonKey: requireEnv("SUPABASE_ANON_KEY", d.SUPABASE_ANON_KEY),
    supabaseServiceKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY", d.SUPABASE_SERVICE_ROLE_KEY),
    redisUrl: requireEnv("UPSTASH_REDIS_URL", d.UPSTASH_REDIS_URL),
    angeloneMasterKey: requireEnv("ANGELONE_MASTER_KEY", d.ANGELONE_MASTER_KEY),
    angeloneApiKey: requireEnv("ANGELONE_API_KEY", d.ANGELONE_API_KEY),
    angeloneClientId: requireEnv("ANGELONE_CLIENT_ID", d.ANGELONE_CLIENT_ID),
    angelonePin: requireEnv("ANGELONE_PIN", d.ANGELONE_PIN),
    angeloneTotpSecret: requireEnv("ANGELONE_TOTP_SECRET", d.ANGELONE_TOTP_SECRET),
    alertWebhookUrl: d.ALERT_WEBHOOK_URL,
    nseHolidays: holidays,
    nodeEnv: d.NODE_ENV,
    port: Number(d.PORT),
  };
  return cached;
}

export function resetConfigForTests(): void {
  cached = undefined;
}
