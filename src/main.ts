#!/usr/bin/env bun

import { parseArgs } from "node:util";

import { loadConfig, saveConfig, type Config } from "./config";
import { LrclibProvider } from "./lyrics/lrclib";
import type { LyricsProvider } from "./lyrics";
import { SpotifyAuth } from "./player/spotify/auth";
import { SpotifyPlayer } from "./player/spotify";
import type { Player } from "./player";
import { TuiRenderer } from "./renderer/tui";
import type { Renderer } from "./renderer";
import { startSync, type SyncConfig } from "./sync";
import { initRomanizer } from "./romanize";
import type { RomanizeLang, RomanizeMode } from "./romanize";

const USAGE = `Terminal lyrics viewer synced with Spotify

Usage: rstlrx [OPTIONS]
       rstlrx login --client-id <ID> --client-secret <SECRET> [--port <PORT>]

Commands:
  login  Authenticate with Spotify

Options:
      --style-before <STYLE>    Style for lines before current (bold,italic,underline,faint; default: faint)
      --style-current <STYLE>   Style for the current line (default: bold)
      --style-after <STYLE>     Style for lines after current (default: faint)
      --color-before <COLOR>    Color for lines before current (named, #hex, or ANSI 0-255)
      --color-current <COLOR>   Color for the current line
      --color-after <COLOR>     Color for lines after current
      --ignore-errors           Suppress error display in the UI
      --merge-queue             Show lyrics for upcoming tracks as a continuous scroll
      --romanize <MODE>         Romanize CJK characters: inline, duplicate, current-only
      --romanize-lang <LANG>    Language for romanization: zh, ja, ko, auto
      --padding-before <N>      Number of empty lines before the current line
      --padding-after <N>       Number of empty lines after the current line
      --save-config             Save the resulting flag values to the config file as the new defaults
  -h, --help                    Print help`;

// A usage error mirrors clap's parse failures: printed to stderr, exit code 2.
class UsageError extends Error {}

const ROMANIZE_MODES: readonly RomanizeMode[] = [
  "off",
  "inline",
  "duplicate",
  "current-only",
];
const ROMANIZE_LANGS: readonly RomanizeLang[] = ["zh", "ja", "ko", "auto"];

function parseRomanizeMode(value: string): RomanizeMode {
  if ((ROMANIZE_MODES as readonly string[]).includes(value)) {
    return value as RomanizeMode;
  }
  throw new UsageError(
    `invalid value '${value}' for '--romanize <romanize>'\n  [possible values: ${ROMANIZE_MODES.join(", ")}]`,
  );
}

function parseRomanizeLang(value: string): RomanizeLang {
  if ((ROMANIZE_LANGS as readonly string[]).includes(value)) {
    return value as RomanizeLang;
  }
  throw new UsageError(
    `invalid value '${value}' for '--romanize-lang <romanize_lang>'\n  [possible values: ${ROMANIZE_LANGS.join(", ")}]`,
  );
}

// `max` mirrors clap's integer value-parser ranges: `--port` is a `u16`
// (0..=65535), the paddings are `usize`. JS `Number` cannot faithfully represent
// the full `usize` range, so paddings use `Number.MAX_SAFE_INTEGER` as the
// practical ceiling (the value is "number of empty lines" — the exact bound never
// matters). The `: <v> is not in 0..=<max>` suffix approximates clap's range
// message (cosmetic; not byte-identical).
function parseNumber(value: string, flag: string, max: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > max) {
    throw new UsageError(
      `invalid value '${value}' for '${flag}': ${value} is not in 0..=${max}`,
    );
  }
  return n;
}

async function runLogin(argv: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        "client-id": { type: "string" },
        "client-secret": { type: "string" },
        port: { type: "string" },
      },
      allowPositionals: false,
      strict: true,
    });
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }

  const { values } = parsed;
  const clientId = values["client-id"];
  const clientSecret = values["client-secret"];
  if (clientId === undefined) {
    throw new UsageError(
      "the following required arguments were not provided:\n  --client-id <client_id>",
    );
  }
  if (clientSecret === undefined) {
    throw new UsageError(
      "the following required arguments were not provided:\n  --client-secret <client_secret>",
    );
  }

  const port =
    values.port === undefined
      ? 8888
      : parseNumber(values.port, "--port <port>", 65535);

  await SpotifyAuth.loginFlow(clientId, clientSecret, port);
}

async function runDefault(argv: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        "style-before": { type: "string" },
        "style-current": { type: "string" },
        "style-after": { type: "string" },
        "color-before": { type: "string" },
        "color-current": { type: "string" },
        "color-after": { type: "string" },
        "ignore-errors": { type: "boolean" },
        "merge-queue": { type: "boolean" },
        romanize: { type: "string" },
        "romanize-lang": { type: "string" },
        "padding-before": { type: "string" },
        "padding-after": { type: "string" },
        "save-config": { type: "boolean" },
      },
      allowPositionals: false,
      strict: true,
    });
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }

  const { values } = parsed;

  const cliRomanize =
    values.romanize === undefined
      ? undefined
      : parseRomanizeMode(values.romanize);
  const cliRomanizeLang =
    values["romanize-lang"] === undefined
      ? undefined
      : parseRomanizeLang(values["romanize-lang"]);
  const cliPaddingBefore =
    values["padding-before"] === undefined
      ? undefined
      : parseNumber(
          values["padding-before"],
          "--padding-before <padding_before>",
          Number.MAX_SAFE_INTEGER,
        );
  const cliPaddingAfter =
    values["padding-after"] === undefined
      ? undefined
      : parseNumber(
          values["padding-after"],
          "--padding-after <padding_after>",
          Number.MAX_SAFE_INTEGER,
        );

  const stored = loadConfig();

  // Merge precedence mirrors main.rs: CLI value over stored; booleans `cli ||
  // stored`; colors `cli ?? stored`.
  const effective: Config = {
    style_before: values["style-before"] ?? stored.style_before,
    style_current: values["style-current"] ?? stored.style_current,
    style_after: values["style-after"] ?? stored.style_after,
    color_before: values["color-before"] ?? stored.color_before,
    color_current: values["color-current"] ?? stored.color_current,
    color_after: values["color-after"] ?? stored.color_after,
    ignore_errors: (values["ignore-errors"] ?? false) || stored.ignore_errors,
    merge_queue: (values["merge-queue"] ?? false) || stored.merge_queue,
    romanize: cliRomanize ?? stored.romanize,
    romanize_lang: cliRomanizeLang ?? stored.romanize_lang,
    padding_before: cliPaddingBefore ?? stored.padding_before,
    padding_after: cliPaddingAfter ?? stored.padding_after,
  };

  if (values["save-config"] ?? false) {
    const path = saveConfig(effective);
    console.log(`Saved config to ${path}`);
  }

  const auth = await SpotifyAuth.load();
  const player: Player = new SpotifyPlayer(auth);
  const provider: LyricsProvider = new LrclibProvider();

  const config: SyncConfig = {
    playerPollInterval: 2000,
    uiTimerInterval: 200,
    mergeQueue: effective.merge_queue,
  };

  const rx = startSync(player, provider, config);

  // Lazily load the Japanese morphological dictionary (~17MB on disk) only when
  // romanization is enabled for a language that can use it (ja / auto), so users
  // who don't need it never pay the load cost. Failures are swallowed inside
  // `initRomanizer`, which leaves the any-ascii fallback in place.
  if (
    effective.romanize !== "off" &&
    (effective.romanize_lang === "ja" || effective.romanize_lang === "auto")
  ) {
    await initRomanizer();
  }

  const renderer: Renderer = new TuiRenderer(effective);
  await renderer.run(rx);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(USAGE);
    process.exit(0);
  }

  if (argv[0] === "login") {
    await runLogin(argv.slice(1));
    return;
  }

  await runDefault(argv);
}

try {
  await main();
  process.exit(0);
} catch (err) {
  if (err instanceof UsageError) {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(2);
  }

  // anyhow-style report: `Error: <message>` plus the cause chain.
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Error: ${message}\n`);
  let cause: unknown = err instanceof Error ? err.cause : undefined;
  if (cause !== undefined) {
    process.stderr.write("\nCaused by:\n");
    while (cause !== undefined) {
      const causeMsg =
        cause instanceof Error ? cause.message : String(cause);
      process.stderr.write(`    ${causeMsg}\n`);
      cause = cause instanceof Error ? cause.cause : undefined;
    }
  }
  process.exit(1);
}
