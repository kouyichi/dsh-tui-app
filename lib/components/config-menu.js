/**
 * ConfigMenu — the /config checkbox menu (Codex-experiment style).
 * Rendered above the input line while open: each row is `[x] label`,
 * space toggles, arrows move, enter/esc closes.
 *
 * @module dsh-tui-app/components/config-menu
 */
import React from "react";
import { Box, Text } from "ink";
import { h } from "../runtime/jsx.js";
import { paint } from "../theme/palette.js";

export const CONFIG_LABELS = {
  turns: "轮次 / 步数",
  llmMs: "LLM 时间",
  toolMs: "工具调用时间",
  cache: "缓存命中率",
  tps: "TPS",
};
const CONFIG_ORDER = ["turns", "llmMs", "toolMs", "cache", "tps"];

export default function ConfigMenu({ config, menu }) {
  if (!menu) return null;
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
    h(Text, { bold: true, color: "#4D6BFE" }, " config "),
    CONFIG_ORDER.map((key, i) => {
      const on = config[key] === true;
      const isSel = i === selected;
      const mark = on ? paint("✔", "success") : " ";
      return h(
        Text,
        { key, bold: isSel, color: isSel ? "#4D6BFE" : undefined },
        `  [${mark}] ${CONFIG_LABELS[key]}`
      );
    }),
    h(Text, { dimColor: true }, "  空格 切换 · ↑↓ 移动 · 回车/esc 关闭")
  );
}
