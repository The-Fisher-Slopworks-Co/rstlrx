import type { Line } from "../lyrics";
import type { Channel } from "../channel";

// Mirrors Rust `DisplayLine` enum (renderer/mod.rs).
//   DisplayLine::Lyric(Line)     -> { kind: "lyric", line }
//   DisplayLine::Separator(String) -> { kind: "separator", text }
export type DisplayLine =
  | { kind: "lyric"; line: Line }
  | { kind: "separator"; text: string };

// Mirrors `DisplayLine::text`: the lyric's words or the separator text.
export function displayLineText(d: DisplayLine): string {
  switch (d.kind) {
    case "lyric":
      return d.line.words;
    case "separator":
      return d.text;
  }
}

// Mirrors Rust `Update` struct. `error` is `Option<String>` -> `string | null`.
export interface Update {
  lines: DisplayLine[];
  index: number;
  error: string | null;
}

// Mirrors the async `Renderer` trait: `run(rx) -> Result<()>` -> `Promise<void>`
// (throws on error). The mpsc receiver maps to our `Channel<Update>`.
export interface Renderer {
  run(rx: Channel<Update>): Promise<void>;
}
