use std::time::{Duration, Instant};
use tokio::sync::mpsc;

use crate::lyrics::{Line, LyricsProvider};
use crate::player::Player;
use crate::renderer::Update;

pub struct SyncConfig {
    pub player_poll_interval: Duration,
    pub ui_timer_interval: Duration,
}

impl Default for SyncConfig {
    fn default() -> Self {
        Self {
            player_poll_interval: Duration::from_millis(2000),
            ui_timer_interval: Duration::from_millis(200),
        }
    }
}

pub fn start_sync(
    player: Box<dyn Player>,
    provider: Box<dyn LyricsProvider>,
    config: SyncConfig,
) -> mpsc::Receiver<Update> {
    let (tx, rx) = mpsc::channel(16);
    tokio::spawn(sync_loop(player, provider, config, tx));
    rx
}

async fn sync_loop(
    player: Box<dyn Player>,
    provider: Box<dyn LyricsProvider>,
    config: SyncConfig,
    tx: mpsc::Sender<Update>,
) {
    let (player_tx, mut player_rx) = mpsc::channel(1);

    let poll_interval = config.player_poll_interval;
    tokio::spawn(async move {
        loop {
            let result = player.state().await;
            if player_tx.send(result).await.is_err() {
                break;
            }
            tokio::time::sleep(poll_interval).await;
        }
    });

    let mut lines: Vec<Line> = Vec::new();
    let mut current_track_id = String::new();
    let mut index: usize = 0;
    let mut last_state_position: u64 = 0;
    let mut last_state_time = Instant::now();
    let mut is_playing = false;
    let mut error: Option<String> = None;

    let mut timer = tokio::time::interval(config.ui_timer_interval);

    loop {
        tokio::select! {
            Some(result) = player_rx.recv() => {
                match result {
                    Ok(Some(state)) => {
                        last_state_position = state.position_ms;
                        last_state_time = Instant::now();
                        is_playing = state.is_playing;

                        if state.track_id != current_track_id {
                            current_track_id.clone_from(&state.track_id);
                            index = 0;
                            error = None;

                            match provider.fetch(&state.artist, &state.track).await {
                                Ok(l) => lines = l,
                                Err(e) => {
                                    lines.clear();
                                    error = Some(e.to_string());
                                }
                            }
                        }
                    }
                    Ok(None) => {
                        is_playing = false;
                        if !current_track_id.is_empty() {
                            current_track_id.clear();
                            lines.clear();
                            index = 0;
                            error = None;
                        }
                    }
                    Err(e) => {
                        error = Some(e.to_string());
                    }
                }
            }
            _ = timer.tick() => {}
        }

        let position = if is_playing {
            last_state_position + last_state_time.elapsed().as_millis() as u64
        } else {
            last_state_position
        };

        if !lines.is_empty() {
            index = get_index(position, index, &lines);
        }

        if tx
            .send(Update {
                lines: lines.clone(),
                index,
                is_playing,
                error: error.clone(),
            })
            .await
            .is_err()
        {
            break;
        }
    }
}

pub fn get_index(position_ms: u64, current_index: usize, lines: &[Line]) -> usize {
    if lines.len() <= 1 {
        return 0;
    }

    if position_ms >= lines[current_index].time_ms {
        for i in (current_index + 1)..lines.len() {
            if position_ms < lines[i].time_ms {
                return i - 1;
            }
        }
        return lines.len() - 1;
    }

    for i in (1..=current_index).rev() {
        if position_ms >= lines[i].time_ms {
            return i;
        }
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_lines(times: &[u64]) -> Vec<Line> {
        times
            .iter()
            .map(|&t| Line { time_ms: t, words: format!("line@{t}") })
            .collect()
    }

    #[test]
    fn test_single_line() {
        let lines = make_lines(&[0]);
        assert_eq!(get_index(5000, 0, &lines), 0);
    }

    #[test]
    fn test_empty() {
        let lines = make_lines(&[]);
        assert_eq!(get_index(0, 0, &lines), 0);
    }

    #[test]
    fn test_before_first_line() {
        let lines = make_lines(&[1000, 2000, 3000]);
        assert_eq!(get_index(500, 0, &lines), 0);
    }

    #[test]
    fn test_exact_match_second_line() {
        let lines = make_lines(&[1000, 2000, 3000]);
        assert_eq!(get_index(2000, 0, &lines), 1);
    }

    #[test]
    fn test_between_lines() {
        let lines = make_lines(&[1000, 2000, 3000]);
        assert_eq!(get_index(2500, 0, &lines), 1);
    }

    #[test]
    fn test_after_last_line() {
        let lines = make_lines(&[1000, 2000, 3000]);
        assert_eq!(get_index(5000, 0, &lines), 2);
    }

    #[test]
    fn test_backward_search() {
        let lines = make_lines(&[1000, 2000, 3000]);
        // current_index=2 but position matches line 0
        assert_eq!(get_index(1500, 2, &lines), 0);
    }

    #[test]
    fn test_from_any_start_index() {
        let lines = make_lines(&[0, 1000, 2000, 3000, 4000]);
        for target in 0..lines.len() {
            let mid = if target + 1 < lines.len() {
                (lines[target].time_ms + lines[target + 1].time_ms) / 2
            } else {
                lines[target].time_ms + 500
            };
            for start in 0..lines.len() {
                assert_eq!(
                    get_index(mid, start, &lines),
                    target,
                    "get_index({mid}, {start}, ...) should be {target}"
                );
            }
        }
    }
}
