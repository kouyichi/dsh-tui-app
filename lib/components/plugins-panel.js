/**
 * PluginsPanel — /plugins market: two sections (native @deepseek-ai bundles
 * vs user/extra-loaded bundles), scroll window follows the selection (the
 * focused row never leaves the viewport), `t` toggles load/unload (runtime
 * entry.update + persisted to tui-config.json; core rows are protected).
 *
 * @module dsh-tui-app/components/plugins-panel
 */
import React from "react";
import { Box, Text } from "ink";
import { h } from "../runtime/jsx.js";
import { paint } from "../theme/palette.js";

const WINDOW = 12;

/** Render one scrollable group with its header; selection may be in either. */
function Group({ title, plugins, selected, onSelect }) {
  if (plugins.length === 0) return null;
  // window follows selection (centered when possible)
  const start = Math.max(0, Math.min(selected, plugins.length - WINDOW));
  const rows = plugins.slice(start, start + WINDOW);
  const selInGroup = selected >= start && selected < start + rows.length;
  return h(
    Box,
    { flexDirection: "column" },
    h(Text, { bold: true, color: "#4D6BFE" }, ` ${title} (${plugins.length}) `),
    rows.map((p, i) => {
      const idx = start + i;
      const isSel = selInGroup && idx === selected;
      const mark = p.disabled > 0 ? paint(` ⚠${p.disabled}`, "warning") : paint(" ✓", "success");
      return h(
        Text,
        { key: p.name, bold: isSel, color: isSel ? "#4D6BFE" : undefined },
        `  ${isSel ? paint("● ", "accent") : "  "}${p.name}${paint(` ×${p.count}`, "dim")}${mark}`
      );
    })
  );
}

export default function PluginsPanel({ menu }) {
  if (!menu) return null;
  const selected = menu.selected ?? 0;
  const builtin = menu.builtin ?? [];
  const user = menu.user ?? [];
  const detail = menu.detail ?? "";
  const total = builtin.length + user.length;
  return h(
    Box,
    {
      flexDirection: "column",
      borderStyle: "round",
      borderColor: "#4D6BFE",
      paddingX: 1,
      marginBottom: 0,
    },
    h(Text, { bold: true, color: "#4D6BFE" }, ` plugins (${total}) `),
    h(Group, { title: "原生", plugins: builtin, selected, onSelect: null }),
    h(Group, { title: "后加载", plugins: user, selected: selected - builtin.length, onSelect: null }),
    detail !== ""
      ? h(
          Box,
          { flexDirection: "column", borderStyle: "single", borderColor: "#4D6BFE", marginLeft: 2, paddingX: 1 },
          h(Text, { wrap: "wrap" }, detail.slice(0, 500))
        )
      : null,
    h(Text, { dimColor: true }, "  ↑↓ 选择 · 空格 详情 · t 加载/卸载 · esc 关闭")
  );
}
