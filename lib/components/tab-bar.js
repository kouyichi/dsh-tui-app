/**
 * TabBar — multi-session tab strip: [n] title per tab, active tab accented.
 *
 * @module dsh-tui-app/components/tab-bar
 */
import React from "react";
import { Box, Text } from "ink";
import { h } from "../runtime/jsx.js";
import { paint } from "../theme/palette.js";

export default function TabBar({ tabs, activeTab }) {
  if (!tabs || tabs.length === 0) return null;
  return h(
    Box,
    { flexDirection: "row", marginBottom: 0 },
    tabs.map((tab, i) => {
      const active = i === activeTab;
      const label = `${i + 1}:${tab.title ?? tab.sessionId.slice(0, 10)}`;
      return h(
        Text,
        { key: tab.id, bold: active, color: active ? "#4D6BFE" : undefined, dimColor: !active },
        active ? paint(` [${label}]`, "accent-bold") : ` [${label}]`
      );
    }),
    h(Text, { dimColor: true }, "  /tab new|编号")
  );
}
