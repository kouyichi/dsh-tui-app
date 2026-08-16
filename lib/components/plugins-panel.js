/**
 * PluginsPanel — /plugins market: every loaded plugin bundle (aggregated from
 * loader entries by package name) with row count and disabled state; space
 * shows the contributing row ids. Read-only management view (enable/disable
 * happens in the profile's cordis.patch.yml).
 *
 * @module dsh-tui-app/components/plugins-panel
 */
import React from "react";
import { Box, Text } from "ink";
import { h } from "../runtime/jsx.js";
import { paint } from "../theme/palette.js";

export default function PluginsPanel({ menu }) {
  if (!menu) return null;
  const selected = menu.selected ?? 0;
  const plugins = menu.plugins ?? [];
  const detail = menu.detail ?? "";
  return h(
    Box,
    {
      flexDirection: "column",
      borderStyle: "round",
      borderColor: "#4D6BFE",
      paddingX: 1,
      marginBottom: 0,
    },
    h(Text, { bold: true, color: "#4D6BFE" }, ` plugins (${plugins.length}) `),
    plugins.length === 0
      ? h(Text, { dimColor: true }, "  无插件")
      : plugins.slice(0, 12).map((p, i) => {
          const isSel = i === selected;
          const mark = p.disabled > 0 ? paint(` ⚠${p.disabled} 禁用`, "warning") : "";
          return h(
            Text,
            { key: p.name, bold: isSel, color: isSel ? "#4D6BFE" : undefined },
            `  ${isSel ? paint("● ", "accent") : "  "}${p.name}${paint(` ×${p.count}`, "dim")}${mark}`
          );
        }),
    detail !== ""
      ? h(
          Box,
          { flexDirection: "column", borderStyle: "single", borderColor: "#4D6BFE", marginLeft: 2, paddingX: 1 },
          h(Text, { wrap: "wrap" }, detail.slice(0, 500))
        )
      : null,
    h(Text, { dimColor: true }, "  ↑↓ 选择 · 空格 行详情 · esc 关闭")
  );
}
