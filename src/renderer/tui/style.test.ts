import { test, expect } from "bun:test";
import {
  parseStyle,
  parseColor,
  buildStyle,
  defaultStyle,
  type Color,
  type Style,
} from "./style";

// Helpers to build expected styles from the default + modifiers, mirroring
// `Style::default().add_modifier(...)` / `.fg(...)`.
function withModifiers(mods: Partial<Style>): Style {
  return { ...defaultStyle(), ...mods };
}

// --- parse_style tests ---

test("test_parse_style_bold", () => {
  expect(parseStyle("bold")).toEqual(withModifiers({ bold: true }));
});

test("test_parse_style_faint", () => {
  expect(parseStyle("faint")).toEqual(withModifiers({ dim: true }));
});

test("test_parse_style_combined", () => {
  expect(parseStyle("bold,italic")).toEqual(withModifiers({ bold: true, italic: true }));
});

test("test_parse_style_all_modifiers", () => {
  const style = parseStyle("bold,italic,underline,faint");
  const expected = withModifiers({ bold: true, italic: true, underline: true, dim: true });
  expect(style).toEqual(expected);
});

test("test_parse_style_with_spaces", () => {
  expect(parseStyle(" bold , italic ")).toEqual(withModifiers({ bold: true, italic: true }));
});

test("test_parse_style_unknown_ignored", () => {
  expect(parseStyle("bold,unknown")).toEqual(withModifiers({ bold: true }));
});

// --- parse_color tests ---

test("test_parse_color_hex", () => {
  expect(parseColor("#ff5500")).toEqual({ type: "rgb", r: 255, g: 85, b: 0 } as Color);
});

test("test_parse_color_hex_black", () => {
  expect(parseColor("#000000")).toEqual({ type: "rgb", r: 0, g: 0, b: 0 } as Color);
});

test("test_parse_color_ansi_index", () => {
  expect(parseColor("245")).toEqual({ type: "indexed", index: 245 } as Color);
});

test("test_parse_color_named_red", () => {
  expect(parseColor("red")).toEqual({ type: "named", name: "red" } as Color);
});

test("test_parse_color_named_gray", () => {
  expect(parseColor("gray")).toEqual({ type: "named", name: "gray" } as Color);
});

test("test_parse_color_named_white", () => {
  expect(parseColor("white")).toEqual({ type: "named", name: "white" } as Color);
});

test("test_parse_color_empty", () => {
  expect(parseColor("")).toBe(null);
});

test("test_parse_color_invalid", () => {
  expect(parseColor("notacolor")).toBe(null);
});

// --- build_style tests ---

test("test_build_style_with_color", () => {
  const style = buildStyle("bold", "red");
  expect(style).toEqual(withModifiers({ bold: true, fg: { type: "named", name: "red" } }));
});

test("test_build_style_without_color", () => {
  const style = buildStyle("faint", null);
  expect(style).toEqual(withModifiers({ dim: true }));
});
