# rstlrx — Rust → TypeScript/Bun Migration Report

Status: **GREEN** — typecheck pass, build pass, `bun test` 91 pass / 0 fail.

## 1. Overview

`rstlrx` is a terminal lyrics viewer that syncs with Spotify playback. The Rust
crate has been ported to a Bun/TypeScript CLI. The port was originally developed
in a `ts/` subdirectory alongside the Rust crate (non-destructive); this branch
(`rewrite/ts-bun`) then promoted the TypeScript project to the repository root and
removed the Rust sources (`src/*.rs`, `Cargo.toml`, `Cargo.lock`). The original
Rust source remains recoverable from git history on `main`.

The port follows the authoritative contract in
[`PORT_SPEC.md`](./PORT_SPEC.md): module boundaries are
1:1 with the Rust sources, `Result<T>` maps to functions that throw, `Option<T>`
and `Result<Option<T>>` map to `T | null`, anyhow `.context` maps to
`new Error(msg, { cause })`, and error-message strings are preserved verbatim.
The code is idiomatic Bun/TypeScript under `strict: true` (no `any`, no
`@ts-ignore`), using native `fetch`, `Bun.serve`, `Bun.spawn`, `Bun.file` /
`Bun.write`, with `node:os` / `node:path` where appropriate. All relative
imports are extensionless.

### Build / run / test

All commands run from the repository root (Bun 1.3+):

```sh
# Type-check (tsc --noEmit, strict)
bun run typecheck

# Build a bundled entry point into dist/
bun run build           # bun build ./src/main.ts --target bun --outdir dist

# Run the test suite
bun test                # or: bun run test

# Run the CLI directly
bun run src/main.ts --help
bun run src/main.ts login --client-id <ID> --client-secret <SECRET> [--port 8888]
bun run src/main.ts [--style-current bold --color-current "#ff5500" --romanize inline ...]
# Installed as a bin named `rstlrx` (package.json "bin"); shebang is `#!/usr/bin/env bun`.
```

Verification outcome (reproduced during this report): `typecheck` exits 0;
`build` bundles 25 modules into `dist/main.js` (~1.40 MB); `bun test` reports
`91 pass, 0 fail` across 10 files (189 `expect()` calls).

## 2. File mapping (every Rust file → TS file)

| Rust file | TS file |
|---|---|
| `src/main.rs` | `src/main.ts` |
| `src/config.rs` | `src/config.ts` |
| `src/romanize.rs` | `src/romanize.ts` |
| `src/sync.rs` | `src/sync.ts` |
| `src/lyrics/mod.rs` | `src/lyrics/index.ts` |
| `src/lyrics/lrclib/mod.rs` | `src/lyrics/lrclib/index.ts` |
| `src/player/mod.rs` | `src/player/index.ts` |
| `src/player/spotify/mod.rs` | `src/player/spotify/index.ts` |
| `src/player/spotify/auth.rs` | `src/player/spotify/auth.ts` |
| `src/renderer/mod.rs` | `src/renderer/index.ts` |
| `src/renderer/tui/mod.rs` | `src/renderer/tui/index.ts` |
| `src/renderer/tui/style.rs` | `src/renderer/tui/style.ts` |
| *(new infra — replaces the `dirs` crate)* | `src/dirs.ts` |
| *(new infra — replaces `tokio::sync::mpsc`)* | `src/channel.ts` |

The two new infrastructure files have no Rust source: `dirs.ts` reimplements the
`dirs` crate's platform path resolution, and `channel.ts` is the load-bearing
async MPSC channel that replaces `tokio::sync::mpsc` and underpins both async
select loops.

## 3. Dependency mapping (Cargo crate → TS/Bun replacement)

| Cargo dependency | TS / Bun replacement |
|---|---|
| `tokio` (full: mpsc / select / spawn / time / net) | `src/channel.ts` (`Channel<T>`) + async loops + `setTimeout`; `Bun.serve` for the OAuth callback listener |
| `reqwest` (json, rustls-tls) | native `fetch` + `AbortSignal.timeout(10000)`; HTTP Basic via `Authorization` header; form bodies via `URLSearchParams`; URLs via `URL` |
| `serde` / `serde_json` | `JSON.parse` / `JSON.stringify` + typed `interface`s |
| `clap` (derive) | `parseArgs` (`node:util`) + a thin subcommand layer (hand-written `--help`, enum validation, exit-2 usage errors) |
| `ratatui` (0.29) | raw ANSI + a plain `Style` / `Color` data model in `style.ts`; `RenderedLine` + centering in `tui/index.ts` |
| `crossterm` (event-stream) | `process.stdin` raw mode (`setRawMode`), alt-screen / cursor ANSI escapes, key bytes bridged into a `Channel<string>` |
| `open` (5) | `Bun.spawn` platform opener (linux `xdg-open`, darwin `open`, win32 `cmd /c start`) |
| `async-trait` | no dep — TS interface methods return `Promise` natively |
| `anyhow` | `throw new Error(msg)` / `new Error(msg, { cause })`; top-level `Error: <msg>` + `Caused by:` chain printing |
| `dirs` (6) | `src/dirs.ts` (`configDir`, `dataLocalDir`) via `node:os` `homedir` + `node:path` |
| `toml` (0.8) | `smol-toml` (`parse`, `stringify`) read/written via `Bun.file` / `Bun.write` |
| `futures` (0.3, `StreamExt`) | no dep — native async + the stdin `Channel` bridge replaces `EventStream` |
| `any_ascii` (0.3.3) | `any-ascii` npm (`anyAscii(string)`, per-char `anyAscii(c)`) |
| `pinyin` (0.11, `plain`) | `pinyin-pro` — `pinyin(c, { toneType: "none" })` on a single Han code point only |
| `kakasi` (0.1) | `any-ascii` per CJK run (Japanese romaji) — kana exact, kanji approximate, **see §5** |

## 4. Test summary

The Rust suite contains **70 `#[test]` functions** across 7 modules; all 70 were
ported 1:1 into co-located `*.test.ts` files using `bun:test`, with Rust value
constructors translated to the TS data model (`Line{time_ms,words}` →
`{timeMs,words}`; `DisplayLine::Lyric/Separator` → tagged objects;
`Color::Rgb/Indexed/Red` → structural `{type,...}` objects; `Style::default()` →
`{bold,italic,underline,dim,fg}`). `assert_eq!` → `toEqual`, `assert!` → `toBe`.

Final result: **`bun test` → 91 pass, 0 fail (10 files, 189 `expect()` calls).**

Per-file porting tally:

| TS test file | tests | Source |
|---|---|---|
| `src/lyrics/lrclib/index.test.ts` | 10 | ported from `lyrics/lrclib/mod.rs` (10) |
| `src/lyrics/index.test.ts` | 4 | ported from `lyrics/mod.rs` (4) |
| `src/player/spotify/index.test.ts` | 6 | ported from `player/spotify/mod.rs` (6) |
| `src/renderer/tui/index.test.ts` | 7 | ported from `renderer/tui/mod.rs` (7) |
| `src/renderer/tui/style.test.ts` | 16 | ported from `renderer/tui/style.rs` (16) |
| `src/romanize.test.ts` | 15 | ported from `romanize.rs` (15) |
| `src/sync.test.ts` | 12 | ported from `sync.rs` (12) |
| `src/config.test.ts` | 6 | **new** (Rust `config.rs` had no `#[test]`) |
| `src/channel.test.ts` | 14 | **new infra** |
| `src/sync.integration.test.ts` | 1 | **new — async select-loop coverage** |

So 70 tests are direct 1:1 ports of the Rust suite, and 21 are new TypeScript
tests (6 for `config`, 14 for `channel`, 1 sync integration).

### Why the new channel + sync integration tests

The Rust suite tested only **pure** functions (LRC parsing, romanization, style
parsing, `get_index` / `append_next_track`, `parse_response`, `build_output`).
It had **no coverage of the async control flow** — neither `tokio::select!` in
`sync_loop` / `tui::run` nor the `mpsc` channel. That async layer is precisely
where the port's highest-risk translation lives: the "orphaned-recv trap." With
a FIFO resolver-queue `Channel`, a select loop that recreates `recv()` on every
race iteration registers multiple waiters, and a later `send()` resolves the
oldest (orphaned) waiter — silently dropping the message. This is the
documented #1 porting bug, and nothing in the Rust suite would catch it.

- `channel.test.ts` (14 tests) covers the `Channel<T>` contract: buffered
  send→recv, a pending recv resolved by a later send, FIFO ordering, the
  **lose-a-race-then-reawait delivers the value (not lost)** case, and close
  semantics (pending recv → `undefined`, send-after-close → `false`).
- `sync.integration.test.ts` (1 test) drives the real `startSync` select loop
  with a fake `Player` (first poll → track A, later polls → track B) and a fake
  `LyricsProvider` (distinct `"A-lyric"` / `"B-lyric"` per track), then scans the
  returned `Channel<Update>` for up to 100 recvs, asserting the new track's
  `"B-lyric"` reaches the channel — proving the A→B player message is not
  dropped. It uses `uiTimerInterval=5 < playerPollInterval=20` so the UI timer
  wins several races during the orphan-accumulation window, with a large
  `durationMs` and empty `queue()` to keep the auto-transition / queue-recheck /
  prefetch branches dormant. The test was confirmed non-vacuous: temporarily
  mutating `sync.ts` to recreate `recvP` every iteration made it FAIL (B never
  appeared); the stable-promise pattern (`sync.ts:206` initial hold, `:216`
  renew only in the msg branch) was confirmed intact. Both select loops
  (`sync.ts` and `renderer/tui/index.ts`) were audited and already hold the
  `recv()` promise across iterations correctly.

### Fixes applied during verification

Two compile errors in `src/main.ts` broke `tsc` and `bun build`; both fixed:

1. **`start_sync` → `startSync`** — `main.ts` imported and called a nonexistent
   `start_sync` (TS2724 / `bun build` no-matching-export). The real export from
   `./sync` is `startSync`. Corrected at the import (line 13) and call site
   (line 194).
2. **`await SpotifyAuth.load()`** — `load()` returns `Promise<SpotifyAuth>` but
   was assigned synchronously to a `SpotifyAuth`-typed variable (TS2345). Added
   `await` (line 184).

## 5. Behavior gaps / fidelity notes

These are honest, specific divergences. Several are silent (not caught by the
ported tests, because the Rust tests assert loose properties).

1. **Japanese romaji: kakasi → any-ascii (kana exact, kanji approximate).** The
   Rust `romanize_ja` (`src/romanize.rs:53-54`) is `kakasi::convert(text).romaji`
   — a *dictionary / morphological* kanji→reading conversion (e.g. `食べる` →
   `"taberu"`). No equivalent synchronous morphological analyzer exists in the Bun
   stack used here, so the TS port (`romanizeJa`) transliterates **contiguous CJK
   runs** together via `anyAscii`. For **kana** this reproduces kakasi exactly for
   the common case — `ありがとう`→`"arigatou"`, `カタカナ`→`"katakana"`. For
   **kanji**, any-ascii uses a context-free reading and capitalizes
   (`食べる`→`"Shiberu"` vs kakasi `"taberu"`), so kanji-heavy lines still differ
   from the original — this is the residual, inherent fidelity gap. (Earlier this
   branch went through the per-code-point `romanizeGeneric` path, which produced
   space-separated `"a ri ga to u"`; it was refined to per-run so kana matches
   kakasi.) `ko` / `auto` still use `romanizeGeneric` (per-char any-ascii), and
   `zh` still uses pinyin per Han ideograph with any-ascii only as the kana/hangul
   fallback, so Chinese is closest to the original. The Rust `test_ja_*` tests only
   assert "no kana remains / non-empty," which all implementations satisfy.

2. **pinyin crate → pinyin-pro drift.** Polyphonic Han characters may map to
   different readings between the `pinyin` crate and `pinyin-pro`. Tests are
   loose (assert "no Han char remains" + "a space is present"), so drift is
   uncaught. `pinyin()` is correctly called only on a single Han code point;
   calling it on the whole string with `{type:"array"}` would split Latin runs
   and break `test_zh_mixed` (`"I love 你"` must start with `"I love "`).

3. **clap → parseArgs differences.** `clap`'s help text, error wording, and
   parsing are reimplemented by hand over `node:util` `parseArgs`:
   - `--help` / `-h` prints a hand-written usage string (not clap's exact
     auto-generated layout) and exits 0. The wording/spacing is close but not
     byte-identical to clap's output.
   - **No `--version` flag.** The Rust crate did not derive `version`, so the
     port also has none — consistent, but neither has it.
   - `main()` checks `argv.includes("--help" | "-h")` before subcommand
     dispatch, so `--help` is honored in any position and `rstlrx login --help`
     prints the top-level usage rather than login-specific help. clap would emit
     subcommand-scoped help for `login --help`.
   - Usage errors (unknown flag, invalid enum value, missing required `login`
     argument, non-numeric/negative `--port` / padding) print `error: <message>`
     to **stderr** and exit **2** (clap-style), via a `UsageError` class. The
     message strings approximate clap's phrasing (e.g. `invalid value '<v>' for
     '--romanize <romanize>' [possible values: ...]`) but are not guaranteed
     character-identical to clap's.
   - Enum validation for `--romanize` / `--romanize-lang` and numeric range for
     `--port` (clap `u16`) / paddings (clap `usize`) is done manually; `parseArgs`
     does none of this. Note: `--port` accepts any non-negative integer here,
     whereas clap's `u16` would reject values > 65535.

4. **anyhow error-chain formatting.** Runtime failures print `Error: <message>`
   to stderr, then (if a `cause` chain exists) a `Caused by:` block walking the
   `{ cause }` chain, exit 1 — mirroring anyhow's `{:?}` Debug report. The
   indentation and "Caused by:" framing approximate anyhow's multi-line format;
   exact whitespace may differ from anyhow's renderer.

5. **ratatui / crossterm → raw ANSI.** `Style` / `Color` / `Modifier` become
   plain data; `styleToAnsi` emits opening SGR sequences. Named-color SGR codes
   are best-effort and explicitly **not asserted** by tests (tests inspect
   `.text` and counts only). The full draw / layout / alt-screen / raw-mode path
   (`\x1b[?1049h` / `\x1b[?25l` enter, restore on exit, stdin raw mode bridged
   into a `Channel<string>`, quit on `q` / Esc / Ctrl-C) is hand-rolled and not
   unit-tested; there is residual risk of escape-sequence or restore-on-panic
   differences versus ratatui's managed terminal teardown.

6. **CJK double-width centering — handled, with a table-fidelity caveat.**
   ratatui centers a `Paragraph` by **display width** (via the `unicode-width`
   crate, where CJK glyphs occupy 2 cells). The port preserves this: `tui/index.ts`
   defines `displayWidth()` / `isWide()` and `centerLine` centers using
   `displayWidth(text)`, not code-unit length. So wide-glyph content is centered
   correctly. The one residual risk is that `isWide` uses a **hand-coded
   East-Asian-width range table** (1100–115F, 2E80–303E, 3041–33FF, 3400–4DBF,
   4E00–9FFF, A000–A4CF, AC00–D7A3, F900–FAFF, FE30–FE4F, FF00–FF60, FFE0–FFE6,
   20000–3FFFD) rather than the exact `unicode-width` table; at a few edge code
   points the two tables may classify differently. This path is not covered by
   tests (they inspect `.text` only), so any such edge divergence would be silent.

7. **`dirs` platform mapping.** `dirs.ts` replicates: linux `configDir` =
   `$XDG_CONFIG_HOME` (if absolute) else `~/.config`, `dataLocalDir` =
   `$XDG_DATA_HOME` (if absolute) else `~/.local/share`; darwin both =
   `~/Library/Application Support`; win32 `configDir` = `%APPDATA%`,
   `dataLocalDir` = `%LOCALAPPDATA%`. Returns `null` if home / env is
   unavailable (Rust returned `None`), and downstream `storagePath()` throws.

8. **TOML library swap (`toml` → `smol-toml`).** On-disk `config.toml` is
   round-trip compatible (snake_case keys preserved; null/undefined `color_*`
   keys omitted, matching serde's `skip_serializing_if`), but
   `smol-toml.stringify` is not guaranteed byte-identical to
   `toml::to_string_pretty` (key ordering / quoting may differ). `loadConfig`
   merges a parsed partial over `defaultConfig()` (mirrors `#[serde(default)]`),
   and a missing file falls back to defaults.

9. **`tokio::Mutex<SpotifyAuth>` removed.** Rust serialized token refresh via a
   `tokio::Mutex`. Single-threaded `await` in TS makes the lock unnecessary, but
   concurrent `state()` / `queue()` calls could each independently trigger a
   refresh + `save()`. Token is fetched per request, so this is acceptable — a
   behavioral nuance, not a correctness break.

10. **Spotify / lrclib wire behavior is preserved.** lrclib: `GET
    https://lrclib.net/api/get`, UA `rstlrx v0.1.0 (https://github.com/...)`,
    10s `AbortSignal.timeout`, non-2xx → throw `"lrclib: <status>"`, missing
    lyrics → throw `"lrclib: no lyrics found"`; `parseLrc` timestamp logic
    (`[mm:ss.xx]`, 1/2/3-digit ms scaling ×100/×10/×1, the `line.length < 10`
    and first-byte-`[` guards) is byte-for-byte. Spotify: snake_case wire
    interfaces, token per request, HTTP 204 → `null` / `[]`, non-2xx → throw
    `"spotify: <status>"` / `"spotify queue: <status>"`, `parseQueueResponse`
    takes only the first queue item. The OAuth callback uses `Bun.serve` on
    `127.0.0.1:{port}`, returns the exact success HTML, and resolves the code,
    with stdout lines preserved verbatim (`"Opening browser for Spotify
    login..."`, `"Waiting for callback on port {port}..."`, `"Login successful!
    Auth saved."`). The browser open uses `Bun.spawn` with the platform opener.

## 6. Could-not-be-faithfully-translated & follow-ups

- **Japanese kanji morphological romanization (kakasi)** is the one item that
  could **not** be faithfully translated. There is no equivalent synchronous
  dictionary-based kanji→reading library in the Bun stack used here; per-run
  `any-ascii` reproduces kana exactly but gives context-free (often incorrect)
  kanji readings. Follow-up: integrate a
  real Japanese romanizer (e.g. a kuromoji/kakasi-equivalent) behind the same
  `romanize(text, "ja")` signature if accurate Japanese romaji matters.

- **CJK display-width centering** is implemented (width-aware centering via a
  hand-coded wide-character range table). Optional follow-up: align that table
  with the exact `unicode-width` data if pixel-perfect parity with ratatui at
  edge code points is required.

- **clap-identical help / error text and `u16` range enforcement** are
  approximated. Follow-up: tighten usage-error strings and add explicit numeric
  range checks if exact clap parity is required.

- **Runtime UI / OAuth paths are untested** (no Rust tests existed for them
  either). Follow-up: end-to-end terminal-render and login-flow tests if those
  surfaces need regression protection.

---

**Final status: GREEN** — `typecheck: pass`, `build: pass`,
`bun test: 91 pass, 0 fail` (10 files, 189 `expect()` calls). The port is
functionally complete and conforms to `PORT_SPEC.md`; the remaining items are
the documented, intentional fidelity gaps above (chiefly Japanese romaji and
CJK-width centering), none of which block the build, type-check, or test suite.
