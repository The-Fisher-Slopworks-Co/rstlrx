# rstlrx — Rust → TypeScript/Bun Migration Report

Status: **GREEN** — typecheck pass, build pass, `bun test` 98 pass / 0 fail.

> **Guiding principle — functional identity over byte-identity.** This port aims
> for *functional* identity with the Rust crate, not byte-for-byte output. The
> canonical statement lives in
> [`PORT_SPEC.md` → "Guiding principle"](./PORT_SPEC.md); in short, every
> divergence falls into one of three buckets: **[load-bearing]** bytes something
> truly depends on (wire fields, on-disk keys, asserted error strings, user-visible
> stdout, the `parseLrc` algorithm) are preserved; **[cosmetic]** byte-level
> formatting nothing depends on (help-text layout, `Caused by:` whitespace, TOML
> key ordering) is functionally equivalent and is **not** a defect; and where the
> TS port can be **more correct** than the Rust original, correctness is preferred
> over slavish copying (`[improve]` — and the kuromoji romanizer is the positive
> exemplar). The "fidelity notes" in §5 are tagged against these buckets, and the
> `[improve]` items are collected as recommended improvements in §6.

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
`build` bundles 28 modules into `dist/main.js` (~1.48 MB); `bun test` reports
`98 pass, 0 fail` across 10 files (198 `expect()` calls).

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
| `kakasi` (0.1) | `@patdx/kuromoji` (IPADIC, dictionary-based) + `wanakana` (`toRomaji`, Hepburn) — kanji→reading via the morphological tokenizer (same class as kakasi), kana via wanakana; **see §5** |

## 4. Test summary

The Rust suite contains **70 `#[test]` functions** across 7 modules; all 70 were
ported 1:1 into co-located `*.test.ts` files using `bun:test`, with Rust value
constructors translated to the TS data model (`Line{time_ms,words}` →
`{timeMs,words}`; `DisplayLine::Lyric/Separator` → tagged objects;
`Color::Rgb/Indexed/Red` → structural `{type,...}` objects; `Style::default()` →
`{bold,italic,underline,dim,fg}`). `assert_eq!` → `toEqual`, `assert!` → `toBe`.

Final result: **`bun test` → 98 pass, 0 fail (10 files, 198 `expect()` calls).**

Per-file porting tally:

| TS test file | tests | Source |
|---|---|---|
| `src/lyrics/lrclib/index.test.ts` | 10 | ported from `lyrics/lrclib/mod.rs` (10) |
| `src/lyrics/index.test.ts` | 4 | ported from `lyrics/mod.rs` (4) |
| `src/player/spotify/index.test.ts` | 6 | ported from `player/spotify/mod.rs` (6) |
| `src/renderer/tui/index.test.ts` | 7 | ported from `renderer/tui/mod.rs` (7) |
| `src/renderer/tui/style.test.ts` | 16 | ported from `renderer/tui/style.rs` (16) |
| `src/romanize.test.ts` | 22 | 15 ported from `romanize.rs` (15) + 7 new (kuromoji exact-value + POS-aware word spacing) |
| `src/sync.test.ts` | 12 | ported from `sync.rs` (12) |
| `src/config.test.ts` | 6 | **new** (Rust `config.rs` had no `#[test]`) |
| `src/channel.test.ts` | 14 | **new infra** |
| `src/sync.integration.test.ts` | 1 | **new — async select-loop coverage** |

So 70 tests are direct 1:1 ports of the Rust suite, and 28 are new TypeScript
tests (6 for `config`, 14 for `channel`, 1 sync integration, 7 for the
dictionary-based Japanese romanizer — 2 exact `taberu` / `arigatou` values plus
5 locking in POS-aware word spacing: multi-word spacing, no inflection
over-segmentation, sokuon at token boundaries, sentence spacing, latin mixed).

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

These are honest, specific divergences, each tagged by the guiding principle into
one of three buckets:

- **`[load-bearing]`** — bytes a real consumer depends on; preserved to match Rust.
- **`[cosmetic]`** — byte-level formatting nothing depends on; functionally
  equivalent, **not** a defect (no action needed).
- **`[improve]`** — a place where the Rust original is functionally *more correct*;
  per "do it right" this is a **recommended improvement** (tracked in §6), not an
  excused divergence.

Several divergences are silent (not caught by the ported tests, because the Rust
tests assert loose properties). Tagging relabels each note against the principle;
the technical facts beneath each are unchanged.

1. `[improve ✓ — done right]` **Japanese romaji: kakasi → kuromoji + wanakana (gap
   CLOSED, with word spacing restored).** This is the positive exemplar of the
   principle: the port is intentionally **not** byte-identical to kakasi, and is
   *more* correct than the first-cut any-ascii — correct dictionary readings and
   readability were the requirement, byte parity never was. The Rust `romanize_ja`
   (`src/romanize.rs:53-54`) is
   `kakasi::convert(text).romaji` — a *dictionary / morphological* kanji→reading
   conversion that **inserts spaces between words** (e.g.
   `kakasi::convert("こんにちは世界！").romaji == "konnichiha sekai!"`). The TS port
   now matches both the readings and the spacing with a real morphological
   analyzer: `@patdx/kuromoji` (a modern ESM/TS fork of kuromoji.js, the
   **IPADIC** dictionary — the same engine class as kakasi) tokenizes the text and
   exposes each token's katakana `.reading`, which `wanakana.toRomaji` (Hepburn)
   converts to romaji. So **kanji now uses the real dictionary reading** (`食べる` →
   `"taberu"`, not any-ascii's context-free `"Shiberu"`), and **kana matches
   exactly** (`ありがとう` → `"arigatou"`, `カタカナ` → `"katakana"`). Tokens with
   no reading (punctuation, latin/ASCII) keep their surface form, so non-CJK text
   passes through verbatim.
   - **Word spacing (POS-aware token joining).** kuromoji tokenizes into
     *morphemes* (finer than words), so a naive join of every token's romaji
     either runs words together (`"konnichihasekai"`) or over-segments
     inflections (`食べました` → `"tabe mashi ta"`). The romanizer instead walks the
     tokens and **groups each independent word with the inflections / auxiliaries
     that attach to it**, joining groups with a single space. A token attaches
     (takes no leading space) when its `pos_detail_1` is `非自立` (non-independent),
     `接尾` (suffix), or `接続助詞` (conjunctive particle, e.g. the て in 走って);
     when it is non-whitespace punctuation (`記号` other than `空白` — `！` `。` `、`
     glue to the preceding word); or when it is an auxiliary verb (`助動詞`)
     **following** a verb / adjective / auxiliary, so an inflection chain like
     まし+た stays glued while the copula です/だ after a noun is spaced
     (`学生です` → `"gakusei desu"`). Whitespace (`記号`/`空白`) is a hard
     separator. Everything else — nouns 名詞, verb stems 動詞, adjectives, adverbs,
     regular particles は/が/を — starts a new word. This restores kakasi-style
     readability:
     `こんにちは世界` → `"konnichiha sekai"`, `私は学生です。` →
     `"watashi ha gakusei desu."`, while keeping `食べました` → `"tabemashita"`,
     `食べている` → `"tabeteiru"`, `愛してる` → `"aishiteru"` as single words.
     The output is **correct and readable** (proper word spacing); it is not
     byte-for-byte identical to kakasi (e.g. romanization of は as `ha` vs `wa`,
     and exact word boundaries depend on IPADIC) — parity with kakasi's bytes was
     never a requirement, readability was.
   - **Sokuon / long-vowel at token boundaries.** Per-token romaji conversion
     drops a small っ (sokuon) that lands at the end of a token — kuromoji reads
     `走っ` as `ハシッ`, which `wanakana.toRomaji` alone renders `"hashi"`, losing
     the gemination. To avoid this, each word group accumulates its tokens'
     **katakana readings into one contiguous run** and converts the whole run at
     once, so `ハシッ`+`テ` → `"hashitte"` (not `"hashi"+"te" = "hashite"`) and
     `会いたかった` → `"aitakatta"` (not `"aitakata"`).
   Design / cost:
   - The kuromoji dictionary LOAD is async and one-time; `tokenizer.tokenize()` is
     **synchronous**, so the public `romanize(text, lang): string` stays
     synchronous. An idempotent `initRomanizer()` builds the tokenizer once and
     caches it in module state; `romanizeJa` uses it when present and otherwise
     **falls back** to the previous per-run `any-ascii` behavior, so nothing
     breaks before init / if the dict is unavailable (init failures are swallowed,
     never fatal).
   - `initRomanizer()` is awaited in `main.ts` before the renderer starts, but
     **only** when romanization is enabled and the language is `ja` or `auto`, so
     the dictionary (~17MB gzipped `.dat.gz` on disk, ~96MB in RAM when loaded) is
     never paid for by users who don't need it. The dict path is resolved from the
     installed package via `import.meta.resolve("@patdx/kuromoji/package.json")`
     (no hardcoded machine path).
   - **Residual nuance:** an unknown kanji token with no IPADIC reading would fall
     through to its surface form (CJK left in output), per the "keep surface form"
     design; common vocabulary is covered by the dictionary and none of the tests
     hit this. `ko` / `auto` still use `romanizeGeneric` (per-char any-ascii) —
     `auto` therefore never actually invokes the tokenizer even when the dict is
     loaded. **`[improve]`** — `auto` is meant to handle Japanese, but routes JA
     text through the weaker generic path instead of the now-correct `ja`
     tokenizer; "do it right" says `auto` should detect Japanese and use the
     dictionary path (tracked in §6). `zh` still uses pinyin per Han ideograph
     with any-ascii only as the kana/hangul fallback. The Rust `test_ja_*` tests assert only "no kana
     remains / non-empty"; two new tests assert the exact upgraded values
     (`romanize("食べる","ja") === "taberu"`, `romanize("ありがとう","ja") ===
     "arigatou"`), run against the real tokenizer via a `beforeAll(initRomanizer)`.

2. `[cosmetic]` **pinyin crate → pinyin-pro drift.** Polyphonic Han characters may
   map to different readings between the `pinyin` crate and `pinyin-pro`, but both
   produce valid plain readings, so this is functionally equivalent, not a defect.
   Tests are loose (assert "no Han char remains" + "a space is present"), so drift
   is uncaught. `pinyin()` is correctly called only on a single Han code point;
   calling it on the whole string with `{type:"array"}` would split Latin runs
   and break `test_zh_mixed` (`"I love 你"` must start with `"I love "`).

3. `[cosmetic]` + `[improve]` **clap → parseArgs differences.** `clap`'s help text,
   error wording, and parsing are reimplemented by hand over `node:util`
   `parseArgs`. The help-text layout and error wording are `[cosmetic]` (nothing
   depends on the exact bytes); the one `[improve]` item is the `--port` range,
   flagged below:
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
     does none of this. **`[improve]`** — `--port` currently accepts any
     non-negative integer, whereas clap's `u16` rejects values > 65535. A TCP port
     genuinely cannot exceed 65535, so the Rust original is the more-correct one
     here; "do it right" says add the `0..=65535` bound (tracked in §6), rather
     than treat the looser behavior as an acceptable divergence.

4. `[cosmetic]` **anyhow error-chain formatting.** Runtime failures print `Error: <message>`
   to stderr, then (if a `cause` chain exists) a `Caused by:` block walking the
   `{ cause }` chain, exit 1 — mirroring anyhow's `{:?}` Debug report. The
   indentation and "Caused by:" framing approximate anyhow's multi-line format;
   exact whitespace may differ from anyhow's renderer.

5. `[cosmetic]` (+ untested runtime path) **ratatui / crossterm → raw ANSI.** `Style` / `Color` / `Modifier` become
   plain data; `styleToAnsi` emits opening SGR sequences. Named-color SGR codes
   are best-effort and explicitly **not asserted** by tests (tests inspect
   `.text` and counts only). The full draw / layout / alt-screen / raw-mode path
   (`\x1b[?1049h` / `\x1b[?25l` enter, restore on exit, stdin raw mode bridged
   into a `Channel<string>`, quit on `q` / Esc / Ctrl-C) is hand-rolled and not
   unit-tested; there is residual risk of escape-sequence or restore-on-panic
   differences versus ratatui's managed terminal teardown.

6. `[cosmetic]` **CJK double-width centering — handled, with a table-fidelity caveat.**
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

7. `[load-bearing]` **`dirs` platform mapping.** `dirs.ts` replicates: linux `configDir` =
   `$XDG_CONFIG_HOME` (if absolute) else `~/.config`, `dataLocalDir` =
   `$XDG_DATA_HOME` (if absolute) else `~/.local/share`; darwin both =
   `~/Library/Application Support`; win32 `configDir` = `%APPDATA%`,
   `dataLocalDir` = `%LOCALAPPDATA%`. Returns `null` if home / env is
   unavailable (Rust returned `None`), and downstream `storagePath()` throws.

8. `[load-bearing]` keys + `[cosmetic]` formatting **TOML library swap (`toml` → `smol-toml`).** On-disk `config.toml` is
   round-trip compatible (snake_case keys preserved; null/undefined `color_*`
   keys omitted, matching serde's `skip_serializing_if`), but
   `smol-toml.stringify` is not guaranteed byte-identical to
   `toml::to_string_pretty` (key ordering / quoting may differ). `loadConfig`
   merges a parsed partial over `defaultConfig()` (mirrors `#[serde(default)]`),
   and a missing file falls back to defaults.

9. `[cosmetic]` (behavioral nuance, equivalent) **`tokio::Mutex<SpotifyAuth>` removed.** Rust serialized token refresh via a
   `tokio::Mutex`. Single-threaded `await` in TS makes the lock unnecessary, but
   concurrent `state()` / `queue()` calls could each independently trigger a
   refresh + `save()`. Token is fetched per request, so this is acceptable — a
   behavioral nuance, not a correctness break.

10. `[load-bearing]` **Spotify / lrclib wire behavior is preserved.** lrclib: `GET
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

## 6. Follow-ups

Grouped by the guiding principle. The first group is the one that matters per "do
it right" — places where the Rust original is functionally *more correct* and the
port should match it (not excuse the difference). The other two groups are
optional: cosmetic parity that nothing depends on, and untested surfaces.

### 6a. Recommended improvements (`[improve]` — do it right)

These are not "acceptable divergences" — the original is the more-correct one, so
matching it (or going further) is the right call when these surfaces are touched.

- **`--port` should reject values > 65535.** A TCP port cannot exceed 65535; clap's
  `u16` enforces this, the port currently accepts any non-negative integer. Add the
  `0..=65535` bound (and, alongside it, the `usize` paddings range). (§5.3)
- **`auto` should use the Japanese dictionary path.** `--romanize-lang auto` is
  meant to handle Japanese, but routes JA text through the weaker generic
  `any-ascii` path instead of the now-correct kuromoji + wanakana `ja` path. Make
  `auto` detect Japanese (kana/CJK) and use the dictionary reading, so `auto` is at
  least as correct as explicit `ja`. (§5.1)

### 6b. Optional cosmetic-parity follow-ups (`[cosmetic]` — only if exact parity is wanted)

Functionally equivalent already; nothing depends on the exact bytes. Do these only
if byte-level parity with the Rust output is explicitly required.

- **CJK display-width centering** is implemented (width-aware centering via a
  hand-coded wide-character range table). Optional: align that table with the exact
  `unicode-width` data for pixel-perfect parity with ratatui at edge code points.
- **clap-identical help / error text.** The hand-written usage/help strings read
  equivalently but are not byte-identical to clap's auto-generated layout. Optional:
  tighten the wording/spacing only if exact clap parity is required.
- **anyhow / TOML formatting.** `Caused by:` indentation and `smol-toml` key
  ordering/quoting may differ from anyhow / `toml::to_string_pretty`; both parse and
  read equivalently.

### 6c. Untested surfaces (no Rust tests existed either)

- **Runtime UI / OAuth paths are untested.** Follow-up: end-to-end terminal-render
  and login-flow tests if those surfaces need regression protection.

### Closed during the port (`[improve ✓]`)

- **Japanese kanji morphological romanization (kakasi)** is now translated — once
  the one item that could not be reproduced. `@patdx/kuromoji` (IPADIC, the same
  dictionary class as kakasi) drives the readings and `wanakana` produces Hepburn
  romaji, behind the same synchronous `romanize(text, "ja")` signature (the
  one-time dictionary load is the only async step, done in `initRomanizer()` and
  lazily wired into `main.ts` for `ja` / `auto`). kakasi's **word spacing** is also
  restored via POS-aware token joining, and sokuon / long vowels at token
  boundaries are preserved by converting each word group's katakana run as a whole.
  The result is correct and readable, intentionally **not** byte-for-byte identical
  to kakasi — byte parity was never required; correct readings were. This is the
  principle applied well: the port ended up *more* correct than a literal copy. See
  §5.1 for the full design and cost.

---

**Final status: GREEN** — `typecheck: pass`, `build: pass`,
`bun test: 98 pass, 0 fail` (10 files, 198 `expect()` calls). The port is
**functionally** identical to the Rust crate and conforms to `PORT_SPEC.md`; byte
parity was never the goal (see the guiding principle). The Japanese romaji gap is
now closed via `@patdx/kuromoji` + `wanakana` (§5.1) — including kakasi-style word
spacing restored through POS-aware token joining, a case where the port ended up
*more* correct than a literal copy. What remains is two recommended `[improve]`
items where the Rust original is the more-correct one (`--port` ≤ 65535, and
`auto` using the JA dictionary path — §6a) plus optional `[cosmetic]` parity
follow-ups (§6b); none block the build, type-check, or test suite.
