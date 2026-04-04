pub mod lrclib;

use anyhow::Result;
use async_trait::async_trait;

#[derive(Debug, Clone, PartialEq)]
pub struct Line {
    pub time_ms: u64,
    pub words: String,
}

#[async_trait]
pub trait LyricsProvider: Send + Sync {
    async fn fetch(&self, artist: &str, track: &str) -> Result<Vec<Line>>;
}

pub fn ensure_leading_line(lines: &mut Vec<Line>) {
    if let Some(first) = lines.first() {
        if first.time_ms > 1000 {
            lines.insert(0, Line { time_ms: 0, words: String::new() });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ensure_leading_line_inserts_when_late() {
        let mut lines = vec![
            Line { time_ms: 1830, words: "Song".into() },
            Line { time_ms: 3000, words: "More".into() },
        ];
        ensure_leading_line(&mut lines);
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0].time_ms, 0);
        assert_eq!(lines[0].words, "");
        assert_eq!(lines[1].time_ms, 1830);
    }

    #[test]
    fn test_ensure_leading_line_no_insert_when_early() {
        let mut lines = vec![
            Line { time_ms: 540, words: "Song".into() },
        ];
        ensure_leading_line(&mut lines);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].time_ms, 540);
    }

    #[test]
    fn test_ensure_leading_line_no_insert_at_boundary() {
        let mut lines = vec![
            Line { time_ms: 1000, words: "Song".into() },
        ];
        ensure_leading_line(&mut lines);
        assert_eq!(lines.len(), 1);
    }

    #[test]
    fn test_ensure_leading_line_empty_vec() {
        let mut lines: Vec<Line> = vec![];
        ensure_leading_line(&mut lines);
        assert!(lines.is_empty());
    }
}
