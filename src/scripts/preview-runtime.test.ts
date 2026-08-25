import { describe, expect, test } from "bun:test";
import path from "node:path";

describe("preview script", () => {
  test("starts the generated local server when launched from Bun on Windows", async () => {
    const port = 18_000 + Math.floor(Math.random() * 1_000);
    const origin = `http://127.0.0.1:${port}`;
    const child = Bun.spawn(
      [process.execPath, "run", "scripts/preview.ts", "--host", "127.0.0.1", "--port", String(port)],
      { cwd: path.resolve(import.meta.dir, ".."), stdout: "ignore", stderr: "ignore" },
    );

    try {
      const deadline = Date.now() + 90_000;
      let response: Response | undefined;

      while (Date.now() < deadline && !response) {
        const result = await Promise.race([
          fetch(origin, { signal: AbortSignal.timeout(500) }).catch(() => undefined),
          child.exited.then(() => undefined),
          Bun.sleep(250).then(() => undefined),
        ]);

        if (result instanceof Response) {
          response = result;
        } else if (await Promise.race([child.exited.then(() => true), Bun.sleep(0).then(() => false)])) {
          break;
        }
      }

      expect(response?.status).toBe(200);
      const terminal = await fetch(`${origin}/terminal`);
      expect(await terminal.text()).toContain("Net Asset Value");
    } finally {
      child.kill();
      await child.exited;
    }
  }, 100_000);
});
