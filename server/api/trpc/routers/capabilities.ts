/**
 * Capabilities tRPC Router.
 *
 * Exposes the canonical feature-flag state for every advanced product feature.
 * The frontend uses this to decide whether to render, hide, or show an honest
 * unavailable state.
 */

import { createRouter, publicProcedure } from "../core";
import { evaluateCapabilities } from "../../../modules/capabilities";

export const capabilitiesRouter = createRouter({
  /**
   * Returns the canonical state of every declared capability.
   *
   * Authenticated callers see authenticated features enabled when the schema
   * is available. Anonymous callers see only features that do not require
   * user data.
   */
  get: publicProcedure.query(({ ctx }) => {
    const hasAuthenticatedSession = typeof ctx.userId === "string" && ctx.userId.length > 0;
    return {
      capabilities: evaluateCapabilities({
        hasAuthenticatedSession,
        schemaAvailable: true,
      }),
    };
  }),
});