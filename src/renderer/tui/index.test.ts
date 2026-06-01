import { test, expect } from "bun:test";
import { TuiRenderer } from "./index";
import type { RenderedLine } from "./index";
import { defaultConfig } from "../../config";
import type { Config } from "../../config";
import type { DisplayLine, Update } from "../index";
import { hasRomanizable } from "../../romanize";
import type { RomanizeLang, RomanizeMode } from "../../romanize";

function makeRenderer(paddingBefore: number, paddingAfter: number): TuiRenderer {
  const config: Config = {
    ...defaultConfig(),
    padding_before: paddingBefore,
    padding_after: paddingAfter,
  };
  return new TuiRenderer(config);
}

function makeLines(words: string[]): DisplayLine[] {
  return words.map((w, i) => ({
    kind: "lyric",
    line: { timeMs: i * 1000, words: w },
  }));
}

function makeUpdate(words: string[], index: number): Update {
  return {
    lines: makeLines(words),
    index,
    error: null,
  };
}

function lineText(line: RenderedLine): string {
  return line.text;
}

function findCurrent(output: RenderedLine[], text: string): number {
  const pos = output.findIndex((l) => lineText(l) === text);
  if (pos === -1) {
    throw new Error(`current line '${text}' not found in output`);
  }
  return pos;
}

test("test_padding_before_inserts_empty_lines", () => {
  const renderer = makeRenderer(2, 0);
  const update = makeUpdate(["one", "two", "three", "four", "five"], 2);
  const output = renderer.buildOutput(update, 20);

  const currentPos = findCurrent(output, "three");

  // The 2 lines immediately before current must be empty (padding)
  expect(lineText(output[currentPos - 1])).toEqual("");
  expect(lineText(output[currentPos - 2])).toEqual("");
  // The line before the padding should be a real lyric
  expect(lineText(output[currentPos - 3])).toEqual("two");
});

test("test_padding_after_inserts_empty_lines", () => {
  const renderer = makeRenderer(0, 2);
  const update = makeUpdate(["one", "two", "three", "four", "five"], 2);
  const output = renderer.buildOutput(update, 20);

  const currentPos = findCurrent(output, "three");

  // The 2 lines immediately after current must be empty (padding)
  expect(lineText(output[currentPos + 1])).toEqual("");
  expect(lineText(output[currentPos + 2])).toEqual("");
  // The line after the padding should be a real lyric
  expect(lineText(output[currentPos + 3])).toEqual("four");
});

test("test_padding_both_directions", () => {
  const renderer = makeRenderer(1, 1);
  const update = makeUpdate(["one", "two", "three", "four", "five"], 2);
  const output = renderer.buildOutput(update, 20);

  const currentPos = findCurrent(output, "three");

  expect(lineText(output[currentPos - 1])).toEqual("");
  expect(lineText(output[currentPos + 1])).toEqual("");
});

test("test_padding_zero_is_no_op", () => {
  const renderer = makeRenderer(0, 0);
  const update = makeUpdate(["one", "two", "three", "four", "five"], 2);
  const output = renderer.buildOutput(update, 20);

  const currentPos = findCurrent(output, "three");

  // Without padding, the adjacent lines should be real lyrics
  expect(lineText(output[currentPos - 1])).toEqual("two");
  expect(lineText(output[currentPos + 1])).toEqual("four");
});

function makeRendererWithRomanize(
  mode: RomanizeMode,
  lang: RomanizeLang,
): TuiRenderer {
  const config: Config = {
    ...defaultConfig(),
    romanize: mode,
    romanize_lang: lang,
  };
  return new TuiRenderer(config);
}

test("test_current_only_romanizes_current_line", () => {
  const renderer = makeRendererWithRomanize("current-only", "auto");
  // All CJK lines; current is index=1 ("世界")
  const update = makeUpdate(["你好", "世界", "再见"], 1);
  const output = renderer.buildOutput(update, 10);

  const currentPos = findCurrent(output, "世界");
  // Romanization line should follow immediately after current
  const rom = lineText(output[currentPos + 1]);
  expect(rom.length > 0).toBe(true);
  expect(hasRomanizable(rom)).toBe(false);
});

test("test_current_only_no_romanization_for_non_current_lines", () => {
  const renderer = makeRendererWithRomanize("current-only", "auto");
  // All lines are CJK, current is index=1 ("世界")
  const update = makeUpdate(["你好", "世界", "再见"], 1);
  const output = renderer.buildOutput(update, 10);

  // Non-empty lines should be: "你好", "世界", <romanization>, "再见" = 4 total
  const nonEmpty = output
    .map((l) => lineText(l))
    .filter((t) => t.length > 0);
  expect(nonEmpty.length).toEqual(4);

  // "你好" should appear as-is (not romanized inline)
  expect(nonEmpty.includes("你好")).toBe(true);
  // "再见" should appear as-is (not romanized inline)
  expect(nonEmpty.includes("再见")).toBe(true);
});

test("test_output_height_preserved_with_padding", () => {
  const renderer = makeRenderer(3, 2);
  const update = makeUpdate(
    ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"],
    4,
  );
  const output = renderer.buildOutput(update, 20);

  expect(output.length).toEqual(20);
});
