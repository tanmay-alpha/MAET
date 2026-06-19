import { z } from "zod";

const EnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  UPSTASH_REDIS_URL: z.string().min(1),
  ANGELONE_MASTER_KEY: z.string().min(32, "ANGELONE_MASTER_KEY must be at least 32 chars"),
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
  alertWebhookUrl?: string;
  nseHolidays: Date[];
  nodeEnv: "development" | "production" | "test";
  port: number;
};

let cached: AppConfig | undefined;

export function getConfig(): AppConfig {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const holidays = parsed.data.NSE_HOLIDAYS_JSON
    ? (JSON.parse(parsed.data.NSE_HOLIDAYS_JSON) as string[]).map((s) => new Date(s))
    : [];
  cached = {
    supabaseUrl: parsed.data.SUPABASE_URL,
    supabaseAnonKey: parsed.data.SUPABASE_ANON_KEY,
    supabaseServiceKey: parsed.data.SUPABASE_SERVICE_ROLE_KEY,
    redisUrl: parsed.data.UPSTASH_REDIS_URL,
    angeloneMasterKey: parsed.data.ANGELONE_MASTER_KEY,
    alertWebhookUrl: parsed.data.ALERT_WEBHOOK_URL,
    nseHolidays: holidays,
    nodeEnv: parsed.data.NODE_ENV,
    port: Number(parsed.data.PORT),
  };
  return cached;
}

export function resetConfigForTests(): void {
  cached = undefined;
}
