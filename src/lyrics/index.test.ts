import { test, expect } from "bun:test";
import { ensureLeadingLine, type Line } from "./index";

test("test_ensure_leading_line_inserts_when_late", () => {
  const lines: Line[] = [
    { timeMs: 1830, words: "Song" },
    { timeMs: 3000, words: "More" },
  ];
  ensureLeadingLine(lines);
  expect(lines.length).toEqual(3);
  expect(lines[0]!.timeMs).toEqual(0);
  expect(lines[0]!.words).toEqual("");
  expect(lines[1]!.timeMs).toEqual(1830);
});

test("test_ensure_leading_line_no_insert_when_early", () => {
  const lines: Line[] = [{ timeMs: 540, words: "Song" }];
  ensureLeadingLine(lines);
  expect(lines.length).toEqual(1);
  expect(lines[0]!.timeMs).toEqual(540);
});

test("test_ensure_leading_line_no_insert_at_boundary", () => {
  const lines: Line[] = [{ timeMs: 1000, words: "Song" }];
  ensureLeadingLine(lines);
  expect(lines.length).toEqual(1);
});

test("test_ensure_leading_line_empty_vec", () => {
  const lines: Line[] = [];
  ensureLeadingLine(lines);
  expect(lines.length === 0).toBe(true);
});
