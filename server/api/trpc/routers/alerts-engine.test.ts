import { describe, expect, it } from "bun:test";
import { alertsEngineRouter } from "./alerts-engine";

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
