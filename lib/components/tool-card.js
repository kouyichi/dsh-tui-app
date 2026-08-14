/**
 * ToolCard — one tool invocation in the stream: colored status header over a
 * recessed (dim) body. Fold states (from Ctrl+O cycling in the stream):
 *   collapsed (default): header + one-line preview
 *   expanded:            header + full args/result body
 *   hidden:              header only, no body
 *
 * @module dsh-tui-app/components/tool-card
 */
import React from "react";
import { Box, Text } from "ink";
import { h } from "../runtime/jsx.js";
import { paint } from "../theme/palette.js";

function headerColor(ok) {
  return ok === false ? "error" : "dim";
}

export function ToolCard({ name, args, ok, preview, fold }) {
  const head = paint(`Tool / ${name}`, headerColor(ok)) +
    (ok === false ? paint("  ✗", "error") : ok === true ? paint("  ✓", "success") : paint("  …", "warning"));
  const body =
    fold === "expanded"
      ? [
          h(Text, { key: "args", dimColor: true }, `  ${args ?? ""}`),
          h(Text, { key: "res", dimColor: true }, `  ${preview ?? ""}`),
        ]
      : fold === "hidden"
        ? null
        : h(Text, { key: "prev", dimColor: true }, `  ${preview ?? ""}`);

  return h(
    Box,
    { flexDirection: "column", marginLeft: 1, marginBottom: 0 },
    h(Text, null, head),
    body
  );
}
