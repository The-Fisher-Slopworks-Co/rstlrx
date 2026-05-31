import type { Line, LyricsProvider } from "../index";

interface LrclibResponse {
  syncedLyrics: string | null;
  plainLyrics: string | null;
}

// Strict unsigned-integer parse matching Rust's `u64::from_str`:
// only ASCII digits, non-empty. Returns null on any other input.
function parseU64(s: string): number | null {
  if (s.length === 0) return null;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x30 || code > 0x39) return null;
  }
  return Number(s);
}

export function parseLrc(input: string): Line[] {
  const lines: Line[] = [];
  for (const line of splitLines(input)) {
    const parsed = parseLrcLine(line);
    if (parsed !== null) lines.push(parsed);
  }
  return lines;
}

export function parseLrcLine(line: string): Line | null {
  line = line.trim();
  // Rust uses byte length for `line.len()`.
  if (Buffer.byteLength(line, "utf8") < 10 || line.codePointAt(0) !== 0x5b /* '[' */) {
    return null;
  }

  const close = line.indexOf("]");
  if (close === -1) return null;

  const timestamp = line.slice(1, close);
  const words = line.slice(close + 1).trim();

  const colon = timestamp.indexOf(":");
  if (colon === -1) return null;
  const minStr = timestamp.slice(0, colon);
  const rest = timestamp.slice(colon + 1);

  const dot = rest.indexOf(".");
  if (dot === -1) return null;
  const secStr = rest.slice(0, dot);
  const msStr = rest.slice(dot + 1);

  const minutes = parseU64(minStr);
  if (minutes === null) return null;
  const seconds = parseU64(secStr);
  if (seconds === null) return null;
  const msRaw = parseU64(msStr);
  if (msRaw === null) return null;

  let ms: number;
  switch (msStr.length) {
    case 1:
      ms = msRaw * 100;
      break;
    case 2:
      ms = msRaw * 10;
      break;
    case 3:
      ms = msRaw;
      break;
    default:
      return null;
  }

  return {
    timeMs: minutes * 60_000 + seconds * 1_000 + ms,
    words,
  };
}

// Mirror Rust `str::lines()`: split on '\n', stripping a trailing '\r' from each
// line, and do not yield a trailing empty line after a final '\n'.
function splitLines(input: string): string[] {
  if (input.length === 0) return [];
  const out: string[] = [];
  const parts = input.split("\n");
  // `str::lines()` does not produce a final empty entry for a trailing newline.
  const end = parts.length > 0 && parts[parts.length - 1] === "" ? parts.length - 1 : parts.length;
  for (let i = 0; i < end; i++) {
    let part = parts[i]!;
    if (part.endsWith("\r")) part = part.slice(0, -1);
    out.push(part);
  }
  return out;
}

// Mirror Rust `StatusCode` Display: "<code> <reason>" (e.g. "404 Not Found").
function statusText(resp: Response): string {
  return resp.statusText ? `${resp.status} ${resp.statusText}` : `${resp.status}`;
}

export class LrclibProvider implements LyricsProvider {
  async fetch(artist: string, track: string): Promise<Line[]> {
    const url = new URL("https://lrclib.net/api/get");
    url.searchParams.set("artist_name", artist);
    url.searchParams.set("track_name", track);

    const resp = await globalThis.fetch(url, {
      headers: {
        "user-agent": "rstlrx v0.1.0 (https://github.com/txssu/rstlrx)",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) {
      throw new Error(`lrclib: ${statusText(resp)}`);
    }

    const data = (await resp.json()) as LrclibResponse;

    if (data.syncedLyrics != null) {
      return parseLrc(data.syncedLyrics);
    } else if (data.plainLyrics != null) {
      return splitLines(data.plainLyrics).map((l) => ({ timeMs: 0, words: l }));
    } else {
      throw new Error("lrclib: no lyrics found");
    }
  }
}
