use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

use crate::lyrics::{Line, LyricsProvider};
use crate::player::Player;
use crate::renderer::{DisplayLine, Update};

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
    player: Arc<dyn Player>,
    provider: Box<dyn LyricsProvider>,
    config: SyncConfig,
) -> mpsc::Receiver<Update> {
    let (tx, rx) = mpsc::channel(16);
    tokio::spawn(sync_loop(player, provider, config, tx));
    rx
}

async fn sync_loop(
    player: Arc<dyn Player>,
    provider: Box<dyn LyricsProvider>,
    config: SyncConfig,
    tx: mpsc::Sender<Update>,
) {
    let (player_tx, mut player_rx) = mpsc::channel(1);

    let player_poll = player.clone();
    let poll_interval = config.player_poll_interval;
    tokio::spawn(async move {
        loop {
            let result = player_poll.state().await;
            if player_tx.send(result).await.is_err() {
                break;
            }
            tokio::time::sleep(poll_interval).await;
        }
    });

    let mut current_lyrics: Vec<Line> = Vec::new();
    let mut display_lines: Vec<DisplayLine> = Vec::new();
    let mut next_lyrics: Vec<Line> = Vec::new();
    let mut next_artist = String::new();
    let mut next_track_name = String::new();
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
                                Ok(l) => {
                                    current_lyrics = l;

                                    next_lyrics.clear();
                                    next_artist.clear();
                                    next_track_name.clear();
                                    if let Ok(queue) = player.queue().await {
                                        if let Some(next) = queue.into_iter().next() {
                                            next_artist = next.artist;
                                            next_track_name = next.track;
                                            if let Ok(nl) = provider.fetch(&next_artist, &next_track_name).await {
                                                next_lyrics = nl;
                                            }
                                        }
                                    }

                                    display_lines = build_display_lines(
                                        &current_lyrics,
                                        if next_lyrics.is_empty() {
                                            None
                                        } else {
                                            Some((&next_artist, &next_track_name, &next_lyrics))
                                        },
                                    );
                                }
                                Err(e) => {
                                    current_lyrics.clear();
                                    display_lines.clear();
                                    next_lyrics.clear();
                                    error = Some(e.to_string());
                                }
                            }
                        }
                    }
                    Ok(None) => {
                        is_playing = false;
                        if !current_track_id.is_empty() {
                            current_track_id.clear();
                            current_lyrics.clear();
                            display_lines.clear();
                            next_lyrics.clear();
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

        if !current_lyrics.is_empty() {
            index = get_index(position, index, &current_lyrics);
        }

        if tx
            .send(Update {
                lines: display_lines.clone(),
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

pub fn build_display_lines(
    current_lyrics: &[Line],
    next_track: Option<(&str, &str, &[Line])>,
) -> Vec<DisplayLine> {
    let mut result: Vec<DisplayLine> = current_lyrics.iter().cloned().map(DisplayLine::Lyric).collect();

    if let Some((artist, track, next_lyrics)) = next_track {
        if !next_lyrics.is_empty() {
            result.push(DisplayLine::Separator(format!("── {artist} - {track} ──")));
            result.extend(next_lyrics.iter().cloned().map(DisplayLine::Lyric));
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::renderer::DisplayLine;

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

    #[test]
    fn test_build_display_lines_no_next_track() {
        let lyrics = make_lines(&[1000, 2000, 3000]);
        let result = build_display_lines(&lyrics, None);
        assert_eq!(result.len(), 3);
        assert!(matches!(&result[0], DisplayLine::Lyric(l) if l.time_ms == 1000));
        assert!(matches!(&result[2], DisplayLine::Lyric(l) if l.time_ms == 3000));
    }

    #[test]
    fn test_build_display_lines_with_next_track() {
        let current = make_lines(&[1000, 2000]);
        let next = make_lines(&[0, 1000]);
        let result = build_display_lines(&current, Some(("Artist", "Song", &next)));
        assert_eq!(result.len(), 5);
        assert!(matches!(&result[0], DisplayLine::Lyric(_)));
        assert!(matches!(&result[1], DisplayLine::Lyric(_)));
        assert!(matches!(&result[2], DisplayLine::Separator(s) if s.contains("Artist") && s.contains("Song")));
        assert!(matches!(&result[3], DisplayLine::Lyric(_)));
        assert!(matches!(&result[4], DisplayLine::Lyric(_)));
    }

    #[test]
    fn test_build_display_lines_next_track_empty_lyrics() {
        let current = make_lines(&[1000, 2000]);
        let next: Vec<Line> = vec![];
        let result = build_display_lines(&current, Some(("Artist", "Song", &next)));
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_build_display_lines_separator_format() {
        let current = make_lines(&[1000]);
        let next = make_lines(&[0]);
        let result = build_display_lines(&current, Some(("Lord Huron", "The Night We Met", &next)));
        if let DisplayLine::Separator(s) = &result[1] {
            assert_eq!(s, "── Lord Huron - The Night We Met ──");
        } else {
            panic!("Expected Separator at index 1");
        }
    }
}
