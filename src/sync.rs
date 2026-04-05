use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

use crate::lyrics::{ensure_leading_line, Line, LyricsProvider};
use crate::player::Player;
use crate::renderer::{DisplayLine, Update};

pub struct SyncConfig {
    pub player_poll_interval: Duration,
    pub ui_timer_interval: Duration,
    pub merge_queue: bool,
}

impl Default for SyncConfig {
    fn default() -> Self {
        Self {
            player_poll_interval: Duration::from_millis(2000),
            ui_timer_interval: Duration::from_millis(200),
            merge_queue: false,
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
    let mut current_track_offset: usize = 0;
    let mut current_duration: u64 = 0;
    let mut next_lyrics: Vec<Line> = Vec::new();
    let mut next_artist = String::new();
    let mut next_track_name = String::new();
    let mut next_track_id = String::new();
    let mut next_track_start: Option<usize> = None;
    let mut current_track_id = String::new();
    let mut index: usize = 0;
    let mut last_state_position: u64 = 0;
    let mut last_state_time = Instant::now();
    let mut is_playing = false;
    let mut error: Option<String> = None;
    let mut queue_rechecked = false;

    let mut sleep_duration = config.ui_timer_interval;

    loop {
        // --- Handle events ---
        tokio::select! {
            Some(result) = player_rx.recv() => {
                match result {
                    Ok(Some(state)) => {
                        is_playing = state.is_playing;

                        current_duration = state.duration_ms;

                        if state.track_id != current_track_id {
                            let smooth = state.track_id == next_track_id
                                && next_track_start.is_some();

                            transition_to_new_track(
                                &state.track_id,
                                &state.artist,
                                &state.track,
                                &*provider,
                                &*player,
                                &mut current_track_id,
                                &mut current_lyrics,
                                &mut display_lines,
                                &mut current_track_offset,
                                &mut index,
                                &mut error,
                                &mut next_lyrics,
                                &mut next_track_id,
                                &mut next_artist,
                                &mut next_track_name,
                                &mut next_track_start,
                                smooth && config.merge_queue,
                                config.merge_queue,
                            )
                            .await;
                            queue_rechecked = false;
                        }

                        // Set timing AFTER transition completes so that
                        // time spent in async fetches doesn't inflate
                        // the interpolated position on the first render.
                        last_state_position = state.position_ms;
                        last_state_time = Instant::now();
                    }
                    Ok(None) => {
                        is_playing = false;
                        if !current_track_id.is_empty() {
                            current_track_id.clear();
                            current_lyrics.clear();
                            display_lines.clear();
                            next_lyrics.clear();
                            next_track_id.clear();
                            next_track_start = None;
                            current_track_offset = 0;
                            current_duration = 0;
                            index = 0;
                            error = None;
                        }
                    }
                    Err(_) => {
                        // Ignore poll errors — keep simulating
                    }
                }
            }
            _ = tokio::time::sleep(sleep_duration) => {}
        }

        // --- Simulate position ---
        let position = if is_playing {
            last_state_position + last_state_time.elapsed().as_millis() as u64
        } else {
            last_state_position
        };

        // --- Recheck queue 10s before track ends ---
        if config.merge_queue
            && is_playing
            && !queue_rechecked
            && current_duration > 10_000
            && position >= current_duration - 10_000
        {
            queue_rechecked = true;
            if let Ok(queue) = player.queue().await {
                let new_next_id = queue.first().map(|q| q.track_id.as_str());
                let old_next_id = if next_track_id.is_empty() { None } else { Some(next_track_id.as_str()) };

                if new_next_id != old_next_id {
                    // Queue changed — remove old next track from display_lines, load new one
                    if let Some(start) = next_track_start {
                        display_lines.truncate(start - 1); // remove separator + old lyrics
                    }
                    next_lyrics.clear();
                    next_track_id.clear();
                    next_track_start = None;

                    if let Some(next) = queue.into_iter().next() {
                        next_track_id = next.track_id;
                        next_artist = next.artist;
                        next_track_name = next.track;
                        if let Ok(nl) = provider.fetch(&next_artist, &next_track_name).await {
                            next_lyrics = nl;
                            ensure_leading_line(&mut next_lyrics);
                            next_track_start = append_next_track(
                                &mut display_lines,
                                &next_artist,
                                &next_track_name,
                                &next_lyrics,
                            );
                        }
                    }
                }
            }
        }

        // --- Auto-transition when position reaches track duration ---
        if config.merge_queue
            && is_playing
            && current_duration > 0
            && position >= current_duration
            && next_track_start.is_some()
        {
            let overflow = position - current_duration;
            current_track_offset = next_track_start.unwrap();
            current_lyrics = std::mem::take(&mut next_lyrics);
            current_track_id.clone_from(&next_track_id);
            current_duration = 0; // unknown until next poll corrects it
            index = current_track_offset;
            error = None;
            queue_rechecked = false;

            // Fetch next-next track
            next_track_id.clear();
            next_track_start = None;
            if let Ok(queue) = player.queue().await {
                if let Some(next) = queue.into_iter().next() {
                    next_track_id = next.track_id;
                    next_artist = next.artist;
                    next_track_name = next.track;
                    if let Ok(nl) = provider.fetch(&next_artist, &next_track_name).await {
                        next_lyrics = nl;
                        ensure_leading_line(&mut next_lyrics);
                        next_track_start = append_next_track(
                            &mut display_lines,
                            &next_artist,
                            &next_track_name,
                            &next_lyrics,
                        );
                    }
                }
            }

            // Set timing AFTER async fetches so elapsed time
            // during network requests doesn't inflate position.
            last_state_position = overflow;
            last_state_time = Instant::now();
        }

        // --- Calculate current line index ---
        if !current_lyrics.is_empty() {
            let local_current = index.saturating_sub(current_track_offset);
            let clamped = local_current.min(current_lyrics.len().saturating_sub(1));
            let local_index = get_index(position, clamped, &current_lyrics);
            index = current_track_offset + local_index;
        }

        // --- Schedule next wake-up precisely at the next line transition ---
        sleep_duration = if is_playing && !current_lyrics.is_empty() {
            let local_idx = index.saturating_sub(current_track_offset);
            if local_idx + 1 < current_lyrics.len() {
                let next_time_ms = current_lyrics[local_idx + 1].time_ms;
                let pos_now = last_state_position + last_state_time.elapsed().as_millis() as u64;
                if next_time_ms > pos_now {
                    Duration::from_millis(next_time_ms - pos_now).min(config.ui_timer_interval)
                } else {
                    Duration::from_millis(10)
                }
            } else {
                config.ui_timer_interval
            }
        } else {
            config.ui_timer_interval
        };

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

#[allow(clippy::too_many_arguments)]
async fn transition_to_new_track(
    track_id: &str,
    artist: &str,
    track: &str,
    provider: &dyn LyricsProvider,
    player: &dyn Player,
    current_track_id: &mut String,
    current_lyrics: &mut Vec<Line>,
    display_lines: &mut Vec<DisplayLine>,
    current_track_offset: &mut usize,
    index: &mut usize,
    error: &mut Option<String>,
    next_lyrics: &mut Vec<Line>,
    next_track_id: &mut String,
    next_artist: &mut String,
    next_track_name: &mut String,
    next_track_start: &mut Option<usize>,
    smooth: bool,
    merge_queue: bool,
) {
    if smooth {
        *current_track_offset = next_track_start.unwrap();
        *current_lyrics = std::mem::take(next_lyrics);
    } else {
        *current_track_offset = 0;
        match provider.fetch(artist, track).await {
            Ok(l) => {
                *current_lyrics = l;
                ensure_leading_line(current_lyrics);
            }
            Err(e) => {
                current_lyrics.clear();
                display_lines.clear();
                next_lyrics.clear();
                next_track_id.clear();
                *next_track_start = None;
                *error = Some(e.to_string());
                current_track_id.clone_from(&track_id.to_string());
                *index = 0;
                return;
            }
        }
        *display_lines = current_lyrics.iter().cloned().map(DisplayLine::Lyric).collect();
    }

    current_track_id.clone_from(&track_id.to_string());
    *index = *current_track_offset;
    *error = None;

    // Fetch next track from queue
    next_lyrics.clear();
    next_track_id.clear();
    *next_track_start = None;
    if merge_queue && let Ok(queue) = player.queue().await {
        if let Some(next) = queue.into_iter().next() {
            *next_track_id = next.track_id;
            *next_artist = next.artist;
            *next_track_name = next.track;
            if let Ok(nl) = provider.fetch(next_artist, next_track_name).await {
                *next_lyrics = nl;
                ensure_leading_line(next_lyrics);
                *next_track_start = append_next_track(
                    display_lines, next_artist, next_track_name, next_lyrics,
                );
            }
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

pub fn append_next_track(
    display_lines: &mut Vec<DisplayLine>,
    artist: &str,
    track: &str,
    lyrics: &[Line],
) -> Option<usize> {
    if lyrics.is_empty() {
        return None;
    }
    display_lines.push(DisplayLine::Separator(format!("── {artist} - {track} ──")));
    let start = display_lines.len();
    display_lines.extend(lyrics.iter().cloned().map(DisplayLine::Lyric));
    Some(start)
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
    fn test_append_next_track_basic() {
        let mut lines: Vec<DisplayLine> = make_lines(&[1000, 2000])
            .into_iter()
            .map(DisplayLine::Lyric)
            .collect();
        let next = make_lines(&[0, 500]);
        let start = append_next_track(&mut lines, "Artist", "Song", &next);
        assert_eq!(start, Some(3)); // 2 lyrics + 1 separator, next starts at 3
        assert_eq!(lines.len(), 5); // 2 + separator + 2
        assert!(matches!(&lines[2], DisplayLine::Separator(s) if s.contains("Artist")));
        assert!(matches!(&lines[3], DisplayLine::Lyric(l) if l.time_ms == 0));
    }

    #[test]
    fn test_append_next_track_empty_lyrics() {
        let mut lines: Vec<DisplayLine> = make_lines(&[1000])
            .into_iter()
            .map(DisplayLine::Lyric)
            .collect();
        let result = append_next_track(&mut lines, "Artist", "Song", &[]);
        assert_eq!(result, None);
        assert_eq!(lines.len(), 1); // unchanged
    }

    #[test]
    fn test_append_next_track_preserves_existing() {
        let mut lines: Vec<DisplayLine> = vec![
            DisplayLine::Lyric(Line { time_ms: 100, words: "old".into() }),
            DisplayLine::Separator("── Old ──".into()),
            DisplayLine::Lyric(Line { time_ms: 200, words: "current".into() }),
        ];
        let next = make_lines(&[0]);
        let start = append_next_track(&mut lines, "New", "Track", &next);
        assert_eq!(start, Some(4)); // 3 existing + 1 separator, next starts at 4
        assert_eq!(lines.len(), 5);
        assert_eq!(lines[0].text(), "old"); // preserved
    }

    #[test]
    fn test_append_next_track_separator_format() {
        let mut lines: Vec<DisplayLine> = make_lines(&[1000])
            .into_iter()
            .map(DisplayLine::Lyric)
            .collect();
        let next = make_lines(&[0]);
        append_next_track(&mut lines, "Lord Huron", "The Night We Met", &next);
        if let DisplayLine::Separator(s) = &lines[1] {
            assert_eq!(s, "── Lord Huron - The Night We Met ──");
        } else {
            panic!("Expected Separator at index 1");
        }
    }
}
