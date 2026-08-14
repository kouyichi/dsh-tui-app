/**
 * TrajectoryPanel — /trajectory step-through of the current session's event
 * stream: one row per event (index, type, excerpt); arrows step, space
 * expands the selected event's full detail.
 *
 * @module dsh-tui-app/components/trajectory-panel
 */
import React from "react";
import { Box, Text } from "ink";
import { h } from "../runtime/jsx.js";
import { paint } from "../theme/palette.js";

function eventSummary(ev) {
  switch (ev.type ?? ev.kind) {
    case "user": return `user: ${ev.text.slice(0, 50)}`;
    case "assistant": return `assistant: ${(ev.text || "(thinking…)").slice(0, 50)}`;
    case "tool": return `tool ${ev.ok === false ? "✗" : ev.ok ? "✓" : "…"} ${ev.name} ${(ev.preview ?? ev.args ?? "").slice(0, 40)}`;
    case "notice": return `notice(${ev.tone}): ${ev.text.slice(0, 50)}`;
    case "assistant-delta": return ev.text ? `assistant▸ ${ev.text.slice(-40)}` : `reasoning▸ ${(ev.reasoning ?? "").slice(-40)}`;
    case "tool-start": return `tool▸ ${ev.name} ${ev.args.slice(0, 40)}`;
    case "tool-end": return `tool✓ ${ev.name} ${ev.ok ? "" : "✗ "}${ev.preview.slice(0, 40)}`;
    default: return String(ev.kind ?? ev.type ?? ev);
  }
}

export default function TrajectoryPanel({ menu }) {
  if (!menu) return null;
  const selected = menu.selected ?? 0;
  const events = menu.events ?? [];
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
    h(Text, { bold: true, color: "#4D6BFE" }, ` trajectory (${events.length}) `),
    events.length === 0
      ? h(Text, { dimColor: true }, "  无事件")
      : events.slice(0, 14).map((ev, i) => {
          const isSel = i === selected;
          return h(
            Text,
            { key: i, bold: isSel, color: isSel ? "#4D6BFE" : undefined },
            `  ${isSel ? paint("● ", "accent") : "  "}${String(i).padStart(3, " ")}  ${eventSummary(ev).slice(0, 60)}`
          );
        }),
    detail !== ""
      ? h(
          Box,
          { flexDirection: "column", borderStyle: "single", borderColor: "#4D6BFE", marginLeft: 2, paddingX: 1 },
          h(Text, { wrap: "wrap" }, detail.slice(0, 500))
        )
      : null,
    h(Text, { dimColor: true }, "  ↑↓ 步进 · 空格 详情 · esc 关闭")
  );
}
