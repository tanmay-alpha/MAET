import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const build = Bun.spawn([process.execPath, "run", "vite", "build"], {
  cwd: projectDir,
  env: { ...process.env, NODE_ENV: "production" },
  stdout: "inherit",
  stderr: "inherit",
});

process.exit(await build.exited);
