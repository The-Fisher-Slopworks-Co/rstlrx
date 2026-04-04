pub mod spotify;

use anyhow::Result;
use async_trait::async_trait;

#[derive(Debug, Clone)]
pub struct State {
    pub track_id: String,
    pub artist: String,
    pub track: String,
    pub position_ms: u64,
    pub is_playing: bool,
}

#[async_trait]
pub trait Player: Send + Sync {
    async fn state(&self) -> Result<Option<State>>;
}
