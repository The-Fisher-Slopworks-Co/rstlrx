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

use crate::renderer::{Renderer, Update};
use crate::romanize::{self, RomanizeLang, RomanizeMode};
use style::build_style;

pub struct TuiConfig {
    pub style_before: String,
    pub style_current: String,
    pub style_after: String,
    pub color_before: Option<String>,
    pub color_current: Option<String>,
    pub color_after: Option<String>,
    pub ignore_errors: bool,
    pub romanize: RomanizeMode,
    pub romanize_lang: RomanizeLang,
}

pub struct TuiRenderer {
    style_before: Style,
    style_current: Style,
    style_after: Style,
    ignore_errors: bool,
    romanize: RomanizeMode,
    romanize_lang: RomanizeLang,
    state: Option<Update>,
}

impl TuiRenderer {
    pub fn new(config: TuiConfig) -> Self {
        Self {
            style_before: build_style(&config.style_before, config.color_before.as_deref()),
            style_current: build_style(&config.style_current, config.color_current.as_deref()),
            style_after: build_style(&config.style_after, config.color_after.as_deref()),
            ignore_errors: config.ignore_errors,
            romanize: config.romanize,
            romanize_lang: config.romanize_lang,
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

    fn romanization(&self, text: &str) -> Option<String> {
        if self.romanize == RomanizeMode::Duplicate && romanize::has_romanizable(text) {
            Some(romanize::romanize(text, self.romanize_lang))
        } else {
            None
        }
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

        if update.lines.is_empty() {
            return;
        }

        let current_text = self.display_text(update.lines[update.index].text());
        let current_rom = self.romanization(update.lines[update.index].text());
        let current_rows = if current_rom.is_some() { 2 } else { 1 };

        let before_count = height / 2;
        let after_count = height.saturating_sub(before_count).saturating_sub(current_rows);

        let mut output: Vec<ratatui::text::Line> = Vec::with_capacity(height);

        // --- Lines before current ---
        // Phase 1: determine which lines fit (closest first)
        let mut fitting: Vec<(usize, bool)> = Vec::new();
        let mut used = 0;
        for li in (0..update.index).rev() {
            let text = update.lines[li].text();
            let has_rom = self.romanization(text).is_some();
            let rows = if has_rom { 2 } else { 1 };

            if used + rows <= before_count {
                fitting.push((li, has_rom));
                used += rows;
            } else if used + 1 <= before_count {
                fitting.push((li, false));
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
        for &(li, has_rom) in fitting.iter().rev() {
            let text = self.display_text(update.lines[li].text());
            output.push(ratatui::text::Line::styled(text, self.style_before));
            if has_rom {
                let rom = romanize::romanize(update.lines[li].text(), self.romanize_lang);
                output.push(ratatui::text::Line::styled(rom, self.style_before));
            }
        }

        // --- Current line ---
        output.push(ratatui::text::Line::styled(current_text, self.style_current));
        if let Some(rom) = current_rom {
            output.push(ratatui::text::Line::styled(rom, self.style_current));
        }

        // --- Lines after current ---
        let mut after_used = 0;
        for li in (update.index + 1)..update.lines.len() {
            if after_used >= after_count {
                break;
            }
            let text = update.lines[li].text();
            let rom = self.romanization(text);
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
