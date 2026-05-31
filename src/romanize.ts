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

/// The structural shape of a kuromoji/IPADIC token that the spacing logic reads.
/// (Derived from the tokenizer's element type so we never use `any`.)
type JaToken = ReturnType<Tokenizer["tokenize"]>[number];

/// `pos_detail_1` values that ATTACH to the preceding word — i.e. take NO leading
/// space — so morphological inflections read as one word instead of being
/// over-segmented. Verified empirically against kuromoji/IPADIC on real samples:
/// `非自立` (non-independent verb, e.g. the てる/いる in 愛してる / 食べている),
/// `接尾` (suffix), `接続助詞` (conjunctive particle, e.g. the て in 走って /
/// 食べている).
const JA_ATTACH_POS_DETAIL_1 = new Set(["非自立", "接尾", "接続助詞"]);

/// `pos` values that take inflection / auxiliaries (verbs, adjectives, and
/// auxiliaries themselves). An auxiliary verb (助動詞) attaches only when it
/// follows one of these — so 食べ + ます → "tabemasu" (verb) and まし + た is
/// glued (auxiliary chain) — but NOT after a noun, where it is the copula and
/// kakasi spaces it: 学生 + です → "gakusei desu".
const JA_INFLECTABLE_POS = new Set(["動詞", "形容詞", "助動詞"]);

/// Decide whether `token` attaches to the word built so far (takes no leading
/// space). `prev` is the immediately-preceding token (the basis for the auxiliary
/// copula distinction); `null` for the first token, which never attaches.
function jaAttaches(token: JaToken, prev: JaToken | null): boolean {
  if (prev === null) {
    return false;
  }
  // Whitespace tokens (記号/空白) are hard separators — handled by the caller as
  // singleton groups — so never attach to or across them.
  const tokenIsWhitespace = token.pos === "記号" && token.pos_detail_1 === "空白";
  const prevIsWhitespace = prev.pos === "記号" && prev.pos_detail_1 === "空白";
  if (tokenIsWhitespace || prevIsWhitespace) {
    return false;
  }
  // Punctuation (記号 that is not whitespace, e.g. ！ 。 、) attaches to the
  // preceding word, so there is no space before it ("sekai!" not "sekai !").
  if (token.pos === "記号") {
    return true;
  }
  // Conversely, a token immediately following punctuation starts a new word and
  // takes a leading space ("a, i" not "a,i").
  if (prev.pos === "記号") {
    return false;
  }
  if (JA_ATTACH_POS_DETAIL_1.has(token.pos_detail_1)) {
    return true;
  }
  // Auxiliary verb: glues to a preceding verb/adjective/auxiliary, but starts a
  // new word after a noun (it is the copula です/だ) — matching kakasi's spacing.
  if (token.pos === "助動詞") {
    return JA_INFLECTABLE_POS.has(prev.pos);
  }
  return false;
}

/// Render one word group (an array of tokens) to romaji. Consecutive tokens that
/// have a katakana `.reading` are converted as ONE contiguous run via wanakana —
/// not per token — so a sokuon (small っ) or long vowel sitting at a token
/// boundary survives: kuromoji reads 走っ as "ハシッ" (which wanakana alone would
/// render "hashi"), and joining "ハシッ" + "テ" before conversion yields the
/// correct "hashitte". Tokens without a reading (punctuation, latin/ASCII) break
/// the run and keep their surface form verbatim, so non-CJK text passes through
/// unchanged and we never romanize across a latin chunk.
function renderJaGroup(group: JaToken[]): string {
  let result = "";
  let katakanaRun = "";
  const flushRun = (): void => {
    if (katakanaRun !== "") {
      result += toRomaji(katakanaRun);
      katakanaRun = "";
    }
  };
  for (const token of group) {
    const reading = token.reading;
    if (reading !== undefined && reading !== "*") {
      katakanaRun += reading;
    } else {
      flushRun();
      result += token.surface_form;
    }
  }
  flushRun();
  return result;
}

/// Japanese: faithful to Rust's `romanize_ja` (kakasi), which inserted spaces
/// between words ("こんにちは世界！" -> "konnichiha sekai!"). When the kuromoji
/// tokenizer is loaded (via `initRomanizer`), tokenize the text into morphemes,
/// then partition them into word groups — each independent word together with the
/// inflections / auxiliaries that attach to it (POS-aware: see `jaAttaches`). A
/// new group starts at the first token or at any token whose grammatical role
/// does NOT attach. Each group is rendered (see `renderJaGroup`) and groups are
/// joined with a single space, so word boundaries get spacing while inflections
/// stay glued ("食べました" -> "tabemashita", NOT "tabe mashi ta"; "走って" ->
/// "hashitte"; "学生です" -> "gakusei desu").
///
/// Whitespace (記号/空白) tokens already present in the input are their own
/// groups, emitted as their literal surface form, and act as hard boundaries, so
/// existing spacing in mixed text is preserved without doubling ("I love 君" ->
/// "I love kimi", "hello world" -> "hello world").
///
/// Until the tokenizer is loaded (before init / if the dict is unavailable),
/// fall back to the previous behavior: transliterate contiguous CJK runs via
/// any-ascii (kana joins without spaces, matching kakasi for the common case);
/// non-CJK text preserved verbatim.
function romanizeJa(text: string): string {
  if (jaTokenizer !== null) {
    const tokens = jaTokenizer.tokenize(text);

    // First pass: partition tokens into word groups using the real token
    // objects, so every attach/space decision is made before any rendering.
    // Whitespace tokens become singleton groups (emitted as the literal space).
    const groups: JaToken[][] = [];
    let prev: JaToken | null = null;
    for (const token of tokens) {
      const isWhitespace =
        token.pos === "記号" && token.pos_detail_1 === "空白";
      if (isWhitespace || groups.length === 0 || !jaAttaches(token, prev)) {
        groups.push([token]);
      } else {
        groups[groups.length - 1]!.push(token);
      }
      prev = token;
    }

    // Second pass: render each group, then join with single spaces. A group that
    // renders to pure whitespace (an input space token) is emitted verbatim and
    // suppresses the surrounding join space, so a space is never doubled.
    let result = "";
    let needSpace = false;
    for (const group of groups) {
      const rendered = renderJaGroup(group);
      if (rendered === "") {
        continue;
      }
      if (rendered.trim() === "") {
        result += rendered;
        needSpace = false;
        continue;
      }
      if (needSpace && !result.endsWith(" ")) {
        result += " ";
      }
      result += rendered;
      needSpace = true;
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
