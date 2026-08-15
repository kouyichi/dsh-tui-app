/**
 * StatusBar — one compact line under the stream. Segments (all optional via
 * /config): model · turns/steps · LLM time · tool time · cache hit rate ·
 * TPS · git branch · workspace. Values degrade gracefully.
 *
 * @module dsh-tui-app/components/status-bar
 */
import React from "react";
import { Box, Text } from "ink";
import { h } from "../runtime/jsx.js";
import { paint } from "../theme/palette.js";
import { fmtMs } from "../util/format.js";

export default function StatusBar({ status, meta, stats, config }) {
  const bits = [];
  if (meta?.model) bits.push(paint(meta.model, "accent"));
  if (meta?.mode) bits.push(paint(meta.mode, "accent"));
  if (config?.turns && stats) {
    bits.push(paint(`t${stats.turns} · s${stats.steps}`, "dim"));
  }
  if (config?.llmMs && stats && stats.llmMs > 0) {
    bits.push(paint(`llm ${fmtMs(stats.llmMs)}`, "dim"));
  }
  if (config?.toolMs && stats && stats.toolMs > 0) {
    bits.push(paint(`tool ${fmtMs(stats.toolMs)}`, "dim"));
  }
  if (config?.cache && stats) {
    const total = stats.cacheRead + stats.uncachedInput;
    const pct = total > 0 ? Math.round((stats.cacheRead / total) * 100) : null;
    if (pct !== null) bits.push(paint(`cache ${pct}%`, "warning"));
  }
  if (config?.tps && stats && stats.decodeMs > 0 && stats.decodeTokens > 0) {
    const tps = Math.round((stats.decodeTokens / stats.decodeMs) * 1000);
    bits.push(paint(`tps ${tps}`, "warning"));
  }
  if (config?.turns && stats && stats.totalTokens > 0) {
    bits.push(paint(`tok ${(stats.totalTokens / 1000).toFixed(1)}k`, "dim"));
  }
  if (status?.branch) bits.push(paint(status.branch, "dim"));
  if (meta?.cwd) bits.push(paint(meta.cwd, "dim"));
  const line = bits.length ? bits.join("  ·  ") : "";
  return h(
    Box,
    { borderStyle: "round", borderColor: "#4D6BFE", paddingX: 1, marginTop: 1 },
    h(Text, null, line)
  );
}
