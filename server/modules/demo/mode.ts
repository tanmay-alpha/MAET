/**
 * Demo mode: MAET_DEMO_MODE=1 marks a deployment that serves the synthetic demo dataset
 * (server/scripts/seed-demo.ts). The capabilities endpoint reports it so the frontend shows a
 * permanent "synthetic data" banner and labels every quote as synthetic.
 */
export function isDemoMode(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.MAET_DEMO_MODE?.trim().toLowerCase();
  return value === "1" || value === "true";
}
