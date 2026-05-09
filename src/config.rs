use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::romanize::{RomanizeLang, RomanizeMode};

#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    pub style_before: String,
    pub style_current: String,
    pub style_after: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_before: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_current: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_after: Option<String>,
    pub ignore_errors: bool,
    pub merge_queue: bool,
    pub romanize: RomanizeMode,
    pub romanize_lang: RomanizeLang,
    pub padding_before: usize,
    pub padding_after: usize,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            style_before: "faint".into(),
            style_current: "bold".into(),
            style_after: "faint".into(),
            color_before: None,
            color_current: None,
            color_after: None,
            ignore_errors: false,
            merge_queue: false,
            romanize: RomanizeMode::Off,
            romanize_lang: RomanizeLang::Auto,
            padding_before: 0,
            padding_after: 0,
        }
    }
}

impl Config {
    pub fn storage_path() -> Result<PathBuf> {
        let dir = dirs::config_dir()
            .context("cannot determine config directory")?
            .join("rstlrx");
        Ok(dir.join("config.toml"))
    }

    pub fn load() -> Result<Self> {
        let path = Self::storage_path()?;
        match std::fs::read_to_string(&path) {
            Ok(data) => toml::from_str(&data)
                .with_context(|| format!("cannot parse {}", path.display())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(e).with_context(|| format!("cannot read {}", path.display())),
        }
    }

    pub fn save(&self) -> Result<PathBuf> {
        let path = Self::storage_path()?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let data = toml::to_string_pretty(self)?;
        std::fs::write(&path, data)?;
        Ok(path)
    }
}
