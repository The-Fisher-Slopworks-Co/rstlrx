import { pinyin } from "pinyin-pro";
import anyAscii from "any-ascii";

export type RomanizeMode = "off" | "inline" | "duplicate" | "current-only";
export type RomanizeLang = "zh" | "ja" | "ko" | "auto";

/// CJK ranges identical to the Rust `is_cjk`.
function isCjk(c: string): boolean {
  const cp = c.codePointAt(0);
  if (cp === undefined) {
    return false;
  }
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified Ideographs
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Extension A
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK Compatibility
    (cp >= 0x3040 && cp <= 0x309f) || // Hiragana
    (cp >= 0x30a0 && cp <= 0x30ff) || // Katakana
    (cp >= 0xac00 && cp <= 0xd7af) // Hangul Syllables
  );
}

/// Han ideograph ranges — the subset handled via pinyin in `zh` mode.
function isHan(c: string): boolean {
  const cp = c.codePointAt(0);
  if (cp === undefined) {
    return false;
  }
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0xf900 && cp <= 0xfaff)
  );
}

export function hasRomanizable(text: string): boolean {
  for (const c of text) {
    if (isCjk(c)) {
      return true;
    }
  }
  return false;
}

export function romanize(text: string, lang: RomanizeLang): string {
  switch (lang) {
    case "zh":
      return romanizeZh(text);
    case "ja":
      return romanizeJa(text);
    case "ko":
      return romanizeGeneric(text);
    case "auto":
      return romanizeGeneric(text);
  }
}

/// Chinese: pinyin per Han ideograph, any-ascii fallback for other CJK.
function romanizeZh(text: string): string {
  let result = "";
  let prevWasPinyin = false;

  for (const c of text) {
    if (isHan(c)) {
      if (prevWasPinyin) {
        result += " ";
      }
      result += pinyin(c, { toneType: "none" });
      prevWasPinyin = true;
    } else if (isCjk(c)) {
      // CJK char not handled by pinyin (kana/hangul) — fallback.
      if (prevWasPinyin) {
        result += " ";
      }
      result += anyAscii(c);
      prevWasPinyin = true;
    } else {
      result += c;
      prevWasPinyin = false;
    }
  }
  return result;
}

/// Japanese: approximation of Rust's `romanize_ja` (kakasi). A morphological
/// analyzer is not available, so contiguous CJK runs are transliterated together
/// via any-ascii — kana joins without spaces ("ありがとう" -> "arigatou",
/// matching kakasi for the common case); non-CJK text is preserved verbatim.
/// Kanji readings are context-free (any-ascii), so they still differ from kakasi.
function romanizeJa(text: string): string {
  let result = "";
  let run = "";

  for (const c of text) {
    if (isCjk(c)) {
      run += c;
    } else {
      if (run !== "") {
        result += anyAscii(run);
        run = "";
      }
      result += c;
    }
  }
  if (run !== "") {
    result += anyAscii(run);
  }
  return result;
}

/// Generic: any-ascii per CJK char (Korean hangul, auto).
function romanizeGeneric(text: string): string {
  let result = "";
  let prevRomanized = false;

  for (const c of text) {
    if (isCjk(c)) {
      if (prevRomanized) {
        result += " ";
      }
      result += anyAscii(c);
      prevRomanized = true;
    } else {
      result += c;
      prevRomanized = false;
    }
  }
  return result;
}
