import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2).filter((arg) => arg !== "--");

function option(name: string, fallback: string): string {
  const equals = args.find((arg) => arg.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const port = option("--port", process.env.PORT ?? "8080");
const host = option("--host", process.env.HOST ?? "127.0.0.1");
const env = {
  ...process.env,
  MAET_NITRO_PRESET: "node-server",
  PORT: port,
  HOST: host,
};

console.log(`[preview] building local Node server for http://${host}:${port}`);
const build = Bun.spawn(["bun", "run", "build"], {
  cwd: projectDir,
  env,
  stdout: "inherit",
  stderr: "inherit",
});
const buildCode = await build.exited;
if (buildCode !== 0) process.exit(buildCode);

const entry = path.join(projectDir, ".output", "server", "index.mjs");
console.log(`[preview] starting ${entry}`);
const server = Bun.spawn(["node", entry], {
  cwd: projectDir,
  env,
  stdout: "inherit",
  stderr: "inherit",
});
process.on("SIGINT", () => server.kill());
process.on("SIGTERM", () => server.kill());
process.exit(await server.exited);
