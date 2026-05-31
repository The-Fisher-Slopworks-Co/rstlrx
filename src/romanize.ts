import { pinyin } from "pinyin-pro";
import anyAscii from "any-ascii";
import { TokenizerBuilder } from "@patdx/kuromoji";
import NodeDictionaryLoader from "@patdx/kuromoji/node";
import { toRomaji } from "wanakana";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export type RomanizeMode = "off" | "inline" | "duplicate" | "current-only";
export type RomanizeLang = "zh" | "ja" | "ko" | "auto";

/// `Tokenizer` is not re-exported from the package entry, so derive its type
/// from `TokenizerBuilder.build()`.
type Tokenizer = Awaited<ReturnType<TokenizerBuilder["build"]>>;

/// Module-level, lazily-initialized Japanese morphological tokenizer (kuromoji,
/// IPADIC). Null until `initRomanizer` succeeds; `romanizeJa` falls back to the
/// any-ascii per-run path while it is null (before init / if the dict is
/// unavailable).
let jaTokenizer: Tokenizer | null = null;

/// Idempotently build the kuromoji tokenizer once and cache it. The IPADIC
/// dictionary ships inside `@patdx/kuromoji` (`dict/*.dat.gz`); its path is
/// resolved relative to the installed package (never a hardcoded machine path).
/// Loading the dictionary is the one async step — `tokenizer.tokenize()` is
/// synchronous — so `romanize`/`romanizeJa` stay synchronous. Failures are
/// swallowed: on error the tokenizer stays null and `romanizeJa` uses the
/// any-ascii fallback, so romanization never crashes the app.
export async function initRomanizer(): Promise<void> {
  if (jaTokenizer !== null) {
    return;
  }
  try {
    const pkgPath = fileURLToPath(
      import.meta.resolve("@patdx/kuromoji/package.json"),
    );
    const dicPath = join(dirname(pkgPath), "dict");
    const builder = new TokenizerBuilder({
      loader: new NodeDictionaryLoader({ dic_path: dicPath }),
    });
    jaTokenizer = await builder.build();
  } catch {
    // Dictionary unavailable: keep the any-ascii fallback. Not fatal.
    jaTokenizer = null;
  }
}

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

/// Japanese: faithful to Rust's `romanize_ja` (kakasi). When the kuromoji
/// tokenizer is loaded (via `initRomanizer`), tokenize the text and convert each
/// token's katakana `.reading` to Hepburn romaji via wanakana — a dictionary /
/// morphological kanji->reading conversion, same engine class as kakasi
/// ("食べる" -> "taberu"). Tokens without a reading (punctuation, latin/ASCII)
/// keep their surface form, so non-CJK text passes through verbatim.
///
/// Until the tokenizer is loaded (before init / if the dict is unavailable),
/// fall back to the previous behavior: transliterate contiguous CJK runs via
/// any-ascii (kana joins without spaces, matching kakasi for the common case);
/// non-CJK text preserved verbatim.
function romanizeJa(text: string): string {
  if (jaTokenizer !== null) {
    let result = "";
    for (const token of jaTokenizer.tokenize(text)) {
      const reading = token.reading;
      if (reading !== undefined && reading !== "*") {
        result += toRomaji(reading);
      } else {
        // Punctuation, latin, or an unreadable token: keep the surface form.
        result += token.surface_form;
      }
    }
    return result;
  }

  // Fallback (tokenizer not loaded): per-run any-ascii.
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
