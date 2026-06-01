import { test, expect, describe } from "bun:test";
import { parseLrc, parseLrcLine } from "./index";
import type { Line } from "../index";

interface LrclibResponse {
  syncedLyrics: string | null;
  plainLyrics: string | null;
}

describe("lrclib", () => {
  test("parse_lrc_line two digit ms", () => {
    expect(parseLrcLine("[00:17.12] Hello world")).toEqual({
      timeMs: 17120,
      words: "Hello world",
    });
  });

  test("parse_lrc_line three digit ms", () => {
    expect(parseLrcLine("[01:30.500] Test line")).toEqual({
      timeMs: 90500,
      words: "Test line",
    });
  });

  test("parse_lrc_line one digit ms", () => {
    expect(parseLrcLine("[00:05.5] Short")).toEqual({
      timeMs: 5500,
      words: "Short",
    });
  });

  test("parse_lrc_line zero time", () => {
    expect(parseLrcLine("[00:00.00] Start")).toEqual({
      timeMs: 0,
      words: "Start",
    });
  });

  test("parse_lrc_line empty words", () => {
    expect(parseLrcLine("[00:10.00]")).toEqual({
      timeMs: 10000,
      words: "",
    });
  });

  test("parse_lrc_line invalid inputs", () => {
    expect(parseLrcLine("not a timestamp")).toBe(null);
    expect(parseLrcLine("")).toBe(null);
    expect(parseLrcLine("short")).toBe(null);
    expect(parseLrcLine("[invalid] text")).toBe(null);
  });

  test("parse_lrc multiline", () => {
    const input = "[00:01.00] Line one\n[00:05.00] Line two\n[00:10.00] Line three";
    const result = parseLrc(input);
    expect(result.length).toBe(3);
    expect(result[0]).toEqual({ timeMs: 1000, words: "Line one" });
    expect(result[1]).toEqual({ timeMs: 5000, words: "Line two" });
    expect(result[2]).toEqual({ timeMs: 10000, words: "Line three" });
  });

  test("parse_lrc skips invalid lines", () => {
    const input = "[00:01.00] Valid\nsome garbage\n[00:05.00] Also valid";
    const result = parseLrc(input);
    expect(result.length).toBe(2);
  });

  test("deserialize lrclib response synced", () => {
    const json = `{"syncedLyrics": "[00:01.00] Hello\\n[00:05.00] World", "plainLyrics": "Hello\\nWorld"}`;
    const resp = JSON.parse(json) as LrclibResponse;
    expect(resp.syncedLyrics != null).toBe(true);
    const lines = parseLrc(resp.syncedLyrics!);
    expect(lines.length).toBe(2);
    expect(lines[0]!.words).toBe("Hello");
    expect(lines[1]!.words).toBe("World");
  });

  test("deserialize lrclib response plain only", () => {
    const json = `{"syncedLyrics": null, "plainLyrics": "Hello\\nWorld"}`;
    const resp = JSON.parse(json) as LrclibResponse;
    expect(resp.syncedLyrics == null).toBe(true);
    expect(resp.plainLyrics!).toBe("Hello\nWorld");
  });
});

// Type-level assertion that parseLrc returns Line[].
const _typecheck: Line[] = parseLrc("[00:01.00] x");
void _typecheck;
