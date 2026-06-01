# rstlrx — Rust → TS/Bun Migration Map

Derived from the Rust sources under `../src` and the authoritative `PORT_SPEC.md`.
Conventions: `Result<T>` → throws on error; `Result<Option<T>>` → `T | null` (throws on error);
`Option<T>` → `T | null`; anyhow `.context` → `new Error(msg, { cause })`. Error strings verbatim.
Imports extensionless. snake_case kept ONLY for on-disk TOML/JSON keys (config + spotify-auth).

**Guiding principle:** the target is *functional* identity, not byte-identity. Bytes
something depends on are preserved (`[load-bearing]`); cosmetic formatting nothing
depends on only needs to be equivalent (`[cosmetic]`); and where the port can be
*more correct* than Rust, correctness wins (`[improve]`). "Error strings verbatim"
above is a `[load-bearing]` case (tests + users depend on them), not byte-worship.
Canonical statement: [`PORT_SPEC.md` → "Guiding principle"](./PORT_SPEC.md).

---

## 1. Public API inventory (per Rust module → TS target)

Legend: **pub** = Rust `pub`; **priv→exp** = private in Rust, promoted to exported by spec;
**new** = no Rust source (ratatui/infra supplied it); **internal** = stays unexported (folds into loop/class).

### `src/main.rs` → `ts/src/main.ts`
| Rust item | Vis | TS target |
|---|---|---|
| `struct Cli`, `enum Commands` | priv | parsed inline via `parseArgs` (`node:util`); no exported type |
| `async fn main()` | entry | top-level IIFE / `main()` with try/catch driving exit codes; shebang `#!/usr/bin/env bun` |

### `src/config.rs` → `ts/src/config.ts`
| Rust item | Vis | TS target |
|---|---|---|
| `struct Config` (12 fields) | pub | `interface Config` (snake_case keys kept) |
| `impl Default for Config` | pub | `defaultConfig(): Config` |
| `Config::storage_path()` | pub | `storagePath(): string` (throws if `configDir()` null) |
| `Config::load()` | pub | `loadConfig(): Config` (NotFound → defaults; parse errs throw `"cannot parse <path>"`) |
| `Config::save()` | pub | `saveConfig(c): string` (mkdir -p parent, pretty TOML, OMIT null `color_*`) |

### `src/romanize.rs` → `ts/src/romanize.ts`
| Rust item | Vis | TS target |
|---|---|---|
| `enum RomanizeMode` (Off/Inline/Duplicate/CurrentOnly) | pub | `type RomanizeMode = "off"|"inline"|"duplicate"|"current-only"` (default `"off"`) |
| `enum RomanizeLang` (Zh/Ja/Ko/Auto) | pub | `type RomanizeLang = "zh"|"ja"|"ko"|"auto"` (default `"auto"`) |
| `has_romanizable()` | pub | `hasRomanizable(text): boolean` |
| `romanize()` | pub | `romanize(text, lang): string` |
| `is_cjk()`, `romanize_ja/_zh/_generic()` | priv | internal helpers; ranges identical; `kakasi`-backed `romanize_ja` ported to `@patdx/kuromoji` + `wanakana` with POS-aware word spacing (gap §4 — RESOLVED; see MIGRATION_REPORT §5.1). New helpers `hasKana()` + `romanizeAuto()`: `auto` detects Japanese by kana and uses the `ja` dictionary path (`[improve ✓]`) |

### `src/sync.rs` → `ts/src/sync.ts`
| Rust item | Vis | TS target |
|---|---|---|
| `struct SyncConfig` (poll/ui Duration, merge_queue) | pub | `interface SyncConfig` ms numbers (poll 2000, ui 200, mergeQueue) |
| `impl Default for SyncConfig` | pub | default object (or `defaultSyncConfig()`) |
| `start_sync(player, provider, config)` | pub | `startSync(player, provider, config): Channel<Update>` (spawn loop, return channel, don't await) |
| `get_index(position_ms, current_index, lines)` | pub | `getIndex(positionMs, currentIndex, lines): number` (pure) |
| `append_next_track(display_lines, artist, track, lyrics)` | pub | `appendNextTrack(displayLines, artist, track, lyrics): number | null` (separator `"── {artist} - {track} ──"`) |
| `struct SyncState` + methods, `sync_loop` | priv | **internal** — folds into loop; `Instant::now/elapsed` → `Date.now()`; `tokio::select!` → stable-promise race (channel rule); poll task = async fn + `setTimeout` |

### `src/lyrics/mod.rs` → `ts/src/lyrics/index.ts`
| Rust item | Vis | TS target |
|---|---|---|
| `struct Line { time_ms, words }` | pub | `interface Line { timeMs: number; words: string }` |
| `trait LyricsProvider::fetch` | pub | `interface LyricsProvider { fetch(artist, track): Promise<Line[]> }` |
| `ensure_leading_line()` | pub | `ensureLeadingLine(lines): void` (mutates; unshift `{timeMs:0,words:""}` if `lines[0].timeMs > 1000`) |

### `src/lyrics/lrclib/mod.rs` → `ts/src/lyrics/lrclib/index.ts`
| Rust item | Vis | TS target |
|---|---|---|
| `parse_lrc()` | pub | `parseLrc(input): Line[]` (pure) |
| `parse_lrc_line()` | priv | `parseLrcLine(line): Line | null` (**priv→exp** per spec; byte-for-byte ts logic, `len<10` + first-byte `[` guards, ms scale ×100/×10/×1) |
| `struct LrclibResponse` (synced/plainLyrics) | priv | local `interface` for `JSON.parse` shape |
| `LrclibProvider::new()` + impl | pub | `class LrclibProvider implements LyricsProvider`; `fetch` → `https://lrclib.net/api/get`, UA `rstlrx v0.1.0 (...)`, `AbortSignal.timeout(10000)`, non-2xx → throw `"lrclib: <status>"`, no lyrics → throw `"lrclib: no lyrics found"` |

### `src/player/mod.rs` → `ts/src/player/index.ts`
| Rust item | Vis | TS target |
|---|---|---|
| `struct State` (6 fields) | pub | `interface State { trackId, artist, track, positionMs, durationMs, isPlaying }` |
| `struct QueueItem` | pub | `interface QueueItem { trackId, artist, track }` |
| `trait Player::state/queue` | pub | `interface Player { state(): Promise<State | null>; queue(): Promise<QueueItem[]> }` |

### `src/player/spotify/mod.rs` → `ts/src/player/spotify/index.ts`
| Rust item | Vis | TS target |
|---|---|---|
| `join_artists()` | priv | `joinArtists(artists): string` (**priv→exp**) — `.join(" ")` |
| `parse_response()` | priv | `parseResponse(data): State | null` (**priv→exp**) |
| `parse_queue_response()` | priv | `parseQueueResponse(data): QueueItem[]` (**priv→exp**) — first item only |
| `struct SpotifyResponse/Item/Artist/QueueResponse` | priv | snake_case `interface`s (wire format: `is_playing`, `progress_ms`, `duration_ms`, `item`, `artists`, `queue`) |
| `SpotifyPlayer::new()` + impl | pub | `class SpotifyPlayer implements Player`; token per request; 204 → `null`/`[]`; non-2xx → `"spotify: <status>"` / `"spotify queue: <status>"` |

### `src/player/spotify/auth.rs` → `ts/src/player/spotify/auth.ts`
| Rust item | Vis | TS target |
|---|---|---|
| `struct SpotifyAuth` (5 snake_case fields) | pub | `class SpotifyAuth` with `client_id, client_secret, access_token, refresh_token, expires_at` |
| `storage_path()` | pub | `storagePath()` → `dataLocalDir()/rstlrx/spotify-auth.json` |
| `load()` / `save()` | pub | read/write JSON; load err `"cannot read <path>. Run \`rstlrx login\` first."` |
| `auth_url(client_id, port)` | pub | `authUrl(clientId, port)` — scope `user-read-currently-playing user-read-playback-state`, redirect `http://127.0.0.1:{port}/callback`, `response_type=code` |
| `exchange_code()` | pub | `exchangeCode(...)` — Basic auth + form body |
| `get_token()` | pub | `getToken()` — refresh if `now+5 >= expires_at` |
| `refresh()` | priv | `refresh()` |
| `login_flow()` | pub | `loginFlow(clientId, clientSecret, port)` — stdout `"Opening browser for Spotify login..."` / `"Login successful! Auth saved."` |
| `wait_for_callback()` (raw TcpListener) | priv | `waitForCallback(port)` → **`Bun.serve`** on `127.0.0.1:{port}`, capture `?code=`, 200 HTML, resolve then stop; `"Waiting for callback on port {port}..."` |
| `struct TokenResponse`, `now_secs()` | priv | local interface + `Math.floor(Date.now()/1000)` |

### `src/renderer/mod.rs` → `ts/src/renderer/index.ts`
| Rust item | Vis | TS target |
|---|---|---|
| `enum DisplayLine` (Lyric/Separator) | pub | `type DisplayLine = {kind:"lyric";line:Line} | {kind:"separator";text:string}` |
| `DisplayLine::text()` | pub | `displayLineText(d): string` |
| `struct Update { lines, index, error }` | pub | `interface Update { lines: DisplayLine[]; index: number; error: string | null }` |
| `trait Renderer::run` | pub | `interface Renderer { run(rx: Channel<Update>): Promise<void> }` |

### `src/renderer/tui/style.rs` → `ts/src/renderer/tui/style.ts`
| Rust item | Vis | TS target |
|---|---|---|
| `parse_style()` | pub | `parseStyle(input): Style` — split `,`, trim+lowercase; `faint|dim`→dim; unknown ignored |
| `parse_color()` | pub | `parseColor(input): Color | null` — empty→null, `#rrggbb`→rgb, digits 0–255→indexed (else null), named (`grey`→`gray`, `darkgrey`→`darkgray`), else null |
| `build_style()` | pub | `buildStyle(styleStr, color): Style` |
| ratatui `Style`/`Color`/`Modifier` | **new** | `interface Style {bold,italic,underline,dim,fg}`, `type Color` (named/rgb/indexed), `type NamedColor`, `defaultStyle()`, `styleToAnsi(style): string`, `const RESET="\x1b[0m"` |

### `src/renderer/tui/mod.rs` → `ts/src/renderer/tui/index.ts`
| Rust item | Vis | TS target |
|---|---|---|
| `struct TuiRenderer` | pub | `class TuiRenderer implements Renderer` |
| `TuiRenderer::new(config)` | pub | constructor taking `Config` |
| `build_output(update, height)` | priv | `buildOutput(update, height): RenderedLine[]` (**priv→exp**; pure; port before/after counts, fitting phase, padding, romanization rows 1:1) |
| `run(rx)` | pub | `run(rx: Channel<Update>): Promise<void>` — alt screen `\x1b[?1049h`/`\x1b[?25l`, restore on exit; `process.stdin` raw mode bridged to `Channel<string>`; quit on `q`/Esc(`\x1b`)/Ctrl-C(`\x03`); stable-promise race |
| `display_text()`, `romanization()`, `render()` | priv | **internal** methods |
| `RenderedLine` | **new** | `interface RenderedLine { text: string; style: Style | null }` (pad lines `{text:"",style:null}`) |

---

## 2. CLI surface (exact, from `main.rs`)

`#[command(name = "rstlrx", about = "Terminal lyrics viewer synced with Spotify")]`.
clap kebab-cases field names (`style_before` → `--style-before`, etc.).

### Default command (no subcommand) — 13 top-level flags
All top-level flags are clap `Option<T>` with **no clap default** (default = absent). Effective
defaults come from `Config::default()` applied via the merge in `main()` (see precedence below).

| Flag | Type | clap default | Effective default (Config::default) |
|---|---|---|---|
| `--style-before` | string | none | `"faint"` |
| `--style-current` | string | none | `"bold"` |
| `--style-after` | string | none | `"faint"` |
| `--color-before` | string | none | absent (null) |
| `--color-current` | string | none | absent (null) |
| `--color-after` | string | none | absent (null) |
| `--ignore-errors` | boolean flag | none (false) | `false` |
| `--merge-queue` | boolean flag | none (false) | `false` |
| `--romanize` | enum: `off`\|`inline`\|`duplicate`\|`current-only` | none | `"off"` |
| `--romanize-lang` | enum: `zh`\|`ja`\|`ko`\|`auto` | none | `"auto"` |
| `--padding-before` | number (usize) | none | `0` |
| `--padding-after` | number (usize) | none | `0` |
| `--save-config` | boolean flag | none (false) | n/a (action, not stored) |

**Merge precedence (main.rs lines 109–122):** strings/enums/numbers `cli.unwrap_or(stored)`
(CLI wins if present); colors `cli.or(stored)` (`cli ?? stored`); booleans `cli || stored`.
`--save-config` then prints `"Saved config to <path>"` and writes the merged config.

### `login` subcommand — `enum Commands::Login`
| Arg | Type | Default | Required |
|---|---|---|---|
| `--client-id` | string | — | **yes** |
| `--client-secret` | string | — | **yes** |
| `--port` | u16 (number) | `8888` (clap `default_value`) | no |

Drives `SpotifyAuth::login_flow(client_id, client_secret, port)`.

**Exit codes:** success 0; usage error (unknown/invalid flag, missing required `login` arg,
invalid enum value) → stderr, exit **2**; runtime error → `Error: <message>` (+ `Caused by:` chain)
to stderr, exit **1**. `--help`/`-h` → text, exit 0.

---

## 3. Dependency table (all 17 Cargo deps)

| Cargo dependency | TS / Bun replacement |
|---|---|
| `tokio` (full: mpsc/select/spawn/time/net/io) | `ts/src/channel.ts` (`Channel<T>`) + async loops + `setTimeout`; `Bun.serve` for TcpListener callback; `tokio::Mutex` → not needed (single-threaded await) |
| `reqwest` (json, rustls-tls) | native `fetch` (+ `AbortSignal.timeout`); Basic auth via `Authorization` header; form via `URLSearchParams`; `Url`/`query_pairs_mut` → `URL`/`URLSearchParams` |
| `serde` / `serde_json` | `JSON.parse` / `JSON.stringify` + typed `interface`s |
| `clap` (derive) | `parseArgs` (`node:util`) + thin subcommand layer (manual `--help`, exit-2 usage errors) |
| `ratatui` (0.29) | raw ANSI + plain `Style`/`Color` data model in `style.ts`; `RenderedLine` + centering in `tui/index.ts` |
| `crossterm` (event-stream) | `process.stdin` raw mode (`setRawMode`), alt-screen / cursor ANSI escapes, key bytes bridged into `Channel<string>` |
| `open` (5) | `Bun.spawn` platform opener: linux `xdg-open`, darwin `open`, win32 `cmd /c start` |
| `async-trait` | **no dep** — TS interface methods return `Promise` natively |
| `anyhow` | `throw new Error(msg)` / `new Error(msg, { cause })`; `Error: <msg>` + `Caused by:` chain printing in main |
| `dirs` (6) | `ts/src/dirs.ts` (`configDir`, `dataLocalDir`) via `node:os` homedir + `node:path` |
| `toml` (0.8) | `smol-toml` (`parse`, `stringify`) read/write via `Bun.file`/`Bun.write` |
| `futures` (0.3, `StreamExt`) | **no dep** — native async iteration / the stdin `Channel` bridge (replaces `EventStream`) |
| `any_ascii` (0.3.3) | `any-ascii` npm (`anyAscii(string)`; per-char `anyAscii(c)`) |
| `pinyin` (0.11, `plain`) | `pinyin-pro` — `pinyin(c, { toneType: "none" })` on a **single Han code point only** (never whole string) |
| `kakasi` (0.1) | `@patdx/kuromoji` (IPADIC morphological tokenizer) + `wanakana` (`toRomaji`, Hepburn); kana via wanakana, kanji via dictionary reading, POS-aware word spacing — **gap §4 RESOLVED, see MIGRATION_REPORT §5.1** |

---

## 4. Behavior gaps / risks (preliminary)

Tagged by the guiding principle: `[load-bearing]` (preserve), `[cosmetic]`
(equivalent is enough — not a defect), `[improve]` (Rust is more correct; match it).
See MIGRATION_REPORT §5/§6 for the per-item detail and the recommended improvements.

1. `[improve ✓]` **kakasi → kuromoji + wanakana (Japanese) — RESOLVED.** This was originally
   flagged as a semantic divergence: kakasi does *dictionary* kanji→reading
   (`食べる`→`"taberu"`), whereas the first cut used per-char `anyAscii`
   (`食べる`→`"Shiberu"`, semantically wrong). It is now closed with a real
   morphological analyzer — `@patdx/kuromoji` (IPADIC) for kanji→reading +
   `wanakana.toRomaji` (Hepburn) for kana — plus POS-aware token joining that
   restores kakasi-style word spacing (`こんにちは世界`→`"konnichiha sekai"`) while
   keeping inflections glued (`食べました`→`"tabemashita"`). `any-ascii` remains the
   `ko` path and the fallback before the dictionary loads; **`auto` now detects
   Japanese by kana** and routes kana-bearing text through the dictionary `ja` path
   (`食べる`→`"taberu"`), keeping ambiguous pure-Han on the generic any-ascii path
   (`你好`→`"Ni Hao"`) — `[improve ✓]`, see MIGRATION_REPORT §5.1. Output is correct
   and readable, not byte-identical to kakasi (byte parity was never required). See
   MIGRATION_REPORT §5.1 for the full design and cost (~17MB dict on disk, ~96MB in
   RAM, lazy-loaded only for `ja`/`auto`).

2. `[cosmetic]` **pinyin crate → pinyin-pro drift.** Polyphonic Han chars may map to different readings between
   the two libs. Tests are loose (no Han char remains + a space is present), so drift is not caught.
   MUST call `pinyin()` per single Han code point only — whole-string `{type:"array"}` splits Latin
   runs and breaks `test_zh_mixed` (`"I love 你"` must start with `"I love "`).

3. `[cosmetic]` **CJK double-width centering (silent runtime gap).** ratatui centers `Paragraph` by *display
   width* (CJK glyphs = 2 cells). Naive `string.length`-based centering mis-centers exactly the
   CJK content this tool targets. Not covered by tests (they inspect `.text` only).

4. `[cosmetic]` **ratatui → raw ANSI.** `Style`/`Color` become plain data; `styleToAnsi` named-color codes are
   best-effort and explicitly *not asserted* by tests. The full draw/layout/alt-screen path is hand-
   rolled and untested; risk of escape-sequence / restore-on-panic differences.

5. `[cosmetic]` + `[improve ✓]` **clap → parseArgs nuances.** Must hand-implement: `--help`/`-h` text + exit 0; usage errors
   (unknown flag, invalid enum value, missing required `login` arg) → stderr + exit **2**; enum value
   validation (`romanize`, `romanize-lang`); `u16`/`usize` numeric parsing & range. `parseArgs` does
   none of this for free. Help/error wording is `[cosmetic]`; the `u16`/`usize` range was `[improve]` —
   **RESOLVED:** `parseNumber` now enforces a `max` bound, so `--port` rejects values > 65535
   (clap `u16`) and the paddings are bounded (`Number.MAX_SAFE_INTEGER`, the JS-representable `usize`
   ceiling); out-of-range → stderr + exit 2 (MIGRATION_REPORT §5.3, covered by `main.test.ts`).

6. `[cosmetic]` **anyhow error-chain formatting.** Top-level must print `Error: <message>` then `Caused by:`
   lines walking the `{ cause }` chain, to stderr, exit 1 — mirroring anyhow's `{:?}` Debug output.

7. `[load-bearing]` **dirs platform mapping.** linux `configDir`=`$XDG_CONFIG_HOME` (if absolute) else `~/.config`,
   `dataLocalDir`=`$XDG_DATA_HOME` (if absolute) else `~/.local/share`; darwin both =
   `~/Library/Application Support`; win32 `configDir`=`%APPDATA%`, `dataLocalDir`=`%LOCALAPPDATA%`.
   Return `null` if home/env unavailable (Rust returns `None` → spec throws downstream).

8. `[load-bearing]` **Channel orphaned-recv trap (#1 porting bug).** `tokio::select!` + `mpsc` → FIFO resolver-queue
   `Channel`. Select loops MUST hold the `recv()` promise across race iterations and renew it ONLY
   after it resolves; recreating `recv()` each iteration registers multiple waiters and FIFO `send`
   resolves the oldest (orphaned) one, dropping messages. Affects `sync_loop` and `tui::run`.

9. `[cosmetic]` **`Mutex<SpotifyAuth>` removed.** Rust serializes token refresh via `tokio::Mutex`; single-
   threaded await in TS makes it unnecessary, but concurrent `state()`/`queue()` could each trigger a
   refresh + `save()`. Acceptable (token fetched per request) but a behavioral nuance to note.

10. `[load-bearing]` keys + `[cosmetic]` formatting **TOML serialization shape.** `toml::to_string_pretty` vs `smol-toml` `stringify` formatting may
    differ (key ordering, quoting); on-disk `config.toml` is round-trip-compatible but not necessarily
    byte-identical. `skip_serializing_if = Option::is_none` → OMIT null/undefined `color_*` keys.
