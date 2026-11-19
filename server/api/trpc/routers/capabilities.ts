/**
 * Capabilities tRPC Router.
 *
 * Exposes the canonical feature-flag state for every advanced product feature.
 * The frontend uses this to decide whether to render, hide, or show an honest
 * unavailable state.
 */

import { createRouter, publicProcedure } from "../core";
import { evaluateReadiness } from "../../../modules/capabilities/readiness";
import { isDemoMode } from "../../../modules/demo/mode";

export const capabilitiesRouter = createRouter({
  /**
   * Returns the canonical state of every declared capability based on env flags,
   * database schema readiness, authentication, and role authorization, and whether this
   * deployment serves the synthetic demo dataset (MAET_DEMO_MODE).
   */
  get: publicProcedure.query(async ({ ctx }) => {
    const capabilities = await evaluateReadiness({
      userId: ctx.userId,
      email: ctx.email,
      role: ctx.role,
    });
    return { capabilities, demoMode: isDemoMode() };
  }),
});