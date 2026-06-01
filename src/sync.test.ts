import { test, expect } from "bun:test";
import { appendNextTrack, getIndex } from "./sync";
import type { Line } from "./lyrics";
import type { DisplayLine } from "./renderer";

function makeLines(times: number[]): Line[] {
  return times.map((t) => ({ timeMs: t, words: `line@${t}` }));
}

test("test_single_line", () => {
  const lines = makeLines([0]);
  expect(getIndex(5000, 0, lines)).toEqual(0);
});

test("test_empty", () => {
  const lines = makeLines([]);
  expect(getIndex(0, 0, lines)).toEqual(0);
});

test("test_before_first_line", () => {
  const lines = makeLines([1000, 2000, 3000]);
  expect(getIndex(500, 0, lines)).toEqual(0);
});

test("test_exact_match_second_line", () => {
  const lines = makeLines([1000, 2000, 3000]);
  expect(getIndex(2000, 0, lines)).toEqual(1);
});

test("test_between_lines", () => {
  const lines = makeLines([1000, 2000, 3000]);
  expect(getIndex(2500, 0, lines)).toEqual(1);
});

test("test_after_last_line", () => {
  const lines = makeLines([1000, 2000, 3000]);
  expect(getIndex(5000, 0, lines)).toEqual(2);
});

test("test_backward_search", () => {
  const lines = makeLines([1000, 2000, 3000]);
  expect(getIndex(1500, 2, lines)).toEqual(0);
});

test("test_from_any_start_index", () => {
  const lines = makeLines([0, 1000, 2000, 3000, 4000]);
  for (let target = 0; target < lines.length; target++) {
    const mid =
      target + 1 < lines.length
        ? Math.floor((lines[target]!.timeMs + lines[target + 1]!.timeMs) / 2)
        : lines[target]!.timeMs + 500;
    for (let start = 0; start < lines.length; start++) {
      expect(getIndex(mid, start, lines)).toEqual(target);
    }
  }
});

test("test_append_next_track_basic", () => {
  const lines: DisplayLine[] = makeLines([1000, 2000]).map((line) => ({
    kind: "lyric",
    line,
  }));
  const next = makeLines([0, 500]);
  const start = appendNextTrack(lines, "Artist", "Song", next);
  expect(start).toEqual(3);
  expect(lines.length).toEqual(5);
  const sep = lines[2]!;
  expect(sep.kind === "separator" && sep.text.includes("Artist")).toBe(true);
  const lyr = lines[3]!;
  expect(lyr.kind === "lyric" && lyr.line.timeMs === 0).toBe(true);
});

test("test_append_next_track_empty_lyrics", () => {
  const lines: DisplayLine[] = makeLines([1000]).map((line) => ({
    kind: "lyric",
    line,
  }));
  const result = appendNextTrack(lines, "Artist", "Song", []);
  expect(result).toEqual(null);
  expect(lines.length).toEqual(1);
});

test("test_append_next_track_preserves_existing", () => {
  const lines: DisplayLine[] = [
    { kind: "lyric", line: { timeMs: 100, words: "old" } },
    { kind: "separator", text: "── Old ──" },
    { kind: "lyric", line: { timeMs: 200, words: "current" } },
  ];
  const next = makeLines([0]);
  const start = appendNextTrack(lines, "New", "Track", next);
  expect(start).toEqual(4);
  expect(lines.length).toEqual(5);
  const first = lines[0]!;
  expect(first.kind === "lyric" ? first.line.words : first.text).toEqual("old");
});

test("test_append_next_track_separator_format", () => {
  const lines: DisplayLine[] = makeLines([1000]).map((line) => ({
    kind: "lyric",
    line,
  }));
  const next = makeLines([0]);
  appendNextTrack(lines, "Lord Huron", "The Night We Met", next);
  const sep = lines[1]!;
  if (sep.kind === "separator") {
    expect(sep.text).toEqual("── Lord Huron - The Night We Met ──");
  } else {
    throw new Error("Expected Separator at index 1");
  }
});
