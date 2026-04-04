pub mod auth;

use anyhow::{bail, Result};
use async_trait::async_trait;
use reqwest::Client;
use serde::Deserialize;
use tokio::sync::Mutex;

use crate::player::{Player, State};
use auth::SpotifyAuth;

#[derive(Deserialize)]
struct SpotifyResponse {
    is_playing: bool,
    progress_ms: Option<u64>,
    item: Option<SpotifyItem>,
}

#[derive(Deserialize)]
struct SpotifyItem {
    id: String,
    name: String,
    artists: Vec<SpotifyArtist>,
}

#[derive(Deserialize)]
struct SpotifyArtist {
    name: String,
}

fn parse_response(data: SpotifyResponse) -> Option<State> {
    let item = data.item?;
    let artist = item
        .artists
        .iter()
        .map(|a| a.name.as_str())
        .collect::<Vec<_>>()
        .join(" ");

    Some(State {
        track_id: item.id,
        artist,
        track: item.name,
        position_ms: data.progress_ms.unwrap_or(0),
        is_playing: data.is_playing,
    })
}

pub struct SpotifyPlayer {
    auth: Mutex<SpotifyAuth>,
    client: Client,
}

impl SpotifyPlayer {
    pub fn new(auth: SpotifyAuth) -> Self {
        Self {
            auth: Mutex::new(auth),
            client: Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .expect("failed to create HTTP client"),
        }
    }
}

#[async_trait]
impl Player for SpotifyPlayer {
    async fn state(&self) -> Result<Option<State>> {
        let token = {
            let mut auth = self.auth.lock().await;
            auth.get_token().await?.to_string()
        };

        let resp = self
            .client
            .get("https://api.spotify.com/v1/me/player/currently-playing")
            .bearer_auth(&token)
            .send()
            .await?;

        if resp.status() == reqwest::StatusCode::NO_CONTENT {
            return Ok(None);
        }

        if !resp.status().is_success() {
            bail!("spotify: {}", resp.status());
        }

        let data: SpotifyResponse = resp.json().await?;
        Ok(parse_response(data))
    }

    async fn queue(&self) -> Result<Vec<crate::player::QueueItem>> {
        let token = {
            let mut auth = self.auth.lock().await;
            auth.get_token().await?.to_string()
        };

        let resp = self
            .client
            .get("https://api.spotify.com/v1/me/player/queue")
            .bearer_auth(&token)
            .send()
            .await?;

        if resp.status() == reqwest::StatusCode::NO_CONTENT {
            return Ok(vec![]);
        }

        if !resp.status().is_success() {
            bail!("spotify queue: {}", resp.status());
        }

        let data: SpotifyQueueResponse = resp.json().await?;
        Ok(parse_queue_response(data))
    }
}

#[derive(Deserialize)]
struct SpotifyQueueResponse {
    queue: Vec<SpotifyItem>,
}

fn parse_queue_response(data: SpotifyQueueResponse) -> Vec<crate::player::QueueItem> {
    data.queue
        .into_iter()
        .take(1)
        .map(|item| {
            let artist = item
                .artists
                .iter()
                .map(|a| a.name.as_str())
                .collect::<Vec<_>>()
                .join(" ");
            crate::player::QueueItem {
                track_id: item.id,
                artist,
                track: item.name,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_spotify_response() {
        let json = r#"{
            "is_playing": true,
            "progress_ms": 42000,
            "item": {
                "id": "abc123",
                "name": "The Night We Met",
                "artists": [{"name": "Lord Huron"}]
            }
        }"#;
        let resp: SpotifyResponse = serde_json::from_str(json).unwrap();
        let state = parse_response(resp).unwrap();
        assert_eq!(state.track_id, "abc123");
        assert_eq!(state.artist, "Lord Huron");
        assert_eq!(state.track, "The Night We Met");
        assert_eq!(state.position_ms, 42000);
        assert!(state.is_playing);
    }

    #[test]
    fn test_parse_spotify_response_multiple_artists() {
        let json = r#"{
            "is_playing": true,
            "progress_ms": 0,
            "item": {
                "id": "xyz",
                "name": "Song",
                "artists": [{"name": "Artist A"}, {"name": "Artist B"}]
            }
        }"#;
        let resp: SpotifyResponse = serde_json::from_str(json).unwrap();
        let state = parse_response(resp).unwrap();
        assert_eq!(state.artist, "Artist A Artist B");
    }

    #[test]
    fn test_parse_spotify_response_no_item() {
        let json = r#"{"is_playing": false, "progress_ms": null, "item": null}"#;
        let resp: SpotifyResponse = serde_json::from_str(json).unwrap();
        assert!(parse_response(resp).is_none());
    }

    #[test]
    fn test_parse_queue_response_with_items() {
        let json = r#"{
            "currently_playing": null,
            "queue": [
                {
                    "id": "next1",
                    "name": "Next Song",
                    "artists": [{"name": "Next Artist"}]
                },
                {
                    "id": "next2",
                    "name": "After That",
                    "artists": [{"name": "Other Artist"}]
                }
            ]
        }"#;
        let resp: SpotifyQueueResponse = serde_json::from_str(json).unwrap();
        let items = parse_queue_response(resp);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].track_id, "next1");
        assert_eq!(items[0].artist, "Next Artist");
        assert_eq!(items[0].track, "Next Song");
    }

    #[test]
    fn test_parse_queue_response_empty() {
        let json = r#"{"currently_playing": null, "queue": []}"#;
        let resp: SpotifyQueueResponse = serde_json::from_str(json).unwrap();
        let items = parse_queue_response(resp);
        assert!(items.is_empty());
    }

    #[test]
    fn test_parse_queue_response_multiple_artists() {
        let json = r#"{
            "currently_playing": null,
            "queue": [{
                "id": "q1",
                "name": "Collab",
                "artists": [{"name": "A"}, {"name": "B"}]
            }]
        }"#;
        let resp: SpotifyQueueResponse = serde_json::from_str(json).unwrap();
        let items = parse_queue_response(resp);
        assert_eq!(items[0].artist, "A B");
    }
}
