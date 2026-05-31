import { test, expect, beforeAll } from "bun:test";
import { hasRomanizable, romanize, initRomanizer } from "./romanize";

// Load the real kuromoji tokenizer once so the `ja` tests exercise the
// dictionary-based (morphological) path rather than the any-ascii fallback.
beforeAll(async () => {
  await initRomanizer();
});

function containsChar(s: string, c: string): boolean {
  return s.includes(c);
}

function anyInRange(s: string, lo: number, hi: number): boolean {
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp >= lo && cp <= hi) {
      return true;
    }
  }
  return false;
}

// --- has_romanizable ---

test("test_has_romanizable_chinese", () => {
  expect(hasRomanizable("你好世界")).toBe(true);
  expect(hasRomanizable("hello 你好")).toBe(true);
});

test("test_has_romanizable_japanese_kana", () => {
  expect(hasRomanizable("ありがとう")).toBe(true);
  expect(hasRomanizable("カタカナ")).toBe(true);
});

test("test_has_romanizable_korean", () => {
  expect(hasRomanizable("한글")).toBe(true);
});

test("test_has_romanizable_latin_only", () => {
  expect(hasRomanizable("hello world")).toBe(false);
  expect(hasRomanizable("")).toBe(false);
  expect(hasRomanizable("123 !@#")).toBe(false);
});

// --- Chinese ---

test("test_zh_basic", () => {
  const result = romanize("你好", "zh");
  expect(containsChar(result, "你")).toBe(false);
  expect(containsChar(result, "好")).toBe(false);
  // Should have a space between two pinyin
  expect(containsChar(result, " ")).toBe(true);
});

test("test_zh_mixed", () => {
  const result = romanize("I love 你", "zh");
  expect(result.startsWith("I love ")).toBe(true);
  expect(containsChar(result, "你")).toBe(false);
});

test("test_zh_preserves_latin", () => {
  expect(romanize("hello", "zh")).toEqual("hello");
});

// --- Japanese ---

test("test_ja_hiragana", () => {
  const result = romanize("ありがとう", "ja");
  // Should produce romaji without any kana
  expect(anyInRange(result, 0x3040, 0x309f)).toBe(false);
  expect(result.length !== 0).toBe(true);
});

test("test_ja_katakana", () => {
  const result = romanize("カタカナ", "ja");
  expect(anyInRange(result, 0x30a0, 0x30ff)).toBe(false);
  expect(result.length !== 0).toBe(true);
});

test("test_ja_kanji", () => {
  const result = romanize("食べる", "ja");
  // Should romanize kanji, not just leave it
  expect(containsChar(result, "食")).toBe(false);
  expect(result.length !== 0).toBe(true);
});

test("test_ja_preserves_latin", () => {
  const result = romanize("hello world", "ja");
  expect(result).toEqual("hello world");
});

// --- Japanese: dictionary-based (kuromoji + wanakana Hepburn) exact values ---
// These prove the upgrade over the any-ascii fallback: kanji now uses the real
// dictionary reading ("食べる" -> "taberu", not any-ascii's "Shiberu"), and kana
// matches kakasi exactly. They require the tokenizer loaded in beforeAll.

test("test_ja_kanji_verb_dictionary_reading", () => {
  expect(romanize("食べる", "ja")).toEqual("taberu");
});

test("test_ja_hiragana_exact", () => {
  expect(romanize("ありがとう", "ja")).toEqual("arigatou");
});

// --- Korean ---

test("test_ko_hangul", () => {
  const result = romanize("한글", "ko");
  expect(containsChar(result, "한")).toBe(false);
  expect(containsChar(result, "글")).toBe(false);
});

// --- Auto ---

test("test_auto_preserves_latin", () => {
  expect(romanize("hello", "auto")).toEqual("hello");
});

test("test_auto_romanizes_cjk", () => {
  const result = romanize("你好", "auto");
  expect(containsChar(result, "你")).toBe(false);
});

// --- No leading/trailing spaces ---

test("test_no_leading_space", () => {
  expect(romanize("你好", "zh").startsWith(" ")).toBe(false);
  expect(romanize("ありがとう", "ja").startsWith(" ")).toBe(false);
  expect(romanize("한글", "ko").startsWith(" ")).toBe(false);
});
