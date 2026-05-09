mod config;
mod lyrics;
mod player;
mod renderer;
mod romanize;
mod sync;

use std::sync::Arc;

use anyhow::Result;
use clap::{Parser, Subcommand};

use config::Config;
use lyrics::lrclib::LrclibProvider;
use lyrics::LyricsProvider;
use player::spotify::auth::SpotifyAuth;
use player::spotify::SpotifyPlayer;
use player::Player;
use renderer::tui::TuiRenderer;
use renderer::Renderer;
use sync::{start_sync, SyncConfig};

#[derive(Parser)]
#[command(name = "rstlrx", about = "Terminal lyrics viewer synced with Spotify")]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,

    /// Style for lines before current (bold,italic,underline,faint; default: faint)
    #[arg(long)]
    style_before: Option<String>,

    /// Style for the current line (default: bold)
    #[arg(long)]
    style_current: Option<String>,

    /// Style for lines after current (default: faint)
    #[arg(long)]
    style_after: Option<String>,

    /// Color for lines before current (named, #hex, or ANSI 0-255)
    #[arg(long)]
    color_before: Option<String>,

    /// Color for the current line
    #[arg(long)]
    color_current: Option<String>,

    /// Color for lines after current
    #[arg(long)]
    color_after: Option<String>,

    /// Suppress error display in the UI
    #[arg(long)]
    ignore_errors: bool,

    /// Show lyrics for upcoming tracks as a continuous scroll
    #[arg(long)]
    merge_queue: bool,

    /// Romanize CJK characters: "inline" replaces in place, "duplicate" adds a romanized line below, "current-only" adds romanization for the current line only
    #[arg(long, value_enum)]
    romanize: Option<romanize::RomanizeMode>,

    /// Language for romanization: zh (pinyin), ja (romaji), ko (Korean), auto
    #[arg(long, value_enum)]
    romanize_lang: Option<romanize::RomanizeLang>,

    /// Number of empty lines before the current line
    #[arg(long)]
    padding_before: Option<usize>,

    /// Number of empty lines after the current line
    #[arg(long)]
    padding_after: Option<usize>,

    /// Save the resulting flag values to the config file as the new defaults
    #[arg(long)]
    save_config: bool,
}

#[derive(Subcommand)]
enum Commands {
    /// Authenticate with Spotify
    Login {
        #[arg(long)]
        client_id: String,
        #[arg(long)]
        client_secret: String,
        #[arg(long, default_value = "8888")]
        port: u16,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Some(Commands::Login {
            client_id,
            client_secret,
            port,
        }) => {
            SpotifyAuth::login_flow(&client_id, &client_secret, port).await?;
        }
        None => {
            let stored = Config::load()?;
            let effective = Config {
                style_before: cli.style_before.unwrap_or(stored.style_before),
                style_current: cli.style_current.unwrap_or(stored.style_current),
                style_after: cli.style_after.unwrap_or(stored.style_after),
                color_before: cli.color_before.or(stored.color_before),
                color_current: cli.color_current.or(stored.color_current),
                color_after: cli.color_after.or(stored.color_after),
                ignore_errors: cli.ignore_errors || stored.ignore_errors,
                merge_queue: cli.merge_queue || stored.merge_queue,
                romanize: cli.romanize.unwrap_or(stored.romanize),
                romanize_lang: cli.romanize_lang.unwrap_or(stored.romanize_lang),
                padding_before: cli.padding_before.unwrap_or(stored.padding_before),
                padding_after: cli.padding_after.unwrap_or(stored.padding_after),
            };

            if cli.save_config {
                let path = effective.save()?;
                println!("Saved config to {}", path.display());
            }

            let auth = SpotifyAuth::load()?;
            let player: Arc<dyn Player> = Arc::new(SpotifyPlayer::new(auth));
            let provider: Box<dyn LyricsProvider> = Box::new(LrclibProvider::new());

            let rx = start_sync(
                player,
                provider,
                SyncConfig {
                    merge_queue: effective.merge_queue,
                    ..SyncConfig::default()
                },
            );

            let mut renderer = TuiRenderer::new(&effective);
            renderer.run(rx).await?;
        }
    }

    Ok(())
}
