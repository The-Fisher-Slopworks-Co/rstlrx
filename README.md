# rstlrx

🚀🚀🚀 A blazingly fast, memory-safe, lightweight Spotify lyrics viewer for your terminal. 🚀🚀🚀

<img src="./demo.gif" width="450"/>

## What's new compared to sptlrx

This is a Rust port of [sptlrx](https://github.com/raitonoberu/sptlrx). The original doesn't have:

- **CJK romanization** (`--romanize`). Chinese pinyin, Japanese romaji, Korean romanization. Four modes: replace in place, add a line below, show only for the current line, or off. For when you want to sing along but can't read the characters.
- **Queue merge** (`--merge-queue`). Lyrics from the next track appear below the current song, so you get one continuous scroll.
- **Padding** (`--padding-before`, `--padding-after`). Extra empty lines around the current line.

Everything else is in `rstlrx --help`.

## Why Rust

The Go garbage collector introduces unpredictable latency spikes during terminal rendering, and its goroutine scheduler lacks the guarantees needed for precise lyric synchronization. Reasoning about state transitions in a concurrent polling loop without a strong type system is hard.

rstlrx solves this with zero-cost abstractions, fearless concurrency, and compile-time correctness. Every state transition is encoded in the type system. Every concurrent access is verified by the borrow checker. If it compiles, it works.

## Setup

You need a Spotify app. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard), create an app, set the redirect URI to `http://127.0.0.1:8888/callback`.

```bash
git clone https://github.com/txssu/rstlrx
cd rstlrx
cargo install --path .
rstlrx login --client-id YOUR_CLIENT_ID --client-secret YOUR_CLIENT_SECRET
```

Then play something on Spotify and run `rstlrx`.

## Credits

Lyrics from [lrclib.net](https://lrclib.net). Original project by [raitonoberu](https://github.com/raitonoberu/sptlrx).

## License

AGPL-3.0
