import { describe, it, expect, afterEach } from "bun:test";
import { logger } from "./logger";

describe("logger", () => {
  const originalWrite = process.stdout.write.bind(process.stdout);

  afterEach(() => {
    process.stdout.write = originalWrite;
  });

  it("child() returns a logger that emits structured JSON", () => {
    const lines: string[] = [];
    process.stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
      if (typeof chunk === "string") lines.push(chunk);
      return originalWrite(chunk, ...(args as []));
    }) as typeof process.stdout.write;

    const child = logger.child({ component: "test" });
    child.info({ orderId: "o1" }, "placed");

    expect(lines.length).toBeGreaterThan(0);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.msg).toBe("placed");
    expect(parsed.level).toBe(30);
    expect(parsed.component).toBe("test");
  });
});
