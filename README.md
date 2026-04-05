# rstlrx

Synced lyrics in your terminal. Like karaoke, but for Spotify.

```
        I've been searching for a trail to follow again
        Take me back to the night we met

        I don't know what I'm supposed to do

        Haunted by the ghost of you
        Take me back to the night we met
```

The current line sits in the middle of your screen. Previous and upcoming lyrics scroll around it.

## What you need

- A Spotify account (free or premium)
- A Spotify Developer app (see below)
- Rust toolchain to build from source

## Install

```bash
git clone https://github.com/txssu/rstlrx
cd rstlrx
cargo install --path .
```

## Spotify setup

You need a Spotify app to let rstlrx read your playback state. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard), create an app, and set the redirect URI to `http://127.0.0.1:8888/callback`.

Then log in:

```bash
rstlrx login --client-id YOUR_CLIENT_ID --client-secret YOUR_CLIENT_SECRET
```

This opens your browser, you authorize, and the tokens get saved locally. You only do this once.

## Usage

Play something on Spotify, then run:

```bash
rstlrx
```

Lyrics appear synced to your playback. Press `q` or `Esc` to quit.

### Queue merge

By default, rstlrx shows one song at a time. If you want a continuous scroll across tracks (next song's lyrics appear below the current one with a separator):

```bash
rstlrx --merge-queue
```

### Styling

The default look is faint text above and below, bold for the current line. You can change that:

```bash
# Bold italic current line in cyan, dim surroundings in gray
rstlrx --style-current bold,italic --color-current cyan --color-before gray --color-after gray

# Red current line with underline
rstlrx --style-current bold,underline --color-current "#ff3333"

# ANSI color codes work too
rstlrx --color-current 214 --color-before 240 --color-after 240
```

Style options: `bold`, `italic`, `underline`, `faint`. Combine with commas.

Color formats: named (`red`, `cyan`, `gray`), hex (`#ff5500`), ANSI 0-255 (`245`).

### Errors

By default, errors (Spotify unreachable, no lyrics found) show up in the UI. If that bothers you:

```bash
rstlrx --ignore-errors
```

## How it works

rstlrx polls your Spotify playback every 2 seconds and interpolates the position between polls (200ms ticks). When the track changes, it fetches synced lyrics from [lrclib.net](https://lrclib.net). If there's a next track in your Spotify queue, rstlrx fetches its lyrics too and stitches them together with a separator — so you get one continuous scroll of text across songs.

Internally there are three trait abstractions: `Player` (reports what's playing), `LyricsProvider` (fetches lyrics), and `Renderer` (draws them). Right now the only implementations are Spotify, lrclib.net, and the terminal UI, but adding a new source or output is just a trait impl and a few lines in `main.rs`.

## Credits

A Rust port of [sptlrx](https://github.com/raitonoberu/sptlrx) by raitonoberu.

Lyrics provided by [lrclib.net](https://lrclib.net).

## License

AGPL-3.0
