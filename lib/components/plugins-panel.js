/**
 * PluginsPanel — /plugins market with LEFT/RIGHT section switching: two tabs
 * (原生 @deepseek-ai bundles / 后加载 user bundles), ←→ switches the active
 * section, ↑↓ scrolls within it (window follows selection), space shows row
 * detail, t toggles load/unload (persisted; core rows protected).
 *
 * @module dsh-tui-app/components/plugins-panel
 */
import React from "react";
import { Box, Text } from "ink";
import { h } from "../runtime/jsx.js";
import { paint } from "../theme/palette.js";

const WINDOW = 12;

export default function PluginsPanel({ menu }) {
  if (!menu) return null;
  const section = menu.section ?? 0;
  const selected = menu.selected ?? 0;
  const builtin = menu.builtin ?? [];
  const user = menu.user ?? [];
  const list = section === 0 ? builtin : user;
  const detail = menu.detail ?? "";
  const total = builtin.length + user.length;

  const tab = (label, n, i) => {
    const active = i === section;
    return h(
      Text,
      { bold: active, color: active ? "#4D6BFE" : undefined, dimColor: !active },
      active ? paint(` [${label} ${n}]`, "accent-bold") : ` [${label} ${n}]`
    );
  };

  // window follows selection (centered when possible)
  const start = Math.max(0, Math.min(selected, list.length - WINDOW));
  const rows = list.slice(start, start + WINDOW);

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
    h(
      Box,
      { flexDirection: "row" },
      tab("原生", builtin.length, 0),
      tab("后加载", user.length, 1)
    ),
    rows.length === 0
      ? h(Text, { dimColor: true }, "  无插件")
      : rows.map((p, i) => {
          const isSel = start + i === selected;
          const mark = p.disabled > 0 ? paint(` ⚠${p.disabled}`, "warning") : paint(" ✓", "success");
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
    h(Text, { dimColor: true }, "  ←→ 切栏 · ↑↓ 选择 · 空格 详情 · t 加载/卸载 · esc 关闭")
  );
}
