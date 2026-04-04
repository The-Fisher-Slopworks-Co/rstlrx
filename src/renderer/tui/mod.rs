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
use style::build_style;

pub struct TuiConfig {
    pub style_before: String,
    pub style_current: String,
    pub style_after: String,
    pub color_before: Option<String>,
    pub color_current: Option<String>,
    pub color_after: Option<String>,
    pub ignore_errors: bool,
}

pub struct TuiRenderer {
    style_before: Style,
    style_current: Style,
    style_after: Style,
    ignore_errors: bool,
    state: Option<Update>,
}

impl TuiRenderer {
    pub fn new(config: TuiConfig) -> Self {
        Self {
            style_before: build_style(&config.style_before, config.color_before.as_deref()),
            style_current: build_style(&config.style_current, config.color_current.as_deref()),
            style_after: build_style(&config.style_after, config.color_after.as_deref()),
            ignore_errors: config.ignore_errors,
            state: None,
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

        let before_count = height / 2;
        let after_count = height.saturating_sub(before_count).saturating_sub(1);

        let mut output: Vec<ratatui::text::Line> = Vec::with_capacity(height);

        // Lines before current
        for i in (0..before_count).rev() {
            let idx = update.index as isize - i as isize - 1;
            if idx >= 0 && (idx as usize) < update.lines.len() {
                output.push(ratatui::text::Line::styled(
                    update.lines[idx as usize].text().to_string(),
                    self.style_before,
                ));
            } else {
                output.push(ratatui::text::Line::raw(""));
            }
        }

        // Current line with markers (only for Lyric, not Separator)
        let current = &update.lines[update.index];
        if current.is_separator() {
            output.push(ratatui::text::Line::styled(
                current.text().to_string(),
                self.style_current,
            ));
        } else {
            let current_text = format!("> {} <", current.text());
            output.push(ratatui::text::Line::styled(current_text, self.style_current));
        }

        // Lines after current
        for i in 1..=after_count {
            let idx = update.index + i;
            if idx < update.lines.len() {
                output.push(ratatui::text::Line::styled(
                    update.lines[idx].text().to_string(),
                    self.style_after,
                ));
            } else {
                output.push(ratatui::text::Line::raw(""));
            }
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
