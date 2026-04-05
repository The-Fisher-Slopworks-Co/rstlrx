use ratatui::style::{Color, Modifier, Style};

pub fn parse_style(input: &str) -> Style {
    let mut style = Style::default();
    for part in input.split(',') {
        match part.trim().to_lowercase().as_str() {
            "bold" => style = style.add_modifier(Modifier::BOLD),
            "italic" => style = style.add_modifier(Modifier::ITALIC),
            "underline" => style = style.add_modifier(Modifier::UNDERLINED),
            "faint" | "dim" => style = style.add_modifier(Modifier::DIM),
            _ => {}
        }
    }
    style
}

pub fn parse_color(input: &str) -> Option<Color> {
    let input = input.trim();
    if input.is_empty() {
        return None;
    }
    input.parse().ok()
}

pub fn build_style(style_str: &str, color: Option<&str>) -> Style {
    let mut style = parse_style(style_str);
    if let Some(color) = color.and_then(parse_color) {
        style = style.fg(color);
    }
    style
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- parse_style tests ---

    #[test]
    fn test_parse_style_bold() {
        assert_eq!(parse_style("bold"), Style::default().add_modifier(Modifier::BOLD));
    }

    #[test]
    fn test_parse_style_faint() {
        assert_eq!(parse_style("faint"), Style::default().add_modifier(Modifier::DIM));
    }

    #[test]
    fn test_parse_style_combined() {
        assert_eq!(
            parse_style("bold,italic"),
            Style::default().add_modifier(Modifier::BOLD | Modifier::ITALIC)
        );
    }

    #[test]
    fn test_parse_style_all_modifiers() {
        let style = parse_style("bold,italic,underline,faint");
        let expected = Style::default()
            .add_modifier(Modifier::BOLD | Modifier::ITALIC | Modifier::UNDERLINED | Modifier::DIM);
        assert_eq!(style, expected);
    }

    #[test]
    fn test_parse_style_with_spaces() {
        assert_eq!(
            parse_style(" bold , italic "),
            Style::default().add_modifier(Modifier::BOLD | Modifier::ITALIC)
        );
    }

    #[test]
    fn test_parse_style_unknown_ignored() {
        assert_eq!(parse_style("bold,unknown"), Style::default().add_modifier(Modifier::BOLD));
    }

    // --- parse_color tests ---

    #[test]
    fn test_parse_color_hex() {
        assert_eq!(parse_color("#ff5500"), Some(Color::Rgb(255, 85, 0)));
    }

    #[test]
    fn test_parse_color_hex_black() {
        assert_eq!(parse_color("#000000"), Some(Color::Rgb(0, 0, 0)));
    }

    #[test]
    fn test_parse_color_ansi_index() {
        assert_eq!(parse_color("245"), Some(Color::Indexed(245)));
    }

    #[test]
    fn test_parse_color_named_red() {
        assert_eq!(parse_color("red"), Some(Color::Red));
    }

    #[test]
    fn test_parse_color_named_gray() {
        assert_eq!(parse_color("gray"), Some(Color::Gray));
    }

    #[test]
    fn test_parse_color_named_white() {
        assert_eq!(parse_color("white"), Some(Color::White));
    }

    #[test]
    fn test_parse_color_empty() {
        assert_eq!(parse_color(""), None);
    }

    #[test]
    fn test_parse_color_invalid() {
        assert_eq!(parse_color("notacolor"), None);
    }

    // --- build_style tests ---

    #[test]
    fn test_build_style_with_color() {
        let style = build_style("bold", Some("red"));
        assert_eq!(style, Style::default().add_modifier(Modifier::BOLD).fg(Color::Red));
    }

    #[test]
    fn test_build_style_without_color() {
        let style = build_style("faint", None);
        assert_eq!(style, Style::default().add_modifier(Modifier::DIM));
    }
}
