/**
 * InputBox — the bottom input line: `❯` prompt (brand blue), buffer with the
 * cursor rendered as a highlighted character block (background chip), and the
 * Hermes-style slash suggestion menu above it: two-column rows (command +
 * description), description-aware fuzzy ranking, selected row carries a
 * highlight chip, viewport scrolls around the selection.
 * Rendering only: key handling lives in runtime/input (raw mode, IME-safe).
 *
 * @module dsh-tui-app/components/input-box
 */
import React from "react";
import { Box, Text } from "ink";
import { h } from "../runtime/jsx.js";
import { paint } from "../theme/palette.js";

const MENU_WINDOW = 8;

export default function InputBox({ input, ctl }) {
  const buffer = input?.buffer ?? "";
  const cursor = input?.cursor ?? buffer.length;
  const suggestions = Array.isArray(input?.suggestions) ? input.suggestions : [];
  const selected = input?.selected ?? 0;
  const busy = input?.busy ?? false;
  const vim = input?.vim ?? false;

  // Hermes-style slash menu: shown while typing a command, filtered live by
  // the description-aware fuzzy rank, viewport centered on the selection.
  const showMenu = buffer.startsWith("/") && suggestions.length > 0;
  const start = showMenu
    ? Math.max(0, Math.min(selected - Math.floor(MENU_WINDOW / 2), suggestions.length - MENU_WINDOW))
    : 0;
  const visible = showMenu ? suggestions.slice(start, start + MENU_WINDOW) : [];

  const before = buffer.slice(0, cursor);
  const at = buffer[cursor] ?? " ";
  const after = buffer.slice(cursor + 1);

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
          return h(Text, { key: `${row}:${text}`, bold: active }, ` ${mark} ${cmd}${d}`);
        })
      ),
    h(
      Box,
      { flexDirection: "row" },
      h(Text, null, vim ? paint("❮ ", "warning") : busy ? paint("⏳ ", "warning") : paint("❯ ", "accent")),
      h(Text, null, before),
      h(Text, { backgroundColor: "#4D6BFE" }, at),
      h(Text, null, after)
    )
  );
}
