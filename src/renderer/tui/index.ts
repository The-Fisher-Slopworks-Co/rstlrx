import type { Config } from "../../config";
import { Channel } from "../../channel";
import type { Renderer, Update } from "../index";
import { displayLineText } from "../index";
import { hasRomanizable, romanize } from "../../romanize";
import type { RomanizeLang, RomanizeMode } from "../../romanize";
import type { Style } from "./style";
import { buildStyle, styleToAnsi, RESET } from "./style";

export interface RenderedLine {
  text: string;
  style: Style | null;
}

const PAD_LINE: RenderedLine = { text: "", style: null };

export class TuiRenderer implements Renderer {
  private readonly styleBefore: Style;
  private readonly styleCurrent: Style;
  private readonly styleAfter: Style;
  private readonly ignoreErrors: boolean;
  private readonly romanize: RomanizeMode;
  private readonly romanizeLang: RomanizeLang;
  private readonly paddingBefore: number;
  private readonly paddingAfter: number;
  private state: Update | null = null;

  constructor(config: Config) {
    this.styleBefore = buildStyle(config.style_before, config.color_before);
    this.styleCurrent = buildStyle(config.style_current, config.color_current);
    this.styleAfter = buildStyle(config.style_after, config.color_after);
    this.ignoreErrors = config.ignore_errors;
    this.romanize = config.romanize;
    this.romanizeLang = config.romanize_lang;
    this.paddingBefore = config.padding_before;
    this.paddingAfter = config.padding_after;
  }

  private displayText(text: string): string {
    if (this.romanize === "inline" && hasRomanizable(text)) {
      return romanize(text, this.romanizeLang);
    }
    return text;
  }

  private romanization(text: string, isCurrent: boolean): string | null {
    const active =
      this.romanize === "duplicate" ||
      (this.romanize === "current-only" && isCurrent);
    if (active && hasRomanizable(text)) {
      return romanize(text, this.romanizeLang);
    }
    return null;
  }

  buildOutput(update: Update, height: number): RenderedLine[] {
    if (update.lines.length === 0) {
      return [];
    }

    const currentSource = displayLineText(update.lines[update.index]);
    const currentText = this.displayText(currentSource);
    const currentRom = this.romanization(currentSource, true);
    const currentRows = currentRom !== null ? 2 : 1;

    const halfHeight = Math.floor(height / 2);
    const beforeCount = saturatingSub(halfHeight, this.paddingBefore);
    const afterCount = saturatingSub(
      saturatingSub(saturatingSub(height, halfHeight), currentRows),
      this.paddingAfter,
    );

    const output: RenderedLine[] = [];

    // --- Lines before current ---
    // Phase 1: determine which lines fit (closest first)
    const fitting: Array<[number, string | null]> = [];
    let used = 0;
    for (let li = update.index - 1; li >= 0; li--) {
      const text = displayLineText(update.lines[li]);
      const rom = this.romanization(text, false);
      const rows = rom !== null ? 2 : 1;

      if (used + rows <= beforeCount) {
        fitting.push([li, rom]);
        used += rows;
      } else if (used + 1 <= beforeCount) {
        fitting.push([li, null]);
        used += 1;
        break;
      } else {
        break;
      }
    }

    // Pad top
    for (let i = 0; i < beforeCount - used; i++) {
      output.push(PAD_LINE);
    }

    // Phase 2: render furthest first
    for (let i = fitting.length - 1; i >= 0; i--) {
      const [li, rom] = fitting[i];
      const text = this.displayText(displayLineText(update.lines[li]));
      output.push({ text, style: this.styleBefore });
      if (rom !== null) {
        output.push({ text: rom, style: this.styleBefore });
      }
    }

    // Padding before current line
    for (let i = 0; i < this.paddingBefore; i++) {
      output.push(PAD_LINE);
    }

    // --- Current line ---
    output.push({ text: currentText, style: this.styleCurrent });
    if (currentRom !== null) {
      output.push({ text: currentRom, style: this.styleCurrent });
    }

    // Padding after current line
    for (let i = 0; i < this.paddingAfter; i++) {
      output.push(PAD_LINE);
    }

    // --- Lines after current ---
    let afterUsed = 0;
    for (let li = update.index + 1; li < update.lines.length; li++) {
      if (afterUsed >= afterCount) {
        break;
      }
      const text = displayLineText(update.lines[li]);
      const rom = this.romanization(text, false);
      const rows = rom !== null ? 2 : 1;

      if (afterUsed + rows <= afterCount) {
        output.push({ text: this.displayText(text), style: this.styleAfter });
        if (rom !== null) {
          output.push({ text: rom, style: this.styleAfter });
        }
        afterUsed += rows;
      } else if (afterUsed + 1 <= afterCount) {
        output.push({ text: this.displayText(text), style: this.styleAfter });
        afterUsed += 1;
        break;
      } else {
        break;
      }
    }

    // Pad bottom
    for (let i = 0; i < afterCount - afterUsed; i++) {
      output.push(PAD_LINE);
    }

    return output;
  }

  private render(width: number, height: number): string {
    const update = this.state;
    if (update === null) {
      return clearScreen();
    }

    if (update.error !== null && !this.ignoreErrors) {
      return clearScreen() + centerBlock([{ text: update.error, style: null }], width, height);
    }

    const output = this.buildOutput(update, height);
    if (output.length === 0) {
      return clearScreen();
    }

    return clearScreen() + centerBlock(output, width, height);
  }

  async run(rx: Channel<Update>): Promise<void> {
    const stdin = process.stdin;
    const stdout = process.stdout;

    const keys = new Channel<string>();
    const onData = (chunk: Buffer | string): void => {
      keys.send(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    };

    const hadRawMode = typeof stdin.setRawMode === "function";
    if (hadRawMode) {
      stdin.setRawMode(true);
    }
    stdin.resume();
    stdin.on("data", onData);

    // Enter alternate screen + hide cursor.
    stdout.write("\x1b[?1049h\x1b[?25l");

    const draw = (): void => {
      const width = stdout.columns ?? 80;
      const height = stdout.rows ?? 24;
      stdout.write(this.render(width, height));
    };

    try {
      draw();

      let keyP = keys.recv();
      let updateP = rx.recv();

      while (true) {
        const winner = await Promise.race([
          keyP.then((v) => ({ tag: "key", v }) as const),
          updateP.then((v) => ({ tag: "update", v }) as const),
        ]);

        if (winner.tag === "key") {
          const k = winner.v;
          if (k === undefined) {
            break;
          }
          keyP = keys.recv();
          if (isQuit(k)) {
            break;
          }
        } else {
          const u = winner.v;
          if (u === undefined) {
            break;
          }
          updateP = rx.recv();
          this.state = u;
          draw();
        }
      }
    } finally {
      stdin.off("data", onData);
      keys.close();
      if (hadRawMode) {
        stdin.setRawMode(false);
      }
      stdin.pause();
      // Leave alternate screen + show cursor.
      stdout.write("\x1b[?1049l\x1b[?25h");
    }
  }
}

function isQuit(key: string): boolean {
  return key === "q" || key === "\x1b" || key === "\x03";
}

function saturatingSub(a: number, b: number): number {
  return a > b ? a - b : 0;
}

function clearScreen(): string {
  return "\x1b[2J\x1b[H";
}

function centerBlock(lines: RenderedLine[], width: number, height: number): string {
  const out: string[] = [];
  const top = Math.floor(saturatingSub(height, lines.length) / 2);
  for (let i = 0; i < top; i++) {
    out.push("");
  }
  for (const line of lines) {
    out.push(centerLine(line, width));
  }
  return out.join("\r\n");
}

function centerLine(line: RenderedLine, width: number): string {
  const text = line.text;
  const pad = Math.floor(saturatingSub(width, displayWidth(text)) / 2);
  const indent = " ".repeat(pad);
  if (line.style === null) {
    return indent + text;
  }
  const ansi = styleToAnsi(line.style);
  if (ansi === "") {
    return indent + text;
  }
  return indent + ansi + text + RESET;
}

function displayWidth(text: string): number {
  let width = 0;
  for (const c of text) {
    width += isWide(c) ? 2 : 1;
  }
  return width;
}

function isWide(c: string): boolean {
  const code = c.codePointAt(0);
  if (code === undefined) {
    return false;
  }
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3041 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x3fffd)
  );
}
