/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** "1" builds the synthetic-data demo frontend (banner, synthetic quote labels). */
  readonly VITE_MAET_DEMO_MODE?: string;
}

declare module "*.css?url" {
  const url: string;
  export default url;
}
