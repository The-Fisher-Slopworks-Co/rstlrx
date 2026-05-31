# rstlrx — Rust → TypeScript/Bun Port Specification (AUTHORITATIVE CONTRACT)

This is the binding contract for porting the Rust crate at `../src` into this Bun
project at `ts/`. Every agent porting a module MUST conform to the type names,
file paths, and signatures below so the independently-written files compose.

- **Runtime:** Bun 1.3+. Use Bun APIs (`Bun.file`, `Bun.write`, `Bun.spawn`,
  `Bun.serve`, native `fetch`) — NOT Node shims. `node:os` / `node:path` are fine
  (Bun implements them natively; they are std, not shims).
- **Strictness:** `tsconfig` has `strict: true`. **No `any`.** No `// @ts-ignore`.
- **Imports:** extensionless relative imports (`./style`, `../lyrics`). Tests are
  co-located `*.test.ts` next to the module they test.
- **Project root is `ts/`.** When porting your module, create ONLY your assigned
  source file and its `*.test.ts`. Do NOT edit `package.json`, `tsconfig.json`,
  this spec, or other modules' files.

## Error & Option mapping (anyhow `Result` / `Option`)

- Rust `fn -> Result<T>`  →  TS `function(): T` (sync) or `Promise<T>` (async)
  that **throws** `Error` on failure.
- Rust `Result<Option<T>>` →  returns `T | null`, throws on error.
  (e.g. `Player.state()` → `Promise<State | null>`.)
- Rust `Option<T>` field/return → `T | null`.
- anyhow `.context("msg")` → wrap: `throw new Error("msg", { cause: err })`.
- `bail!("...")` → `throw new Error("...")`.
- Error message text must match the Rust strings verbatim where present
  (e.g. `"lrclib: no lyrics found"`, `"spotify: <status>"`,
  `"spotify queue: <status>"`, `"cannot read <path>. Run \`rstlrx login\` first."`).

## File mapping (Rust → TS). Module boundaries are 1:1.

| Rust | TS | Notes |
|------|----|----|
| `src/main.rs` | `ts/src/main.ts` | CLI entry, shebang `#!/usr/bin/env bun` |
| `src/config.rs` | `ts/src/config.ts` | |
| `src/romanize.rs` | `ts/src/romanize.ts` | |
| `src/sync.rs` | `ts/src/sync.ts` | |
| `src/lyrics/mod.rs` | `ts/src/lyrics/index.ts` | |
| `src/lyrics/lrclib/mod.rs` | `ts/src/lyrics/lrclib/index.ts` | |
| `src/player/mod.rs` | `ts/src/player/index.ts` | |
| `src/player/spotify/mod.rs` | `ts/src/player/spotify/index.ts` | |
| `src/player/spotify/auth.rs` | `ts/src/player/spotify/auth.ts` | |
| `src/renderer/mod.rs` | `ts/src/renderer/index.ts` | |
| `src/renderer/tui/mod.rs` | `ts/src/renderer/tui/index.ts` | |
| `src/renderer/tui/style.rs` | `ts/src/renderer/tui/style.ts` | |
| *(new infra)* | `ts/src/dirs.ts` | replaces `dirs` crate |
| *(new infra)* | `ts/src/channel.ts` | replaces `tokio::sync::mpsc` |

## Dependency mapping

| Rust crate | TS replacement |
|------------|----------------|
| `reqwest` | native `fetch` |
| `serde`/`serde_json` | `JSON.parse`/`JSON.stringify` + typed interfaces |
| `toml` | `smol-toml` (`parse`, `stringify`) |
| `clap` | `node:util` `parseArgs` + thin subcommand layer |
| `tokio` (mpsc/select/spawn/time) | `channel.ts` + async loops + `setTimeout` |
| `dirs` | `dirs.ts` |
| `open` | `Bun.spawn` with platform opener |
| `pinyin` | `pinyin-pro` (`pinyin(text,{toneType:'none',type:'array'})`) |
| `kakasi` (ja romaji) | `any-ascii` (per-char) — **behavior gap, see below** |
| `any_ascii` | `any-ascii` npm (`anyAscii(string)`) |
| `ratatui`/`crossterm` | raw ANSI + `process.stdin` raw mode (see renderer) |

## Shared domain types (define where indicated; import elsewhere)

`ts/src/lyrics/index.ts`:
```ts
export interface Line { timeMs: number; words: string }
export interface LyricsProvider { fetch(artist: string, track: string): Promise<Line[]> }
export function ensureLeadingLine(lines: Line[]): void   // mutates in place
```
`ensureLeadingLine`: if `lines[0]` exists and `lines[0].timeMs > 1000`,
`lines.unshift({ timeMs: 0, words: "" })`.

`ts/src/player/index.ts`:
```ts
export interface State { trackId: string; artist: string; track: string;
  positionMs: number; durationMs: number; isPlaying: boolean }
export interface QueueItem { trackId: string; artist: string; track: string }
export interface Player {
  state(): Promise<State | null>
  queue(): Promise<QueueItem[]>
}
```

`ts/src/renderer/index.ts`:
```ts
import type { Line } from "../lyrics";
export type DisplayLine =
  | { kind: "lyric"; line: Line }
  | { kind: "separator"; text: string };
export function displayLineText(d: DisplayLine): string;   // line.words | text
export interface Update { lines: DisplayLine[]; index: number; error: string | null }
export interface Renderer { run(rx: Channel<Update>): Promise<void> }
```

`ts/src/romanize.ts`:
```ts
export type RomanizeMode = "off" | "inline" | "duplicate" | "current-only"; // default "off"
export type RomanizeLang = "zh" | "ja" | "ko" | "auto";                     // default "auto"
export function hasRomanizable(text: string): boolean;
export function romanize(text: string, lang: RomanizeLang): string;
```
String-union values are the kebab-case clap/serde names exactly. Keep the
`isCjk` ranges (4E00-9FFF, 3400-4DBF, F900-FAFF, 3040-309F, 30A0-30FF, AC00-D7AF)
identical to Rust. Iterate **char by char** (`for (const c of text)` — code points).

`zh` (mirrors Rust `romanize_zh`): maintain `prevRomanized`. For each char:
- if it is a **Han ideograph** (ranges 4E00-9FFF | 3400-4DBF | F900-FAFF) → its
  pinyin is `pinyin(c, { toneType: "none" })` from `pinyin-pro` (single char →
  the plain syllable, e.g. `你`→`"ni"`). If `prevRomanized` push a space first,
  then the pinyin; `prevRomanized = true`.
- else if `isCjk(c)` (kana/hangul) → push space if `prevRomanized`, then
  `anyAscii(c)`; `prevRomanized = true`.
- else → push `c` as-is; `prevRomanized = false`.

`ja`/`ko`/`auto` (mirror Rust `romanize_ja`→approx, and `romanize_generic`):
per char, if `isCjk(c)` → space if `prevRomanized` then `anyAscii(c)`,
`prevRomanized=true`; else push `c`, `prevRomanized=false`.

DO NOT call `pinyin(wholeString, {type:"array"})` — it splits Latin runs into
single chars and breaks `test_zh_mixed` ("I love 你" must yield a string starting
`"I love "`). Only ever call `pinyin()` on a single Han code point.
Preserve "space only between consecutive romanized chars, never leading".
Verified outputs: `anyAscii("你")="Ni"`, `anyAscii("食べる")="Shiberu"`,
`anyAscii("한글")="HanGeul"` (per-char it is "Han"+"Geul"); `pinyin("你",{toneType:"none"})="ni"`.

## New infra contracts

`ts/src/dirs.ts` — replicate the `dirs` crate:
```ts
export function configDir(): string | null;
export function dataLocalDir(): string | null;
```
- linux: `configDir` = `$XDG_CONFIG_HOME` (if absolute) else `~/.config`;
  `dataLocalDir` = `$XDG_DATA_HOME` (if absolute) else `~/.local/share`.
- darwin: both = `~/Library/Application Support`.
- win32: `configDir` = `%APPDATA%`; `dataLocalDir` = `%LOCALAPPDATA%`.
- Return `null` if the home dir / env var is unavailable. Use `node:os` `homedir`
  and `node:path` `join`/`isAbsolute`.

`ts/src/channel.ts` — async MPSC replacing `tokio::sync::mpsc`. **LOAD-BEARING.**
```ts
export class Channel<T> {
  send(value: T): boolean;            // false if closed (mirrors Rust send Err); non-blocking, unbounded
  recv(): Promise<T | undefined>;     // resolves undefined once closed AND drained
  close(): void;
  get isClosed(): boolean;
}
```
Implementation MUST be a FIFO resolver queue:
- internal `buffer: T[]` and `waiters: ((v: T | undefined) => void)[]`.
- `send`: if closed → return false. If a waiter is queued → shift it and resolve
  with value. Else push to `buffer`. Return true.
- `recv`: if `buffer` non-empty → shift, return resolved promise. Else if closed →
  resolve `undefined`. Else return a new promise whose resolver is pushed to `waiters`.
- `close`: set closed; resolve every queued waiter with `undefined`.

**CRITICAL consumer rule (orphaned-recv trap):** select loops MUST hold the
`recv()` promise across race iterations and renew it ONLY after it resolves:
```ts
let recvP = rx.recv();
while (true) {
  const winner = await Promise.race([
    recvP.then(v => ({ tag: "msg", v } as const)),
    sleep(ms).then(() => ({ tag: "tick" } as const)),
  ]);
  if (winner.tag === "msg") { /* use winner.v */ recvP = rx.recv(); } // renew ONLY here
  // timer branch: just loop; do NOT recreate recvP
}
```
Recreating `recv()` every iteration would register multiple waiters; FIFO `send`
resolves the oldest (orphaned) one, dropping the message. This is the #1 porting
bug. `channel.test.ts` MUST cover: buffered send→recv, pending recv resolved by
later send, FIFO order, **lose-a-race-then-reawait delivers the value (not lost)**,
and close semantics (pending recv → undefined, send after close → false).

## TUI style model — `ts/src/renderer/tui/style.ts`

Replicates `ratatui` `Style`/`Color` as plain data so tests use structural equality.
```ts
export type NamedColor =
  | "reset" | "black" | "red" | "green" | "yellow" | "blue" | "magenta" | "cyan"
  | "gray" | "darkgray" | "lightred" | "lightgreen" | "lightyellow"
  | "lightblue" | "lightmagenta" | "lightcyan" | "white";
export type Color =
  | { type: "named"; name: NamedColor }
  | { type: "rgb"; r: number; g: number; b: number }
  | { type: "indexed"; index: number };
export interface Style { bold: boolean; italic: boolean; underline: boolean; dim: boolean; fg: Color | null }
export function defaultStyle(): Style;                 // all false, fg null
export function parseStyle(input: string): Style;      // split ',', trim+lowercase; faint|dim→dim; unknown ignored
export function parseColor(input: string): Color | null;
export function buildStyle(styleStr: string, color: string | null | undefined): Style;
export function styleToAnsi(style: Style): string;      // opening SGR sequence ("" if empty)
export const RESET: string;                              // "\x1b[0m"
```
`parseColor` replicates `ratatui` `Color::from_str` (case-insensitive, trimmed):
- empty → `null`
- `#rrggbb` (6 hex) → `{type:"rgb",...}` (`#ff5500`→255,85,0; `#000000`→0,0,0)
- all-digits 0–255 → `{type:"indexed",index}` (`245`→indexed 245); out of range → null
- named (incl. `grey`→`gray`, `darkgrey`→`darkgray`) → `{type:"named",name}`
- otherwise → `null` (`notacolor`→null)
`styleToAnsi` SGR: bold→1, dim→2, italic→3, underline→4; fg rgb→`38;2;r;g;b`,
indexed→`38;5;n`, named→standard codes (best-effort; not asserted by tests).

## Renderer (`ts/src/renderer/tui/index.ts`)

Port `TuiRenderer` and its **pure** `build_output` 1:1. Represent a rendered line as:
```ts
export interface RenderedLine { text: string; style: Style | null } // pad lines: { text:"", style:null }
```
`buildOutput(update: Update, height: number): RenderedLine[]` — translate the Rust
algorithm exactly (before/after counts, fitting phase, padding, romanization rows).
Tests inspect only `.text` (helper `lineText(l)=l.text`) and counts, so keep them.
`TuiRenderer.new` → constructor taking `Config`. `run(rx: Channel<Update>)`:
- enter alt screen `\x1b[?1049h`, hide cursor `\x1b[?25l`; on exit leave `\x1b[?1049l`,
  show cursor `\x1b[?25h`; `process.stdin.setRawMode(true)`, restore on exit.
- bridge `process.stdin` `"data"` into a `Channel<string>`; quit on `q`, Esc (`\x1b`),
  Ctrl-C (`\x03`). Use the stable-promise race pattern over the two channels.
- render: center each line to terminal width; error (when `!ignoreErrors`) centered.

## sync.ts

Port `SyncConfig` (durations in **ms numbers**: poll 2000, ui 200, mergeQueue),
`start_sync(player, provider, config): Channel<Update>` (spawn the loop, return the
channel; do NOT await), and the **pure exported** `getIndex(positionMs, currentIndex,
lines): number` and `appendNextTrack(displayLines, artist, track, lyrics): number | null`.
Port `SyncState` + `sync_loop` faithfully. `Instant::now()/elapsed()` → `Date.now()`.
`tokio::select!` → stable-promise race (see channel rule). The player-poll task →
an async function pushing into a `Channel`, looping with `setTimeout`. Keep the
2-arg behavior of `append_next_track` separator: `"── {artist} - {track} ──"`.

## config.ts

```ts
export interface Config {
  style_before: string; style_current: string; style_after: string;
  color_before?: string; color_current?: string; color_after?: string;
  ignore_errors: boolean; merge_queue: boolean;
  romanize: RomanizeMode; romanize_lang: RomanizeLang;
  padding_before: number; padding_after: number;
}
export function defaultConfig(): Config;
export function storagePath(): string;     // configDir()/rstlrx/config.toml; throw if null
export function loadConfig(): Config;       // read+parse TOML over defaults; NotFound→defaults
export function saveConfig(c: Config): string; // write pretty TOML, mkdir -p parent; return path
```
**Keep snake_case keys** (they are the on-disk TOML keys written by the Rust
version — do not rename). Defaults: styles `"faint"/"bold"/"faint"`, colors absent,
flags false, romanize `"off"`, romanize_lang `"auto"`, paddings 0. On save, OMIT
`color_*` keys that are null/undefined (Rust `skip_serializing_if`). On load, merge
parsed partial over defaults (Rust `#[serde(default)]`). Use `smol-toml`
`parse`/`stringify`; read/write via `Bun.file`/`Bun.write`; `mkdir` via `node:fs`.

## player/spotify

`auth.ts` — `SpotifyAuth` with snake_case JSON fields
`{ client_id, client_secret, access_token, refresh_token, expires_at }` (the
on-disk `spotify-auth.json` format). Methods: `storagePath()`
(`dataLocalDir()/rstlrx/spotify-auth.json`), `load()`, `save()`, `authUrl(clientId,
port)`, `exchangeCode(...)`, `getToken()` (refresh if `now+5 >= expires_at`),
`refresh()`, `loginFlow(clientId, clientSecret, port)`, `waitForCallback(port)`.
- `authUrl` scope: `"user-read-currently-playing user-read-playback-state"`,
  redirect `http://127.0.0.1:{port}/callback`, response_type `code`.
- token endpoints use HTTP Basic auth (client_id:client_secret) + form body.
- `waitForCallback` → **`Bun.serve`** on `127.0.0.1:{port}`; capture `?code=`;
  respond `200` HTML `<html><body><h1>Login successful!</h1><p>You can close this
  tab.</p></body></html>`; resolve the code then stop the server.
- `open::that(url)` → `Bun.spawn` platform opener (linux `xdg-open`, darwin `open`,
  win32 `cmd /c start`).
- Preserve stdout lines verbatim: `"Opening browser for Spotify login..."`,
  `"Waiting for callback on port {port}..."`, `"Login successful! Auth saved."`.

`index.ts` — Spotify JSON response interfaces are **snake_case** to match the wire
format (`is_playing`, `progress_ms`, `duration_ms`, `item`, `artists`, `queue`).
Port the pure `joinArtists`, `parseResponse(data): State | null`,
`parseQueueResponse(data): QueueItem[]` (takes only the first queue item). HTTP 204
→ `null` / `[]`. `SpotifyPlayer` implements `Player`; token fetched per request.

## lyrics/lrclib

Port pure `parseLrc(input): Line[]` and `parseLrcLine(line): Line | null`
**byte-for-byte** on the timestamp logic (`[mm:ss.xx]`, 1/2/3-digit ms scaling
×100/×10/×1, `line.length < 10` and first byte `[` guards). `LrclibProvider`
implements `LyricsProvider` via `fetch` to `https://lrclib.net/api/get` with
`user-agent: rstlrx v0.1.0 (https://github.com/txssu/rstlrx)`, 10s timeout
(`AbortSignal.timeout(10000)`), query `artist_name`/`track_name`; non-2xx →
throw `"lrclib: <status>"`; `syncedLyrics` → `parseLrc`; else `plainLyrics` →
lines with `timeMs: 0`; else throw `"lrclib: no lyrics found"`.

## main.ts (CLI)

Use `parseArgs` from `node:util`. Subcommand: if `argv[0] === "login"` parse
`--client-id` (required), `--client-secret` (required), `--port` (default `8888`)
→ `SpotifyAuth.loginFlow`. Otherwise top-level flags (all optional):
`--style-before --style-current --style-after --color-before --color-current
--color-after` (string), `--ignore-errors --merge-queue --save-config` (boolean),
`--romanize` (enum RomanizeMode), `--romanize-lang` (enum RomanizeLang),
`--padding-before --padding-after` (number). Provide `--help`/`-h` text and exit 0.
Merge precedence exactly like `main.rs`: CLI value over stored; booleans are
`cli || stored`; colors `cli ?? stored`. On `--save-config` print
`"Saved config to <path>"`. Then load auth, build `SpotifyPlayer` + `LrclibProvider`,
`startSync`, run `TuiRenderer`.

**Exit codes:** success `0`. Usage error (unknown/invalid flag, missing required
`login` arg, invalid enum value) → message to **stderr**, exit **2** (clap-style).
Runtime error → print anyhow-style `Error: <message>` (+ `Caused by:` chain if any)
to **stderr**, exit **1**. Wrap `main()` in a top-level try/catch implementing this.

## Test porting rules (Rust `#[cfg(test)]` → `bun:test`)

- `import { test, expect, describe } from "bun:test";`
- `assert_eq!(a, b)` → `expect(a).toEqual(b)`; `assert!(x)` → `expect(x).toBe(true)`;
  `assert!(!x)` → `expect(x).toBe(false)`.
- Translate Rust value constructors to the TS data model:
  `Line{time_ms,words}` → `{timeMs,words}`;
  `DisplayLine::Lyric(l)` → `{kind:"lyric",line:l}`,
  `DisplayLine::Separator(s)` → `{kind:"separator",text:s}`;
  `Color::Rgb(255,85,0)` → `{type:"rgb",r:255,g:85,b:0}`;
  `Color::Indexed(245)` → `{type:"indexed",index:245}`;
  `Color::Red` → `{type:"named",name:"red"}`;
  `Style::default().add_modifier(BOLD)` → `{bold:true,italic:false,underline:false,dim:false,fg:null}`.
- Port EVERY `#[test]` from the corresponding Rust module. Keep test names
  descriptive (e.g. `test("parse_lrc_line two digit ms", ...)`).
- JSON-deserialization tests: `JSON.parse` the same fixture and assert the parsed
  shape, then run the pure parser (`parseResponse`, `parseLrc`, etc.).
