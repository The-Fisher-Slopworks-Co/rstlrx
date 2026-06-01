import { test, expect } from "bun:test";
import { join } from "node:path";

// The CLI entry runs on import (top-level `await main()`), so it can't be
// imported into a test. Drive it as a subprocess instead and assert the exit
// code / stderr — the same contract clap enforced.
const MAIN = join(import.meta.dir, "main.ts");

async function runCli(
  args: string[],
): Promise<{ code: number; stderr: string }> {
  const proc = Bun.spawn([process.execPath, "run", MAIN, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  const stderr = await new Response(proc.stderr).text();
  return { code, stderr };
}

// `--port` is a clap `u16`; values > 65535 are not a valid TCP port and clap
// rejects them. The hand-rolled parser must do the same: stderr + exit 2, before
// any login flow runs (so this never touches the network).
test("login --port above the u16 range is rejected with exit 2", async () => {
  const { code, stderr } = await runCli([
    "login",
    "--client-id",
    "x",
    "--client-secret",
    "y",
    "--port",
    "70000",
  ]);
  expect(code).toBe(2);
  expect(stderr).toContain("70000 is not in 0..=65535");
});
