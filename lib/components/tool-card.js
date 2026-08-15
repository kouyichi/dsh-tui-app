/**
 * ToolCard — one tool invocation: prominent `⚙ name` header with a status
 * mark (… running / ✓ ok / ✗ error), recessed args and result rows.
 * Fold states (Ctrl+O): collapsed = header + one-line preview;
 * expanded = full args/result; hidden = header only.
 *
 * @module dsh-tui-app/components/tool-card
 */
import React from "react";
import { Box, Text } from "ink";
import { h } from "../runtime/jsx.js";
import { paint } from "../theme/palette.js";

function statusMark(ok) {
  if (ok === false) return paint("✗", "error");
  if (ok === true) return paint("✓", "success");
  return paint("…", "warning");
}

export function ToolCard({ name, args, ok, preview, fold }) {
  const head = h(
    Box,
    { flexDirection: "row" },
    h(Text, { bold: true, color: "#4D6BFE" }, `⚙ ${name}`),
    h(Text, null, `  ${statusMark(ok)}`)
  );
  const body =
    fold === "expanded"
      ? [
          h(Text, { key: "args", dimColor: true, wrap: "wrap" }, `│ ${args ?? ""}`),
          h(Text, { key: "res", dimColor: true, wrap: "wrap" }, `│ ${preview ?? ""}`),
        ]
      : fold === "hidden"
        ? null
        : h(Text, { key: "prev", dimColor: true, wrap: "wrap" }, `│ ${preview ?? ""}`);

  return h(
    Box,
    { flexDirection: "column", marginLeft: 1, marginBottom: 0 },
    head,
    body
  );
}
