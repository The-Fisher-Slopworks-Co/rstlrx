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

struct SyncState {
    current_track_id: String,
    current_lyrics: Vec<Line>,
    display_lines: Vec<DisplayLine>,
    current_track_offset: usize,
    current_duration: u64,
    next_lyrics: Vec<Line>,
    next_artist: String,
    next_track_name: String,
    next_track_id: String,
    next_track_start: Option<usize>,
    index: usize,
    last_state_position: u64,
    last_state_time: Instant,
    is_playing: bool,
    error: Option<String>,
    queue_rechecked: bool,
}

impl Default for SyncState {
    fn default() -> Self {
        Self {
            current_track_id: String::new(),
            current_lyrics: Vec::new(),
            display_lines: Vec::new(),
            current_track_offset: 0,
            current_duration: 0,
            next_lyrics: Vec::new(),
            next_artist: String::new(),
            next_track_name: String::new(),
            next_track_id: String::new(),
            next_track_start: None,
            index: 0,
            last_state_position: 0,
            last_state_time: Instant::now(),
            is_playing: false,
            error: None,
            queue_rechecked: false,
        }
    }
}

impl SyncState {
    fn interpolated_position(&self) -> u64 {
        if self.is_playing {
            self.last_state_position + self.last_state_time.elapsed().as_millis() as u64
        } else {
            self.last_state_position
        }
    }

    fn lyrics_to_display(lyrics: &[Line]) -> Vec<DisplayLine> {
        lyrics.iter().cloned().map(DisplayLine::Lyric).collect()
    }

    fn clear(&mut self) {
        self.current_track_id.clear();
        self.current_lyrics.clear();
        self.display_lines.clear();
        self.next_lyrics.clear();
        self.next_track_id.clear();
        self.next_track_start = None;
        self.current_track_offset = 0;
        self.current_duration = 0;
        self.index = 0;
        self.error = None;
    }

    fn to_update(&self) -> Update {
        Update {
            lines: self.display_lines.clone(),
            index: self.index,
            error: self.error.clone(),
        }
    }

    async fn fetch_next_track(
        &mut self,
        player: &dyn Player,
        provider: &dyn LyricsProvider,
        merge_queue: bool,
    ) {
        self.next_lyrics.clear();
        self.next_track_id.clear();
        self.next_track_start = None;
        if let Ok(queue) = player.queue().await {
            if let Some(next) = queue.into_iter().next() {
                self.next_track_id = next.track_id;
                self.next_artist = next.artist;
                self.next_track_name = next.track;
                if let Ok(nl) = provider.fetch(&self.next_artist, &self.next_track_name).await {
                    self.next_lyrics = nl;
                    ensure_leading_line(&mut self.next_lyrics);
                    if merge_queue {
                        self.next_track_start = append_next_track(
                            &mut self.display_lines,
                            &self.next_artist,
                            &self.next_track_name,
                            &self.next_lyrics,
                        );
                    }
                }
            }
        }
    }

    async fn transition_to_new_track(
        &mut self,
        track_id: &str,
        artist: &str,
        track: &str,
        provider: &dyn LyricsProvider,
        player: &dyn Player,
        smooth: bool,
        merge_queue: bool,
    ) {
        if smooth {
            self.current_track_offset = self.next_track_start.unwrap();
            self.current_lyrics = std::mem::take(&mut self.next_lyrics);
        } else if track_id == self.next_track_id && !self.next_lyrics.is_empty() {
            self.current_track_offset = 0;
            self.current_lyrics = std::mem::take(&mut self.next_lyrics);
            self.display_lines = Self::lyrics_to_display(&self.current_lyrics);
        } else {
            self.current_track_offset = 0;
            match provider.fetch(artist, track).await {
                Ok(l) => {
                    self.current_lyrics = l;
                    ensure_leading_line(&mut self.current_lyrics);
                }
                Err(e) => {
                    self.current_lyrics.clear();
                    self.display_lines.clear();
                    self.next_lyrics.clear();
                    self.next_track_id.clear();
                    self.next_track_start = None;
                    self.error = Some(e.to_string());
                    self.current_track_id = track_id.to_string();
                    self.index = 0;
                    return;
                }
            }
            self.display_lines = Self::lyrics_to_display(&self.current_lyrics);
        }

        self.current_track_id = track_id.to_string();
        self.index = self.current_track_offset;
        self.error = None;

        self.fetch_next_track(player, provider, merge_queue).await;
    }
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

    let mut state = SyncState::default();
    let mut sleep_duration = config.ui_timer_interval;

    loop {
        tokio::select! {
            Some(result) = player_rx.recv() => {
                match result {
                    Ok(Some(player_state)) => {
                        state.is_playing = player_state.is_playing;
                        state.current_duration = player_state.duration_ms;

                        if player_state.track_id != state.current_track_id {
                            let smooth = player_state.track_id == state.next_track_id
                                && state.next_track_start.is_some();

                            state.transition_to_new_track(
                                &player_state.track_id,
                                &player_state.artist,
                                &player_state.track,
                                &*provider,
                                &*player,
                                smooth && config.merge_queue,
                                config.merge_queue,
                            ).await;
                            state.queue_rechecked = false;
                        }

                        state.last_state_position = player_state.position_ms;
                        state.last_state_time = Instant::now();
                    }
                    Ok(None) => {
                        state.is_playing = false;
                        if !state.current_track_id.is_empty() {
                            state.clear();
                        }
                    }
                    Err(_) => {}
                }
            }
            _ = tokio::time::sleep(sleep_duration) => {}
        }

        let position = state.interpolated_position();

        // Recheck queue 10s before track ends
        if config.merge_queue
            && state.is_playing
            && !state.queue_rechecked
            && state.current_duration > 10_000
            && position >= state.current_duration - 10_000
        {
            state.queue_rechecked = true;
            if let Ok(queue) = player.queue().await {
                let new_next_id = queue.first().map(|q| q.track_id.as_str());
                let old_next_id = if state.next_track_id.is_empty() {
                    None
                } else {
                    Some(state.next_track_id.as_str())
                };

                if new_next_id != old_next_id {
                    if let Some(start) = state.next_track_start {
                        state.display_lines.truncate(start.saturating_sub(1));
                    }
                    state.next_lyrics.clear();
                    state.next_track_id.clear();
                    state.next_track_start = None;

                    if let Some(next) = queue.into_iter().next() {
                        state.next_track_id = next.track_id;
                        state.next_artist = next.artist;
                        state.next_track_name = next.track;
                        if let Ok(nl) = provider
                            .fetch(&state.next_artist, &state.next_track_name)
                            .await
                        {
                            state.next_lyrics = nl;
                            ensure_leading_line(&mut state.next_lyrics);
                            state.next_track_start = append_next_track(
                                &mut state.display_lines,
                                &state.next_artist,
                                &state.next_track_name,
                                &state.next_lyrics,
                            );
                        }
                    }
                }
            }
        }

        // Auto-transition when position reaches track duration
        if state.is_playing
            && state.current_duration > 0
            && position >= state.current_duration
            && !state.next_track_id.is_empty()
        {
            let overflow = position - state.current_duration;

            if config.merge_queue && state.next_track_start.is_some() {
                state.current_track_offset = state.next_track_start.unwrap();
            } else {
                state.current_track_offset = 0;
                state.display_lines = SyncState::lyrics_to_display(&state.next_lyrics);
            }

            state.current_lyrics = std::mem::take(&mut state.next_lyrics);
            state.current_track_id.clone_from(&state.next_track_id);
            state.current_duration = 0;
            state.index = state.current_track_offset;
            state.error = None;
            state.queue_rechecked = false;

            state
                .fetch_next_track(&*player, &*provider, config.merge_queue)
                .await;

            state.last_state_position = overflow;
            state.last_state_time = Instant::now();
        }

        // Calculate current line index
        if !state.current_lyrics.is_empty() {
            let local_current = state.index.saturating_sub(state.current_track_offset);
            let clamped = local_current.min(state.current_lyrics.len().saturating_sub(1));
            let local_index = get_index(position, clamped, &state.current_lyrics);
            state.index = state.current_track_offset + local_index;
        }

        // Schedule next wake-up precisely at the next line transition
        sleep_duration = if state.is_playing && !state.current_lyrics.is_empty() {
            let local_idx = state.index.saturating_sub(state.current_track_offset);
            if local_idx + 1 < state.current_lyrics.len() {
                let next_time_ms = state.current_lyrics[local_idx + 1].time_ms;
                let pos_now = state.interpolated_position();
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

        if tx.send(state.to_update()).await.is_err() {
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
            .map(|&t| Line {
                time_ms: t,
                words: format!("line@{t}"),
            })
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
        assert_eq!(start, Some(3));
        assert_eq!(lines.len(), 5);
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
        assert_eq!(lines.len(), 1);
    }

    #[test]
    fn test_append_next_track_preserves_existing() {
        let mut lines: Vec<DisplayLine> = vec![
            DisplayLine::Lyric(Line {
                time_ms: 100,
                words: "old".into(),
            }),
            DisplayLine::Separator("── Old ──".into()),
            DisplayLine::Lyric(Line {
                time_ms: 200,
                words: "current".into(),
            }),
        ];
        let next = make_lines(&[0]);
        let start = append_next_track(&mut lines, "New", "Track", &next);
        assert_eq!(start, Some(4));
        assert_eq!(lines.len(), 5);
        assert_eq!(lines[0].text(), "old");
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
