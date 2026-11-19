/**
 * Demo mode: MAET_DEMO_MODE=1 marks a deployment that serves the synthetic demo dataset
 * (server/scripts/seed-demo.ts); `capabilities.get` reports it as `demoMode` for API consumers.
 * The frontend's banner follows its separate build-time flag, VITE_MAET_DEMO_MODE=1.
 * Quote labels always follow the observation's own source, not either deployment flag.
 */
export function isDemoMode(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.MAET_DEMO_MODE?.trim().toLowerCase();
  return value === "1" || value === "true";
}
