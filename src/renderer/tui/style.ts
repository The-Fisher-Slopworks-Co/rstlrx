// Replicates `ratatui` Style/Color as plain data so tests use structural equality.

export type NamedColor =
  | "reset"
  | "black"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "gray"
  | "darkgray"
  | "lightred"
  | "lightgreen"
  | "lightyellow"
  | "lightblue"
  | "lightmagenta"
  | "lightcyan"
  | "white";

export type Color =
  | { type: "named"; name: NamedColor }
  | { type: "rgb"; r: number; g: number; b: number }
  | { type: "indexed"; index: number };

export interface Style {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  dim: boolean;
  fg: Color | null;
}

export const RESET = "\x1b[0m";

export function defaultStyle(): Style {
  return { bold: false, italic: false, underline: false, dim: false, fg: null };
}

/**
 * Mirrors `parse_style`: split on ',', trim + lowercase each part. `faint`/`dim`
 * both map to the `dim` modifier. Unknown tokens are ignored.
 */
export function parseStyle(input: string): Style {
  const style = defaultStyle();
  for (const part of input.split(",")) {
    switch (part.trim().toLowerCase()) {
      case "bold":
        style.bold = true;
        break;
      case "italic":
        style.italic = true;
        break;
      case "underline":
        style.underline = true;
        break;
      case "faint":
      case "dim":
        style.dim = true;
        break;
      default:
        break;
    }
  }
  return style;
}

const NAMED_COLORS: ReadonlySet<NamedColor> = new Set<NamedColor>([
  "reset",
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "gray",
  "darkgray",
  "lightred",
  "lightgreen",
  "lightyellow",
  "lightblue",
  "lightmagenta",
  "lightcyan",
  "white",
]);

/**
 * Replicates Rust `u8::from_str`: an optional leading `+`, then ASCII digits
 * only, with the value in 0..=255. Returns null for anything else (whitespace,
 * leading `-`, non-digits, out of range, empty).
 */
function parseU8(s: string): number | null {
  let body = s;
  if (body.startsWith("+")) {
    body = body.slice(1);
  }
  if (body.length === 0) {
    return null;
  }
  for (const ch of body) {
    if (ch < "0" || ch > "9") {
      return null;
    }
  }
  const value = Number(body);
  if (value > 255) {
    return null;
  }
  return value;
}

/** Replicates `ratatui` `parse_hex_color`: requires `#` prefix and length 7. */
function parseHexColor(input: string): { r: number; g: number; b: number } | null {
  if (!input.startsWith("#") || input.length !== 7) {
    return null;
  }
  const parseByte = (hex: string): number | null => {
    if (!/^[0-9a-fA-F]{2}$/.test(hex)) {
      return null;
    }
    return parseInt(hex, 16);
  };
  const r = parseByte(input.slice(1, 3));
  const g = parseByte(input.slice(3, 5));
  const b = parseByte(input.slice(5, 7));
  if (r === null || g === null || b === null) {
    return null;
  }
  return { r, g, b };
}

/**
 * Mirrors `parse_color` + ratatui `Color::from_str` (case-insensitive, trimmed):
 * - empty → null
 * - normalized named color (incl. grey/silver/bright aliases) → named
 * - all-digit 0..=255 (on the raw trimmed input) → indexed
 * - `#rrggbb` → rgb
 * - otherwise → null
 */
export function parseColor(input: string): Color | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return null;
  }

  // Named-color match operates on the normalized string (ratatui Color::from_str).
  const normalized = trimmed
    .toLowerCase()
    .replace(/[ \-_]/g, "")
    .replace(/bright/g, "light")
    .replace(/grey/g, "gray")
    .replace(/silver/g, "gray")
    .replace(/lightblack/g, "darkgray")
    .replace(/lightwhite/g, "white")
    .replace(/lightgray/g, "white");

  if (NAMED_COLORS.has(normalized as NamedColor)) {
    return { type: "named", name: normalized as NamedColor };
  }

  // Integer + hex branches use the raw (trimmed) input, matching Rust.
  const index = parseU8(trimmed);
  if (index !== null) {
    return { type: "indexed", index };
  }

  const rgb = parseHexColor(trimmed);
  if (rgb !== null) {
    return { type: "rgb", r: rgb.r, g: rgb.g, b: rgb.b };
  }

  return null;
}

/** Mirrors `build_style`: parse modifiers, then apply fg if a color parses. */
export function buildStyle(styleStr: string, color: string | null | undefined): Style {
  const style = parseStyle(styleStr);
  if (color !== null && color !== undefined) {
    const parsed = parseColor(color);
    if (parsed !== null) {
      style.fg = parsed;
    }
  }
  return style;
}

const NAMED_ANSI_FG: Record<NamedColor, string> = {
  reset: "39",
  black: "30",
  red: "31",
  green: "32",
  yellow: "33",
  blue: "34",
  magenta: "35",
  cyan: "36",
  gray: "37",
  darkgray: "90",
  lightred: "91",
  lightgreen: "92",
  lightyellow: "93",
  lightblue: "94",
  lightmagenta: "95",
  lightcyan: "96",
  white: "97",
};

/**
 * Builds the opening SGR escape sequence for a style. Returns "" when the style
 * carries no attributes and no foreground color. Named foreground codes are
 * best-effort and not asserted by tests.
 */
export function styleToAnsi(style: Style): string {
  const codes: string[] = [];
  if (style.bold) {
    codes.push("1");
  }
  if (style.dim) {
    codes.push("2");
  }
  if (style.italic) {
    codes.push("3");
  }
  if (style.underline) {
    codes.push("4");
  }
  if (style.fg !== null) {
    switch (style.fg.type) {
      case "rgb":
        codes.push(`38;2;${style.fg.r};${style.fg.g};${style.fg.b}`);
        break;
      case "indexed":
        codes.push(`38;5;${style.fg.index}`);
        break;
      case "named":
        codes.push(NAMED_ANSI_FG[style.fg.name]);
        break;
      default:
        break;
    }
  }
  if (codes.length === 0) {
    return "";
  }
  return `\x1b[${codes.join(";")}m`;
}
