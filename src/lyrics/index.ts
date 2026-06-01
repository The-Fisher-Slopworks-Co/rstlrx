export interface Line {
  timeMs: number;
  words: string;
}

export interface LyricsProvider {
  fetch(artist: string, track: string): Promise<Line[]>;
}

export function ensureLeadingLine(lines: Line[]): void {
  const first = lines[0];
  if (first !== undefined && first.timeMs > 1000) {
    lines.unshift({ timeMs: 0, words: "" });
  }
}
