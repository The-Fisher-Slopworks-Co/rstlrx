use anyhow::{bail, Result};
use async_trait::async_trait;
use reqwest::Client;
use serde::Deserialize;

use crate::lyrics::Line;
use crate::lyrics::LyricsProvider;

#[derive(Deserialize)]
struct LrclibResponse {
    #[serde(rename = "syncedLyrics")]
    synced_lyrics: Option<String>,
    #[serde(rename = "plainLyrics")]
    plain_lyrics: Option<String>,
}

pub fn parse_lrc(input: &str) -> Vec<Line> {
    input.lines().filter_map(parse_lrc_line).collect()
}

fn parse_lrc_line(line: &str) -> Option<Line> {
    let line = line.trim();
    if line.len() < 10 || line.as_bytes()[0] != b'[' {
        return None;
    }

    let close = line.find(']')?;
    let timestamp = &line[1..close];
    let words = line[close + 1..].trim().to_string();

    let (min_str, rest) = timestamp.split_once(':')?;
    let (sec_str, ms_str) = rest.split_once('.')?;

    let minutes: u64 = min_str.parse().ok()?;
    let seconds: u64 = sec_str.parse().ok()?;
    let ms_raw: u64 = ms_str.parse().ok()?;

    let ms = match ms_str.len() {
        1 => ms_raw * 100,
        2 => ms_raw * 10,
        3 => ms_raw,
        _ => return None,
    };

    Some(Line {
        time_ms: minutes * 60_000 + seconds * 1_000 + ms,
        words,
    })
}

pub struct LrclibProvider {
    client: Client,
}

impl LrclibProvider {
    pub fn new() -> Self {
        Self {
            client: Client::builder()
                .user_agent("rstlrx v0.1.0 (https://github.com/txssu/rstlrx)")
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .expect("failed to create HTTP client"),
        }
    }
}

#[async_trait]
impl LyricsProvider for LrclibProvider {
    async fn fetch(&self, artist: &str, track: &str) -> Result<Vec<Line>> {
        let resp = self
            .client
            .get("https://lrclib.net/api/get")
            .query(&[("artist_name", artist), ("track_name", track)])
            .send()
            .await?;

        if !resp.status().is_success() {
            bail!("lrclib: {}", resp.status());
        }

        let data: LrclibResponse = resp.json().await?;

        if let Some(synced) = data.synced_lyrics {
            Ok(parse_lrc(&synced))
        } else if let Some(plain) = data.plain_lyrics {
            Ok(plain
                .lines()
                .map(|l| Line { time_ms: 0, words: l.to_string() })
                .collect())
        } else {
            bail!("lrclib: no lyrics found")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_lrc_line_two_digit_ms() {
        assert_eq!(
            parse_lrc_line("[00:17.12] Hello world"),
            Some(Line { time_ms: 17120, words: "Hello world".into() })
        );
    }

    #[test]
    fn test_parse_lrc_line_three_digit_ms() {
        assert_eq!(
            parse_lrc_line("[01:30.500] Test line"),
            Some(Line { time_ms: 90500, words: "Test line".into() })
        );
    }

    #[test]
    fn test_parse_lrc_line_one_digit_ms() {
        assert_eq!(
            parse_lrc_line("[00:05.5] Short"),
            Some(Line { time_ms: 5500, words: "Short".into() })
        );
    }

    #[test]
    fn test_parse_lrc_line_zero_time() {
        assert_eq!(
            parse_lrc_line("[00:00.00] Start"),
            Some(Line { time_ms: 0, words: "Start".into() })
        );
    }

    #[test]
    fn test_parse_lrc_line_empty_words() {
        assert_eq!(
            parse_lrc_line("[00:10.00]"),
            Some(Line { time_ms: 10000, words: "".into() })
        );
    }

    #[test]
    fn test_parse_lrc_line_invalid_inputs() {
        assert_eq!(parse_lrc_line("not a timestamp"), None);
        assert_eq!(parse_lrc_line(""), None);
        assert_eq!(parse_lrc_line("short"), None);
        assert_eq!(parse_lrc_line("[invalid] text"), None);
    }

    #[test]
    fn test_parse_lrc_multiline() {
        let input = "[00:01.00] Line one\n[00:05.00] Line two\n[00:10.00] Line three";
        let result = parse_lrc(input);
        assert_eq!(result.len(), 3);
        assert_eq!(result[0], Line { time_ms: 1000, words: "Line one".into() });
        assert_eq!(result[1], Line { time_ms: 5000, words: "Line two".into() });
        assert_eq!(result[2], Line { time_ms: 10000, words: "Line three".into() });
    }

    #[test]
    fn test_parse_lrc_skips_invalid_lines() {
        let input = "[00:01.00] Valid\nsome garbage\n[00:05.00] Also valid";
        let result = parse_lrc(input);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_deserialize_lrclib_response_synced() {
        let json = r#"{"syncedLyrics": "[00:01.00] Hello\n[00:05.00] World", "plainLyrics": "Hello\nWorld"}"#;
        let resp: LrclibResponse = serde_json::from_str(json).unwrap();
        assert!(resp.synced_lyrics.is_some());
        let lines = parse_lrc(&resp.synced_lyrics.unwrap());
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].words, "Hello");
        assert_eq!(lines[1].words, "World");
    }

    #[test]
    fn test_deserialize_lrclib_response_plain_only() {
        let json = r#"{"syncedLyrics": null, "plainLyrics": "Hello\nWorld"}"#;
        let resp: LrclibResponse = serde_json::from_str(json).unwrap();
        assert!(resp.synced_lyrics.is_none());
        assert_eq!(resp.plain_lyrics.unwrap(), "Hello\nWorld");
    }
}
