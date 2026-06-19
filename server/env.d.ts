declare namespace NodeJS {
  interface ProcessEnv {
    SUPABASE_URL?: string;
    SUPABASE_ANON_KEY?: string;
    SUPABASE_SERVICE_ROLE_KEY?: string;
    UPSTASH_REDIS_URL?: string;
    ANGELONE_MASTER_KEY?: string;
    ALERT_WEBHOOK_URL?: string;
    NSE_HOLIDAYS_JSON?: string;
    NODE_ENV?: "development" | "production" | "test";
    PORT?: string;
  }
}
