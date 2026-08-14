/**
 * InputBox — the bottom input line: `❯` prompt (brand blue), current buffer,
 * cursor position, and inline suggestions (command or file completion).
 * Rendering only: key handling lives in runtime/input (raw mode, IME-safe).
 *
 * @module dsh-tui-app/components/input-box
 */
import React from "react";
import { Box, Text } from "ink";
import { h } from "../runtime/jsx.js";
import { paint } from "../theme/palette.js";

export default function InputBox({ input, ctl }) {
  const buffer = input?.buffer ?? "";
  const cursor = input?.cursor ?? buffer.length;
  const suggestions = input?.suggestions ?? [];
  const busy = input?.busy ?? false;

  const before = buffer.slice(0, cursor);
  const at = buffer[cursor] ?? " ";
  const after = buffer.slice(cursor + 1);

  return h(
    Box,
    { flexDirection: "column" },
    suggestions.length > 0
      ? h(
          Box,
          { flexDirection: "row", marginBottom: 0 },
          suggestions.slice(0, 6).map((s, i) =>
            h(
              Text,
              { key: s, color: i === 0 ? "#4D6BFE" : undefined, dimColor: i !== 0 },
              ` ${s}`
            )
          )
        )
      : null,
    h(
      Box,
      { flexDirection: "row" },
      h(Text, null, busy ? paint("⏳ ", "warning") : paint("❯ ", "accent")),
      h(Text, null, before),
      h(Text, { backgroundColor: "#4D6BFE" }, at),
      h(Text, null, after)
    )
  );
}
