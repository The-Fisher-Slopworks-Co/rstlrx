mod lyrics;
mod player;
mod renderer;
mod sync;

use std::sync::Arc;

use anyhow::Result;
use clap::{Parser, Subcommand};

use lyrics::lrclib::LrclibProvider;
use lyrics::LyricsProvider;
use player::spotify::auth::SpotifyAuth;
use player::spotify::SpotifyPlayer;
use player::Player;
use renderer::tui::{TuiConfig, TuiRenderer};
use renderer::Renderer;
use sync::{start_sync, SyncConfig};

#[derive(Parser)]
#[command(name = "rstlrx", about = "Terminal lyrics viewer synced with Spotify")]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,

    /// Style for lines before current (bold,italic,underline,faint)
    #[arg(long, default_value = "faint")]
    style_before: String,

    /// Style for the current line
    #[arg(long, default_value = "bold")]
    style_current: String,

    /// Style for lines after current
    #[arg(long, default_value = "faint")]
    style_after: String,

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
            let auth = SpotifyAuth::load()?;
            let player: Arc<dyn Player> = Arc::new(SpotifyPlayer::new(auth));
            let provider: Box<dyn LyricsProvider> = Box::new(LrclibProvider::new());

            let rx = start_sync(player, provider, SyncConfig::default());

            let mut renderer = TuiRenderer::new(TuiConfig {
                style_before: cli.style_before,
                style_current: cli.style_current,
                style_after: cli.style_after,
                color_before: cli.color_before,
                color_current: cli.color_current,
                color_after: cli.color_after,
                ignore_errors: cli.ignore_errors,
            });

            renderer.run(rx).await?;
        }
    }

    Ok(())
}
