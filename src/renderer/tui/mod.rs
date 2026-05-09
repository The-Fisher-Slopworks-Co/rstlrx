pub mod style;

use anyhow::Result;
use async_trait::async_trait;
use crossterm::event::{Event, KeyCode, KeyModifiers};
use futures::StreamExt;
use ratatui::layout::Alignment;
use ratatui::style::Style;
use ratatui::text::Text;
use ratatui::widgets::Paragraph;
use ratatui::Frame;
use tokio::sync::mpsc;

use crate::config::Config;
use crate::renderer::{Renderer, Update};
use crate::romanize::{self, RomanizeLang, RomanizeMode};
use style::build_style;

pub struct TuiRenderer {
    style_before: Style,
    style_current: Style,
    style_after: Style,
    ignore_errors: bool,
    romanize: RomanizeMode,
    romanize_lang: RomanizeLang,
    padding_before: usize,
    padding_after: usize,
    state: Option<Update>,
}

impl TuiRenderer {
    pub fn new(config: &Config) -> Self {
        Self {
            style_before: build_style(&config.style_before, config.color_before.as_deref()),
            style_current: build_style(&config.style_current, config.color_current.as_deref()),
            style_after: build_style(&config.style_after, config.color_after.as_deref()),
            ignore_errors: config.ignore_errors,
            romanize: config.romanize,
            romanize_lang: config.romanize_lang,
            padding_before: config.padding_before,
            padding_after: config.padding_after,
            state: None,
        }
    }

    fn display_text(&self, text: &str) -> String {
        if self.romanize == RomanizeMode::Inline && romanize::has_romanizable(text) {
            romanize::romanize(text, self.romanize_lang)
        } else {
            text.to_string()
        }
    }

    fn romanization(&self, text: &str, is_current: bool) -> Option<String> {
        let active = self.romanize == RomanizeMode::Duplicate
            || (self.romanize == RomanizeMode::CurrentOnly && is_current);
        if active && romanize::has_romanizable(text) {
            Some(romanize::romanize(text, self.romanize_lang))
        } else {
            None
        }
    }

    fn build_output(&self, update: &Update, height: usize) -> Vec<ratatui::text::Line<'_>> {
        if update.lines.is_empty() {
            return Vec::new();
        }

        let current_text = self.display_text(update.lines[update.index].text());
        let current_rom = self.romanization(update.lines[update.index].text(), true);
        let current_rows = if current_rom.is_some() { 2 } else { 1 };

        let before_count = (height / 2).saturating_sub(self.padding_before);
        let after_count = height
            .saturating_sub(height / 2)
            .saturating_sub(current_rows)
            .saturating_sub(self.padding_after);

        let mut output: Vec<ratatui::text::Line> = Vec::with_capacity(height);

        // --- Lines before current ---
        // Phase 1: determine which lines fit (closest first)
        let mut fitting: Vec<(usize, Option<String>)> = Vec::new();
        let mut used = 0;
        for li in (0..update.index).rev() {
            let text = update.lines[li].text();
            let rom = self.romanization(text, false);
            let rows = if rom.is_some() { 2 } else { 1 };

            if used + rows <= before_count {
                fitting.push((li, rom));
                used += rows;
            } else if used + 1 <= before_count {
                fitting.push((li, None));
                used += 1;
                break;
            } else {
                break;
            }
        }

        // Pad top
        for _ in 0..(before_count - used) {
            output.push(ratatui::text::Line::raw(""));
        }

        // Phase 2: render furthest first
        for (li, rom) in fitting.iter().rev() {
            let text = self.display_text(update.lines[*li].text());
            output.push(ratatui::text::Line::styled(text, self.style_before));
            if let Some(r) = rom {
                output.push(ratatui::text::Line::styled(r.clone(), self.style_before));
            }
        }

        // Padding before current line
        for _ in 0..self.padding_before {
            output.push(ratatui::text::Line::raw(""));
        }

        // --- Current line ---
        output.push(ratatui::text::Line::styled(current_text, self.style_current));
        if let Some(rom) = current_rom {
            output.push(ratatui::text::Line::styled(rom, self.style_current));
        }

        // Padding after current line
        for _ in 0..self.padding_after {
            output.push(ratatui::text::Line::raw(""));
        }

        // --- Lines after current ---
        let mut after_used = 0;
        for li in (update.index + 1)..update.lines.len() {
            if after_used >= after_count {
                break;
            }
            let text = update.lines[li].text();
            let rom = self.romanization(text, false);
            let rows = if rom.is_some() { 2 } else { 1 };

            if after_used + rows <= after_count {
                output.push(ratatui::text::Line::styled(
                    self.display_text(text),
                    self.style_after,
                ));
                if let Some(r) = rom {
                    output.push(ratatui::text::Line::styled(r, self.style_after));
                }
                after_used += rows;
            } else if after_used + 1 <= after_count {
                output.push(ratatui::text::Line::styled(
                    self.display_text(text),
                    self.style_after,
                ));
                after_used += 1;
                break;
            } else {
                break;
            }
        }

        // Pad bottom
        for _ in 0..(after_count - after_used) {
            output.push(ratatui::text::Line::raw(""));
        }

        output
    }

    fn render(&self, frame: &mut Frame) {
        let area = frame.area();
        let height = area.height as usize;

        let update = match &self.state {
            Some(u) => u,
            None => return,
        };

        if let Some(ref err) = update.error {
            if !self.ignore_errors {
                let paragraph = Paragraph::new(err.as_str()).alignment(Alignment::Center);
                frame.render_widget(paragraph, area);
                return;
            }
        }

        let output = self.build_output(update, height);
        if output.is_empty() {
            return;
        }

        let text = Text::from(output);
        let paragraph = Paragraph::new(text).alignment(Alignment::Center);
        frame.render_widget(paragraph, area);
    }
}

#[async_trait]
impl Renderer for TuiRenderer {
    async fn run(&mut self, mut rx: mpsc::Receiver<Update>) -> Result<()> {
        crossterm::terminal::enable_raw_mode()?;
        let mut stdout = std::io::stdout();
        crossterm::execute!(
            stdout,
            crossterm::terminal::EnterAlternateScreen,
            crossterm::cursor::Hide
        )?;
        let backend = ratatui::backend::CrosstermBackend::new(stdout);
        let mut terminal = ratatui::Terminal::new(backend)?;

        let mut events = crossterm::event::EventStream::new();

        let result = loop {
            terminal.draw(|f| self.render(f))?;

            tokio::select! {
                Some(Ok(event)) = events.next() => {
                    if let Event::Key(key) = event {
                        let quit = match key.code {
                            KeyCode::Char('q') | KeyCode::Esc => true,
                            KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => true,
                            _ => false,
                        };
                        if quit {
                            break Ok(());
                        }
                    }
                }
                Some(update) = rx.recv() => {
                    self.state = Some(update);
                }
                else => break Ok(()),
            }
        };

        crossterm::terminal::disable_raw_mode()?;
        crossterm::execute!(
            terminal.backend_mut(),
            crossterm::terminal::LeaveAlternateScreen,
            crossterm::cursor::Show
        )?;

        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lyrics::Line;
    use crate::renderer::{DisplayLine, Update};

    fn make_renderer(padding_before: usize, padding_after: usize) -> TuiRenderer {
        TuiRenderer::new(&Config {
            padding_before,
            padding_after,
            ..Config::default()
        })
    }

    fn make_lines(words: &[&str]) -> Vec<DisplayLine> {
        words
            .iter()
            .enumerate()
            .map(|(i, w)| {
                DisplayLine::Lyric(Line {
                    time_ms: (i as u64) * 1000,
                    words: w.to_string(),
                })
            })
            .collect()
    }

    fn make_update(words: &[&str], index: usize) -> Update {
        Update {
            lines: make_lines(words),
            index,
            error: None,
        }
    }

    fn line_text(line: &ratatui::text::Line) -> String {
        line.iter().map(|s| s.content.as_ref()).collect()
    }

    fn find_current(output: &[ratatui::text::Line], text: &str) -> usize {
        output
            .iter()
            .position(|l| line_text(l) == text)
            .unwrap_or_else(|| panic!("current line '{text}' not found in output"))
    }

    #[test]
    fn test_padding_before_inserts_empty_lines() {
        let renderer = make_renderer(2, 0);
        let update = make_update(&["one", "two", "three", "four", "five"], 2);
        let output = renderer.build_output(&update, 20);

        let current_pos = find_current(&output, "three");

        // The 2 lines immediately before current must be empty (padding)
        assert_eq!(line_text(&output[current_pos - 1]), "");
        assert_eq!(line_text(&output[current_pos - 2]), "");
        // The line before the padding should be a real lyric
        assert_eq!(line_text(&output[current_pos - 3]), "two");
    }

    #[test]
    fn test_padding_after_inserts_empty_lines() {
        let renderer = make_renderer(0, 2);
        let update = make_update(&["one", "two", "three", "four", "five"], 2);
        let output = renderer.build_output(&update, 20);

        let current_pos = find_current(&output, "three");

        // The 2 lines immediately after current must be empty (padding)
        assert_eq!(line_text(&output[current_pos + 1]), "");
        assert_eq!(line_text(&output[current_pos + 2]), "");
        // The line after the padding should be a real lyric
        assert_eq!(line_text(&output[current_pos + 3]), "four");
    }

    #[test]
    fn test_padding_both_directions() {
        let renderer = make_renderer(1, 1);
        let update = make_update(&["one", "two", "three", "four", "five"], 2);
        let output = renderer.build_output(&update, 20);

        let current_pos = find_current(&output, "three");

        assert_eq!(line_text(&output[current_pos - 1]), "");
        assert_eq!(line_text(&output[current_pos + 1]), "");
    }

    #[test]
    fn test_padding_zero_is_no_op() {
        let renderer = make_renderer(0, 0);
        let update = make_update(&["one", "two", "three", "four", "five"], 2);
        let output = renderer.build_output(&update, 20);

        let current_pos = find_current(&output, "three");

        // Without padding, the adjacent lines should be real lyrics
        assert_eq!(line_text(&output[current_pos - 1]), "two");
        assert_eq!(line_text(&output[current_pos + 1]), "four");
    }

    fn make_renderer_with_romanize(mode: RomanizeMode, lang: RomanizeLang) -> TuiRenderer {
        TuiRenderer::new(&Config {
            romanize: mode,
            romanize_lang: lang,
            ..Config::default()
        })
    }

    #[test]
    fn test_current_only_romanizes_current_line() {
        let renderer = make_renderer_with_romanize(RomanizeMode::CurrentOnly, RomanizeLang::Auto);
        // All CJK lines; current is index=1 ("世界")
        let update = make_update(&["你好", "世界", "再见"], 1);
        let output = renderer.build_output(&update, 10);

        let current_pos = find_current(&output, "世界");
        // Romanization line should follow immediately after current
        let rom = line_text(&output[current_pos + 1]);
        assert!(!rom.is_empty(), "romanization line should not be empty");
        assert!(
            !romanize::has_romanizable(&rom),
            "line after current should be romanization (no CJK), got: {rom}"
        );
    }

    #[test]
    fn test_current_only_no_romanization_for_non_current_lines() {
        let renderer = make_renderer_with_romanize(RomanizeMode::CurrentOnly, RomanizeLang::Auto);
        // All lines are CJK, current is index=1 ("世界")
        let update = make_update(&["你好", "世界", "再见"], 1);
        let output = renderer.build_output(&update, 10);

        // Non-empty lines should be: "你好", "世界", <romanization>, "再见" = 4 total
        let non_empty: Vec<String> = output
            .iter()
            .map(|l| line_text(l))
            .filter(|t| !t.is_empty())
            .collect();
        assert_eq!(
            non_empty.len(),
            4,
            "expected 3 lyrics + 1 romanization, got: {non_empty:?}"
        );

        // "你好" should appear as-is (not romanized inline)
        assert!(non_empty.contains(&"你好".to_string()));
        // "再见" should appear as-is (not romanized inline)
        assert!(non_empty.contains(&"再见".to_string()));
    }

    #[test]
    fn test_output_height_preserved_with_padding() {
        let renderer = make_renderer(3, 2);
        let update = make_update(
            &["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"],
            4,
        );
        let output = renderer.build_output(&update, 20);

        assert_eq!(output.len(), 20);
    }
}
