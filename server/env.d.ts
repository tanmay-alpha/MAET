declare namespace NodeJS {
  interface ProcessEnv {
    SUPABASE_URL?: string;
    SUPABASE_ANON_KEY?: string;
    SUPABASE_SERVICE_ROLE_KEY?: string;
    UPSTASH_REDIS_URL?: string;
    ANGELONE_MASTER_KEY?: string;
    ANGELONE_API_KEY?: string;
    ANGELONE_CLIENT_ID?: string;
    ANGELONE_PIN?: string;
    ANGELONE_TOTP_SECRET?: string;
    ALERT_WEBHOOK_URL?: string;
    NSE_HOLIDAYS_JSON?: string;
    NODE_ENV?: "development" | "production" | "test";
    PORT?: string;
    VITE_API_URL?: string;
    GIT_SHA?: string;
    FRONTEND_ORIGIN?: string;
    DATABASE_URL?: string;
    POSTGRES_URL?: string;
  }
}
