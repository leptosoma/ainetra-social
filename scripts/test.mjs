import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parse } from "dotenv";

const env = { ...process.env, ...parse(readFileSync(".env.test")) };
const commands = [
  ["node_modules/prisma/build/index.js", "migrate", "deploy"],
  ["node_modules/vitest/vitest.mjs", "run"],
];

for (const args of commands) {
  const result = spawnSync(process.execPath, args, { env, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
