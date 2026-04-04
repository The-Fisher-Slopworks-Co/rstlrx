use crate::lyrics::Line;

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
