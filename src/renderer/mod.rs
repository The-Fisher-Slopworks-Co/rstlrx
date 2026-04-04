pub mod tui;

use crate::lyrics::Line;
use anyhow::Result;
use async_trait::async_trait;

#[derive(Debug, Clone)]
pub struct Update {
    pub lines: Vec<Line>,
    pub index: usize,
    pub is_playing: bool,
    pub error: Option<String>,
}

#[async_trait]
pub trait Renderer {
    async fn run(&mut self, rx: tokio::sync::mpsc::Receiver<Update>) -> Result<()>;
}
