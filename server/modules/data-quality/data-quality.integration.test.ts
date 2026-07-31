import { describe, expect, it } from "bun:test";
import { assertAdmin } from "./service";

describe("Data Quality & Admin Authorization Integration Test Suite", () => {
  it("1. Rejects non-admin user context with FORBIDDEN error", () => {
    const regularUser = { userId: "user-123", isAdmin: false, userRole: "user" };
    expect(() => assertAdmin(regularUser as any)).toThrow("Admin authorization required");
  });

  it("2. Allows authenticated admin user context", () => {
    const adminUser = { userId: "user-admin", isAdmin: true, userRole: "admin" };
    expect(() => assertAdmin(adminUser as any)).not.toThrow();
  });
});
