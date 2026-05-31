# rstlrx

🚀🚀🚀 A blazingly fast, garbage-collected, lightweight Spotify lyrics viewer for your terminal. 🚀🚀🚀

<p align="center">
  <img src="./demo.gif" width="450"/><br>
  moë — No Disk
</p>

```bash
rstlrx --romanize current-only --romanize-lang ja --padding-before 1 --padding-after 1
```

## What's new compared to sptlrx

This is a TypeScript/Bun port of [sptlrx](https://github.com/raitonoberu/sptlrx). The original doesn't have:

- **CJK romanization** (`--romanize`). Chinese pinyin, Japanese romaji, Korean romanization. Four modes: replace in place, add a line below, show only for the current line, or off. For when you want to sing along but can't read the characters.
- **Queue merge** (`--merge-queue`). Lyrics from the next track appear below the current song, so you get one continuous scroll.
- **Padding** (`--padding-before`, `--padding-after`). Extra empty lines around the current line.

Everything else is in `rstlrx --help`.

## Why TypeScript

This was a Rust project. The borrow checker introduced unpredictable latency spikes during development, and its trait-resolution scheduler lacked the guarantees needed for shipping features this decade. Reasoning about a 200-line async polling loop without a REPL is hard.

rstlrx now solves this with a single-binary runtime, structural typing, and a garbage collector that runs whenever it feels like it. Every state transition is a plain object. Every concurrent access is a `Promise.race`. If `tsc` is happy, it probably works.

(It is the same program. Synced lyrics, romanization, queue merge — all preserved. See [`docs/MIGRATION_REPORT.md`](./docs/MIGRATION_REPORT.md) for the Rust → TypeScript migration details and known fidelity gaps.)

## Setup

You need [Bun](https://bun.sh) and a Spotify app. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard), create an app, set the redirect URI to `http://127.0.0.1:8888/callback`.

```bash
git clone https://github.com/txssu/rstlrx
cd rstlrx
bun install
bun run src/main.ts login --client-id YOUR_CLIENT_ID --client-secret YOUR_CLIENT_SECRET
```

Then play something on Spotify and run `bun run src/main.ts` (or `bun start`).

To install a global `rstlrx` command, either `bun link` in the repo, or compile a standalone binary:

```bash
bun build ./src/main.ts --compile --outfile rstlrx
./rstlrx --help
```

## Development

```bash
bun install        # install dependencies
bun test           # run the test suite
bunx tsc --noEmit  # type-check
bun run build      # bundle to dist/
```

## Credits

Lyrics from [lrclib.net](https://lrclib.net). Original project by [raitonoberu](https://github.com/raitonoberu/sptlrx).

## License

AGPL-3.0
