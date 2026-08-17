/**
 * ConfigMenu — the /config menu (Codex-experiment style).
 * Two sections: display toggles (checkbox rows, space toggles) and session
 * parameters (value rows, `e` opens inline editing; empty submit restores
 * default; values apply to the profile's compaction-basic patch on restart).
 *
 * @module dsh-tui-app/components/config-menu
 */
import React from "react";
import { Box, Text } from "ink";
import { h } from "../runtime/jsx.js";
import { paint } from "../theme/palette.js";

export const CONFIG_LABELS = {
  turns: "轮次 / 步数",
  steps: "步骤数",
  llmMs: "LLM 时间",
  toolMs: "工具调用时间",
  cache: "缓存命中率",
  tps: "TPS",
};
const CONFIG_ORDER = ["turns", "steps", "llmMs", "toolMs", "cache", "tps"];

export const CONFIG_PARAM_LABELS = {
  contextWindow: "上下文窗口 (tokens)",
  compressThreshold: "压缩触发阈值 (0.05–1)",
  compactRetainTokens: "压缩后保留 (tokens)",
  autoCompact: "自动压缩",
};

function fmtValue(v) {
  if (v == null || v === "") return paint("默认", "dim");
  if (typeof v === "number") return String(v);
  return v ? "true" : "false";
}

export default function ConfigMenu({ config, menu }) {
  if (!menu) return null;
  const selected = menu.selected ?? 0;
  const editing = menu.editing === true;
  const editBuffer = menu.editBuffer ?? "";
  const nToggles = CONFIG_ORDER.length;
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
    h(Text, { dimColor: true }, " 显示开关"),
    CONFIG_ORDER.map((key, i) => {
      const on = config[key] === true;
      const isSel = i === selected && !editing;
      const mark = on ? paint("✔", "success") : " ";
      return h(
        Text,
        { key, bold: isSel, color: isSel ? "#4D6BFE" : undefined },
        `  [${mark}] ${CONFIG_LABELS[key]}`
      );
    }),
    h(Text, { dimColor: true }, " 会话参数（e 编辑 · 清空恢复默认 · 重启生效）"),
    Object.keys(CONFIG_PARAM_LABELS).map((key, i) => {
      const abs = nToggles + i;
      const isEditing = abs === selected && editing;
      const isSel = abs === selected && !editing;
      const value = isEditing ? editBuffer : config[key];
      const cursor = isEditing ? paint("▌", "accent") : "";
      return h(
        Text,
        { key, bold: isSel, color: isSel ? "#4D6BFE" : undefined },
        `  ${isSel || isEditing ? paint("● ", "accent") : "  "}${CONFIG_PARAM_LABELS[key]}: ${isEditing ? value + cursor : fmtValue(value)}`
      );
    }),
    editing
      ? h(Text, { dimColor: true }, "  （输入中：回车确认 · esc 取消 · 清空=恢复默认）")
      : null,
    h(Text, { dimColor: true }, "  空格 切换 · e 编辑参数 · ↑↓ 移动 · 回车/esc 关闭")
  );
}
