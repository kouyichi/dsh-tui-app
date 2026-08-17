/**
 * ModelMenu — the /model picker: flat list of models across ALL providers
 * (from the brick model catalog), each row tagged with its provider; the
 * reasoning-effort line cycles the SELECTED model's actual effort options
 * (e key). Selecting saves the selection AND applies it immediately to the
 * running agent (ctl.updateSelection).
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
  const item = menu.items[selected];
  const efforts = item?.efforts?.length ? item.efforts : (menu.efforts ?? ["off", "low", "high", "max"]);
  return h(
    Box,
    {
      flexDirection: "column",
      borderStyle: "round",
      borderColor: "#4D6BFE",
      paddingX: 1,
      marginBottom: 0,
    },
    h(Text, { bold: true, color: "#4D6BFE" }, ` model · ${efforts.length} 档力度 `),
    menu.items.map((it, i) => {
      const isSel = i === selected;
      const mark = isSel ? paint("●", "accent") : "○";
      const ctx = fmtCtx(it.contextWindow ?? it.context?.contextWindow);
      const prov = it.providerName && it.providerName !== it.id ? paint(it.providerName, "dim") : "";
      return h(
        Text,
        { key: `${it.provider}/${it.id}`, bold: isSel, color: isSel ? "#4D6BFE" : undefined },
        `  [${mark}] ${prov ? `${prov} ` : ""}${it.name ?? it.id}${ctx ? paint(`   ctx ${ctx}`, "dim") : ""}`
      );
    }),
    h(
      Text,
      { dimColor: true },
      `  推理力度: ${paint(menu.effort ?? "max", "warning")}（e 遍历 ${efforts.join(" / ")}）`
    ),
    h(Text, { dimColor: true }, "  空格 选择 · ↑↓ 移动 · e 力度 · 回车/esc 关闭")
  );
}
