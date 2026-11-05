import { describe, expect, it } from "bun:test";
import { DrizzleQueryError } from "drizzle-orm";
import { AlertStateError } from "../../../modules/alerts/repository";
import { alertsEngineRouter, toAlertMutationError } from "./alerts-engine";

const caller = alertsEngineRouter.createCaller({
  userId: "00000000-0000-0000-0000-000000000001",
  email: "test@example.com",
  role: "user",
});

describe("Alerts Engine Router Contract Suite", () => {
  it("1. Rejects unsupported alert types (e.g. RSI_ABOVE) with BAD_REQUEST", async () => {
    await expect(
      caller.createAlert({
        symbol: "RELIANCE",
        config: {
          type: "RSI_ABOVE" as any,
          threshold: 70,
        },
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("2. Rejects legacy frontend types (e.g. volume_spike, indicator) with BAD_REQUEST", async () => {
    await expect(
      caller.createAlert({
        symbol: "TCS",
        config: {
          type: "volume_spike" as any,
          threshold: 100000,
        },
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });

    await expect(
      caller.createAlert({
        symbol: "TCS",
        config: {
          type: "indicator" as any,
          threshold: 50,
        },
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("3. Rejects non-finite threshold values (NaN, Infinity) with BAD_REQUEST", async () => {
    await expect(
      caller.createAlert({
        symbol: "INFY",
        config: {
          type: "PRICE_ABOVE",
          threshold: NaN,
        },
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });

    await expect(
      caller.createAlert({
        symbol: "INFY",
        config: {
          type: "PRICE_ABOVE",
          threshold: Infinity,
        },
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("4. Rejects decimal threshold for VOLUME_ABOVE with BAD_REQUEST", async () => {
    await expect(
      caller.createAlert({
        symbol: "HDFCBANK",
        config: {
          type: "VOLUME_ABOVE",
          threshold: 50000.5,
        },
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("5. Rejects invalid UUID inputs for rearmAlert, toggleAlert, markNotificationRead, dismissNotification", async () => {
    await expect(caller.rearmAlert({ alertId: "invalid-uuid" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });

    await expect(caller.toggleAlert({ alertId: "invalid-uuid", enabled: true })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });

    await expect(caller.markNotificationRead({ notificationId: "invalid-uuid" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });

    await expect(caller.dismissNotification({ notificationId: "invalid-uuid" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});

describe("alert mutation error mapping", () => {
  it("maps alert state errors to BAD_REQUEST with their message", () => {
    const err = toAlertMutationError(new AlertStateError("Cannot rearm unsupported legacy alert type: RSI_ABOVE"), "rearm");
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.message).toBe("Cannot rearm unsupported legacy alert type: RSI_ABOVE");
  });

  it("maps unexpected (database) errors to INTERNAL_SERVER_ERROR without their message, keeping the cause", () => {
    const dbError = new DrizzleQueryError('update "alerts" set "enabled" = $1 where "id" = $2', [true, "secret-id"], new Error("deadlock detected"));
    const err = toAlertMutationError(dbError, "toggle");
    expect(err.code).toBe("INTERNAL_SERVER_ERROR");
    expect(err.message).toBe("Failed to toggle alert");
    expect(err.message).not.toContain("secret-id");
    expect(err.cause).toBe(dbError);
  });
});
