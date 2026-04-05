pub mod tui;

use crate::lyrics::Line;
use anyhow::Result;
use async_trait::async_trait;

#[derive(Debug, Clone)]
pub enum DisplayLine {
    Lyric(Line),
    Separator(String),
}

impl DisplayLine {
    pub fn text(&self) -> &str {
        match self {
            DisplayLine::Lyric(line) => &line.words,
            DisplayLine::Separator(text) => text,
        }
    }

}

#[derive(Debug, Clone)]
pub struct Update {
    pub lines: Vec<DisplayLine>,
    pub index: usize,
    pub error: Option<String>,
}

#[async_trait]
pub trait Renderer {
    async fn run(&mut self, rx: tokio::sync::mpsc::Receiver<Update>) -> Result<()>;
}
