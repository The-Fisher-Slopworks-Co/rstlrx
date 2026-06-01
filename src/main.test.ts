import { test, expect } from "bun:test";
import { join } from "node:path";

// The CLI entry runs on import (top-level `await main()`), so it can't be
// imported into a test. Drive it as a subprocess instead and assert the exit
// code / stderr — the same contract clap enforced.
const MAIN = join(import.meta.dir, "main.ts");

async function runCli(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([process.execPath, "run", MAIN, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { code, stdout, stderr };
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

// `--version` / `-V` mirror clap's auto-version: print `<bin> <version>` (the
// version sourced from package.json, as clap sources `CARGO_PKG_VERSION`) to
// stdout and exit 0. Honored in any position, like `--help`. `-V` is clap's
// auto-derived short for version.
test.each(["--version", "-V"])(
  "%s prints the version to stdout and exits 0",
  async (flag) => {
    const { version } = await import("../package.json");
    const { code, stdout } = await runCli([flag]);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe(`rstlrx ${version}`);
  },
);
