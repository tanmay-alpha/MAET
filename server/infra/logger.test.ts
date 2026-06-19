import { describe, it, expect } from "bun:test";
import { logger } from "./logger";

describe("logger", () => {
  it("child() returns a logger that emits structured JSON", () => {
    const lines: string[] = [];
    const stream = {
      write(s: string) {
        lines.push(s);
        return true;
      },
    };
    const child = logger.child({ component: "test" });
    // Swap the destination stream
    (child as any)[Symbol.for("pino.stream")] = stream;
    child.info({ orderId: "o1" }, "placed");
    expect(lines.length).toBeGreaterThan(0);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.msg).toBe("placed");
    expect(parsed.level).toBe(30);
    expect(parsed.component).toBe("test");
  });
});