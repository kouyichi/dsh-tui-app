/**
 * ModelMenu — the /model picker: model radio list with context window,
 * reasoning-effort toggle (e key). Selecting saves the default selection
 * (next session; the running agent keeps its creation-time model).
 *
 * @module dsh-tui-app/components/model-menu
 */
import React from "react";
import { Box, Text } from "ink";
import { h } from "../runtime/jsx.js";
import { paint } from "../theme/palette.js";

/** Compact context window: 1000000 -> "1M". */
function fmtCtx(n) {
  if (!n) return "";
  if (n >= 1e6) return `${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

export default function ModelMenu({ menu }) {
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
    h(Text, { bold: true, color: "#4D6BFE" }, " model "),
    menu.items.map((item, i) => {
      const isSel = i === selected;
      const mark = isSel ? paint("●", "accent") : "○";
      const ctx = fmtCtx(item.contextWindow ?? item.context?.contextWindow);
      return h(
        Text,
        { key: item.id, bold: isSel, color: isSel ? "#4D6BFE" : undefined },
        `  [${mark}] ${item.name ?? item.id}${ctx ? paint(`   ctx ${ctx}`, "dim") : ""}`
      );
    }),
    h(
      Text,
      { dimColor: true },
      `  推理力度: ${paint(menu.effort ?? "max", "warning")}（按 e 切换）`
    ),
    h(Text, { dimColor: true }, "  空格 选择 · ↑↓ 移动 · e 力度 · 回车/esc 关闭")
  );
}
