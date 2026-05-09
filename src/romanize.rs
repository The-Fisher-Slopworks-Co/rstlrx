use clap::ValueEnum;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Default, PartialEq, Eq, ValueEnum, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RomanizeMode {
    #[default]
    Off,
    Inline,
    Duplicate,
    CurrentOnly,
}

#[derive(Clone, Copy, Default, PartialEq, Eq, ValueEnum, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RomanizeLang {
    /// Chinese pinyin
    Zh,
    /// Japanese romaji (kanji + kana)
    Ja,
    /// Korean revised romanization
    Ko,
    /// Auto-detect per character (Chinese reading for kanji)
    #[default]
    Auto,
}

fn is_cjk(c: char) -> bool {
    matches!(c,
        '\u{4E00}'..='\u{9FFF}'   // CJK Unified Ideographs
        | '\u{3400}'..='\u{4DBF}' // CJK Extension A
        | '\u{F900}'..='\u{FAFF}' // CJK Compatibility
        | '\u{3040}'..='\u{309F}' // Hiragana
        | '\u{30A0}'..='\u{30FF}' // Katakana
        | '\u{AC00}'..='\u{D7AF}' // Hangul Syllables
    )
}

pub fn has_romanizable(text: &str) -> bool {
    text.chars().any(is_cjk)
}

pub fn romanize(text: &str, lang: RomanizeLang) -> String {
    match lang {
        RomanizeLang::Ja => romanize_ja(text),
        RomanizeLang::Zh => romanize_zh(text),
        RomanizeLang::Ko => romanize_generic(text),
        RomanizeLang::Auto => romanize_generic(text),
    }
}

/// Japanese: use kakasi for kanji+kana→romaji
fn romanize_ja(text: &str) -> String {
    kakasi::convert(text).romaji
}

/// Chinese: use pinyin crate for accurate pinyin
fn romanize_zh(text: &str) -> String {
    use pinyin::ToPinyin;

    let mut result = String::new();
    let mut prev_was_pinyin = false;

    for c in text.chars() {
        if let Some(py) = c.to_pinyin() {
            if prev_was_pinyin {
                result.push(' ');
            }
            result.push_str(py.plain());
            prev_was_pinyin = true;
        } else if is_cjk(c) {
            // CJK char not in pinyin dict (kana/hangul) — fallback
            if prev_was_pinyin {
                result.push(' ');
            }
            result.push_str(&any_ascii::any_ascii_char(c));
            prev_was_pinyin = true;
        } else {
            result.push(c);
            prev_was_pinyin = false;
        }
    }
    result
}

/// Generic: any_ascii for Korean hangul and auto mode
fn romanize_generic(text: &str) -> String {
    let mut result = String::new();
    let mut prev_romanized = false;

    for c in text.chars() {
        if is_cjk(c) {
            if prev_romanized {
                result.push(' ');
            }
            result.push_str(&any_ascii::any_ascii_char(c));
            prev_romanized = true;
        } else {
            result.push(c);
            prev_romanized = false;
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- has_romanizable ---

    #[test]
    fn test_has_romanizable_chinese() {
        assert!(has_romanizable("你好世界"));
        assert!(has_romanizable("hello 你好"));
    }

    #[test]
    fn test_has_romanizable_japanese_kana() {
        assert!(has_romanizable("ありがとう"));
        assert!(has_romanizable("カタカナ"));
    }

    #[test]
    fn test_has_romanizable_korean() {
        assert!(has_romanizable("한글"));
    }

    #[test]
    fn test_has_romanizable_latin_only() {
        assert!(!has_romanizable("hello world"));
        assert!(!has_romanizable(""));
        assert!(!has_romanizable("123 !@#"));
    }

    // --- Chinese ---

    #[test]
    fn test_zh_basic() {
        let result = romanize("你好", RomanizeLang::Zh);
        assert!(!result.contains('你'));
        assert!(!result.contains('好'));
        // Should have a space between two pinyin
        assert!(result.contains(' '));
    }

    #[test]
    fn test_zh_mixed() {
        let result = romanize("I love 你", RomanizeLang::Zh);
        assert!(result.starts_with("I love "));
        assert!(!result.contains('你'));
    }

    #[test]
    fn test_zh_preserves_latin() {
        assert_eq!(romanize("hello", RomanizeLang::Zh), "hello");
    }

    // --- Japanese ---

    #[test]
    fn test_ja_hiragana() {
        let result = romanize("ありがとう", RomanizeLang::Ja);
        // Should produce romaji without any kana
        assert!(!result.chars().any(|c| matches!(c, '\u{3040}'..='\u{309F}')));
        assert!(!result.is_empty());
    }

    #[test]
    fn test_ja_katakana() {
        let result = romanize("カタカナ", RomanizeLang::Ja);
        assert!(!result.chars().any(|c| matches!(c, '\u{30A0}'..='\u{30FF}')));
        assert!(!result.is_empty());
    }

    #[test]
    fn test_ja_kanji() {
        let result = romanize("食べる", RomanizeLang::Ja);
        // Should romanize kanji, not just leave it
        assert!(!result.contains('食'));
        assert!(!result.is_empty());
    }

    #[test]
    fn test_ja_preserves_latin() {
        let result = romanize("hello world", RomanizeLang::Ja);
        assert_eq!(result, "hello world");
    }

    // --- Korean ---

    #[test]
    fn test_ko_hangul() {
        let result = romanize("한글", RomanizeLang::Ko);
        assert!(!result.contains('한'));
        assert!(!result.contains('글'));
    }

    // --- Auto ---

    #[test]
    fn test_auto_preserves_latin() {
        assert_eq!(romanize("hello", RomanizeLang::Auto), "hello");
    }

    #[test]
    fn test_auto_romanizes_cjk() {
        let result = romanize("你好", RomanizeLang::Auto);
        assert!(!result.contains('你'));
    }

    // --- No leading/trailing spaces ---

    #[test]
    fn test_no_leading_space() {
        assert!(!romanize("你好", RomanizeLang::Zh).starts_with(' '));
        assert!(!romanize("ありがとう", RomanizeLang::Ja).starts_with(' '));
        assert!(!romanize("한글", RomanizeLang::Ko).starts_with(' '));
    }
}
