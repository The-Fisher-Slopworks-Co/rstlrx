import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse, stringify } from "smol-toml";

import { configDir } from "./dirs";
import type { RomanizeLang, RomanizeMode } from "./romanize";

export interface Config {
  style_before: string;
  style_current: string;
  style_after: string;
  color_before?: string;
  color_current?: string;
  color_after?: string;
  ignore_errors: boolean;
  merge_queue: boolean;
  romanize: RomanizeMode;
  romanize_lang: RomanizeLang;
  padding_before: number;
  padding_after: number;
}

export function defaultConfig(): Config {
  return {
    style_before: "faint",
    style_current: "bold",
    style_after: "faint",
    ignore_errors: false,
    merge_queue: false,
    romanize: "off",
    romanize_lang: "auto",
    padding_before: 0,
    padding_after: 0,
  };
}

export function storagePath(): string {
  const dir = configDir();
  if (dir === null) {
    throw new Error("cannot determine config directory");
  }
  return join(dir, "rstlrx", "config.toml");
}

export function loadConfig(): Config {
  const path = storagePath();
  let data: string;
  try {
    data = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") {
      return defaultConfig();
    }
    throw new Error(`cannot read ${path}`, { cause: err });
  }
  try {
    const parsed = parse(data) as unknown as Partial<Config>;
    return { ...defaultConfig(), ...parsed };
  } catch (err) {
    throw new Error(`cannot parse ${path}`, { cause: err });
  }
}

export function saveConfig(c: Config): string {
  const path = storagePath();
  mkdirSync(dirname(path), { recursive: true });
  const out: Config = { ...c };
  if (out.color_before == null) delete out.color_before;
  if (out.color_current == null) delete out.color_current;
  if (out.color_after == null) delete out.color_after;
  writeFileSync(path, stringify(out));
  return path;
}
