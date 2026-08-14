/**
 * ModeMenu — the /mode agent-preset picker (web "四种模式" switch).
 * Radio-style list: [●] selected, [○] others; space selects, arrows move,
 * enter/esc closes. Selecting writes the settings default (next session).
 *
 * @module dsh-tui-app/components/mode-menu
 */
import React from "react";
import { Box, Text } from "ink";
import { h } from "../runtime/jsx.js";
import { paint } from "../theme/palette.js";

export default function ModeMenu({ menu, current }) {
  if (!menu || !menu.items?.length) return null;
  const selected = menu.selected ?? 0;
  return h(
    Box,
    {
      flexDirection: "column",
      borderStyle: "round",
      borderColor: "#4D6BFE",
      paddingX: 1,
      marginBottom: 0,
    },
    h(Text, { bold: true, color: "#4D6BFE" }, " mode "),
    menu.items.map((item, i) => {
      const isSel = i === selected;
      const isCurrent = item.id === current;
      const mark = isCurrent ? paint("●", "accent") : "○";
      const desc = (item.description ?? "").slice(0, 34);
      return h(
        Text,
        { key: item.id, bold: isSel, color: isSel ? "#4D6BFE" : undefined },
        `  [${mark}] ${item.name ?? item.id}${isCurrent ? paint(" (当前)", "dim") : ""}${desc ? paint(`  ${desc}`, "dim") : ""}`
      );
    }),
    h(Text, { dimColor: true }, "  空格 选择 · ↑↓ 移动 · 回车/esc 关闭")
  );
}
