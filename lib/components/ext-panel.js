/**
 * ExtPanel — generic text panel for brick plugins (usage/context/todos/...).
 * Renders a titled box of plain-text lines with simple scrolling.
 * Plugins return PLAIN text (no ANSI) — the panel renders raw rows to stay
 * safe under Ink's Text escaping.
 *
 * @module dsh-tui-app/components/ext-panel
 */
import React from "react";
import { Box, Text } from "ink";
import { h } from "../runtime/jsx.js";

const MAX_VISIBLE = 24;

export default function ExtPanel({ panel }) {
  if (!panel) return null;
  const lines = panel.lines || [];
  const start = Math.max(0, Math.min(panel.scroll || 0, Math.max(0, lines.length - MAX_VISIBLE)));
  const visible = lines.slice(start, start + MAX_VISIBLE);
  const scrolled = start > 0 || lines.length > start + MAX_VISIBLE;
  const selectable = typeof panel.selected === "number";
  const selected = selectable ? Math.max(0, Math.min(23, panel.selected)) : -1;
  return h(
    Box,
    { flexDirection: "column", borderStyle: "round", borderColor: "#4D6BFE", marginTop: 1, paddingX: 1 },
    h(Text, { bold: true }, `${panel.title}${scrolled ? `  (${start + 1}-${start + visible.length}/${lines.length})` : ""}`),
    ...(visible.length === 0
      ? [h(Text, { dimColor: true }, "（空）")]
      : visible.map((line, i) =>
          h(Text, { key: i, bold: selectable && i === selected }, selectable && i === selected ? `> ${line}` : `  ${line === "" ? " " : line}`)
        )),
    h(Text, { dimColor: true }, selectable ? "↑↓ 选择 · enter 执行 · esc/q 关闭" : "↑↓ 滚动 · esc/q 关闭")
  );
}
