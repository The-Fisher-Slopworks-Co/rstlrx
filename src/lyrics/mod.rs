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
