/**
 * InputBox — the bottom input line: `❯` prompt (brand blue), current buffer,
 * and the Hermes-style slash suggestion menu above it: two-column rows
 * (command + description), description-aware fuzzy ranking, selected row
 * carries a highlight chip, viewport scrolls around the selection.
 *
 * @module dsh-tui-app/components/input-box
 */
import React from "react";
import { Box, Text } from "ink";
import { h } from "../runtime/jsx.js";
import { paint } from "../theme/palette.js";

const MENU_WINDOW = 8;

export default function InputBox({ input, ctl }) {
  if (!input) return null;
  const { buffer, cursor, vim } = input;
  const suggestions = Array.isArray(input.suggestions) ? input.suggestions : [];
  const showMenu = buffer.startsWith("/") && suggestions.length > 0;
  const selected = input.selected ?? 0;

  // Menu viewport centered on the selection (Hermes-style fixed window).
  const start = showMenu
    ? Math.max(0, Math.min(selected - Math.floor(MENU_WINDOW / 2), suggestions.length - MENU_WINDOW))
    : 0;
  const visible = showMenu ? suggestions.slice(start, start + MENU_WINDOW) : [];

  const display = buffer + (vim ? paint(" ⓥ", "warning") : "");
  const caret = " ".repeat(Math.max(0, cursor - (vim ? 4 : 0))) + " ";

  return h(
    Box,
    { flexDirection: "column" },
    showMenu &&
      h(
        Box,
        { flexDirection: "column", borderStyle: "round", borderColor: "#4D6BFE", marginBottom: 0, paddingX: 1 },
        h(Text, { bold: true, color: "#4D6BFE" }, ` 命令（${suggestions.length}）`),
        visible.map((s, i) => {
          const row = start + i;
          const active = row === selected;
          const text = typeof s === "string" ? s : s?.text ?? "";
          const desc = typeof s === "string" ? "" : s?.description ?? "";
          const mark = active ? paint("▸", "accent") : " ";
          const cmd = active ? paint(text, "accent-bold") : text;
          const d = desc ? paint(` ${desc}`, "dim") : "";
          return h(
            Text,
            { key: `${row}:${text}`, bold: active },
            ` ${mark} ${cmd}${d}`
          );
        })
      ),
    h(
      Box,
      { flexDirection: "row" },
      h(Text, { color: "#4D6BFE" }, "❯"),
      h(Text, null, ` ${display}`),
      h(Text, { color: "#4D6BFE" }, caret)
    )
  );
}
