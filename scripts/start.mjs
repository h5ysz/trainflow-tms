// Starts the standalone production server.
//
// Replaces `NODE_ENV=production bun ... | tee server.log`, which relied on POSIX env-var
// prefix syntax, `bun` and `tee` — none of which work in cmd.exe, so `npm start` was
// unusable on Windows. Node runs the standalone server directly; logs go to stdout, where
// the host (Render, systemd, Docker) can collect them.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const server = join(process.cwd(), ".next", "standalone", "server.js");

if (!existsSync(server)) {
  console.error("✗ .next/standalone/server.js not found. Run `npm run build` first.");
  process.exit(1);
}

const child = spawn(process.execPath, [server], {
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "production" },
});

// Forward termination signals so the container/process manager can stop us cleanly.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0));
});
