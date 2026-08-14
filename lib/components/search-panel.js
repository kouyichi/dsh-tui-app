/**
 * SearchPanel — /search result list: full-text session hits (title/id/cwd),
 * arrow navigation, space shows the resume hint, esc closes.
 *
 * @module dsh-tui-app/components/search-panel
 */
import React from "react";
import { Box, Text } from "ink";
import { h } from "../runtime/jsx.js";
import { paint } from "../theme/palette.js";

export default function SearchPanel({ menu }) {
  if (!menu) return null;
  const selected = menu.selected ?? 0;
  const hits = menu.hits ?? [];
  return h(
    Box,
    {
      flexDirection: "column",
      borderStyle: "round",
      borderColor: "#4D6BFE",
      paddingX: 1,
      marginBottom: 0,
    },
    h(Text, { bold: true, color: "#4D6BFE" }, ` search「${menu.query ?? ""}」 `),
    hits.length === 0
      ? h(Text, { dimColor: true }, "  无命中")
      : hits.map((hit, i) => {
          const isSel = i === selected;
          const title = hit.title ?? "(无标题)";
          const score = hit.bestMatch?.score;
          return h(
            Text,
            { key: hit.id, bold: isSel, color: isSel ? "#4D6BFE" : undefined },
            `  ${isSel ? paint("● ", "accent") : "  "}${String(title).slice(0, 40)}${hit.cwd ? paint(`  @ ${hit.cwd}`, "dim") : ""}${score ? paint(`  ${score.toFixed(2)}`, "dim") : ""}`
          );
        }),
    h(
      Text,
      { dimColor: true },
      "  ↑↓ 选择 · 空格 查看 resume 命令 · esc 关闭"
    )
  );
}
