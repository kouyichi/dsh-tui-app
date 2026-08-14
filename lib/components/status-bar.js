/**
 * StatusBar — one compact line under the stream: model · branch · jobs · workspace.
 * Values degrade gracefully when the backing service is unavailable.
 *
 * @module dsh-tui-app/components/status-bar
 */
import React from "react";
import { Box, Text } from "ink";
import { h } from "../runtime/jsx.js";
import { paint } from "../theme/palette.js";

export default function StatusBar({ status, meta }) {
  const bits = [];
  if (meta?.model) bits.push(paint(meta.model, "accent"));
  if (status?.branch) bits.push(paint(status.branch, "dim"));
  if (status?.jobs) bits.push(paint(`jobs ${status.jobs}`, "warning"));
  if (status?.tokens) bits.push(paint(status.tokens, "dim"));
  if (meta?.cwd) bits.push(paint(meta.cwd, "dim"));
  const line = bits.length ? bits.join("  ·  ") : "";
  return h(
    Box,
    { borderStyle: "round", borderColor: "#4D6BFE", paddingX: 1, marginTop: 1 },
    h(Text, null, line)
  );
}
