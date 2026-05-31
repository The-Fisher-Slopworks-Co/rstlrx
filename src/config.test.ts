import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parse } from "smol-toml";

import {
  type Config,
  defaultConfig,
  loadConfig,
  saveConfig,
  storagePath,
} from "./config";

// `storagePath` resolves through `dirs.configDir()`, which on linux honors an
// absolute `XDG_CONFIG_HOME`. We point it at a fresh temp dir per test so the
// real user config is never touched.
let tmp: string;
let prevXdg: string | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "rstlrx-"));
  prevXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = tmp;
});

afterEach(() => {
  if (prevXdg === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = prevXdg;
  }
  rmSync(tmp, { recursive: true, force: true });
});

test("default config has the documented defaults", () => {
  expect(defaultConfig()).toEqual({
    style_before: "faint",
    style_current: "bold",
    style_after: "faint",
    ignore_errors: false,
    merge_queue: false,
    romanize: "off",
    romanize_lang: "auto",
    padding_before: 0,
    padding_after: 0,
  });
});

test("storage path ends with rstlrx/config.toml under the config dir", () => {
  expect(storagePath()).toBe(join(tmp, "rstlrx", "config.toml"));
});

test("load returns defaults when no config file exists", () => {
  expect(loadConfig()).toEqual(defaultConfig());
});

test("save then load round-trips the config", () => {
  const cfg: Config = {
    style_before: "italic",
    style_current: "bold,underline",
    style_after: "dim",
    color_before: "red",
    color_current: "#ff5500",
    color_after: "245",
    ignore_errors: true,
    merge_queue: true,
    romanize: "duplicate",
    romanize_lang: "zh",
    padding_before: 2,
    padding_after: 3,
  };
  const written = saveConfig(cfg);
  expect(written).toBe(storagePath());
  expect(loadConfig()).toEqual(cfg);
});

test("save omits absent color_* keys but keeps present ones", () => {
  const cfg: Config = { ...defaultConfig(), color_current: "blue" };
  const path = saveConfig(cfg);
  const parsed = parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  expect("color_before" in parsed).toBe(false);
  expect("color_after" in parsed).toBe(false);
  expect(parsed.color_current).toBe("blue");
});

test("load merges a partial file over defaults", () => {
  // Write a partial TOML file directly (only two keys present) and confirm the
  // absent keys fall back to defaults, mirroring serde's `#[serde(default)]`.
  const path = storagePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, 'romanize = "inline"\npadding_after = 5\n');
  const loaded = loadConfig();
  expect(loaded.romanize).toBe("inline");
  expect(loaded.padding_after).toBe(5);
  // Keys absent from the file keep their defaults.
  expect(loaded.style_current).toBe("bold");
  expect(loaded.color_before).toBeUndefined();
});
