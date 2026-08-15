/**
 * Splash — Hermes-aligned startup banner: figlet-style "DSH" brand title in
 * brand-blue gradient, the DeepSeek whale art, and a bordered panel carrying
 * session meta + stats (model / mode / skills / plugins / version).
 *
 * @module dsh-tui-app/components/splash
 */
import React from "react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Box, Text } from "ink";
import { h } from "../runtime/jsx.js";
import { paint, pad } from "../theme/palette.js";
import { shortId } from "../util/format.js";

const WHALE = readFileSync(
  fileURLToPath(new URL("../assets/whale-blue-ascii.txt", import.meta.url)),
  "utf8"
).replace(/\n+$/, "");

/** Figlet-style "DSH" in brand-blue gradient (top rows lighter). */
const DSH_TITLE = [
  ["██████╗", "███████╗", "██╗  ██╗"],
  ["██╔══██╗", "██╔════╝", "██║  ██║"],
  ["██║  ██║", "███████╗", "███████║"],
  ["██║  ██║", "╚════██║", "██╔══██║"],
  ["██████╔╝", "███████║", "██║  ██║"],
  ["╚═════╝", "╚══════╝", "╚═╝  ╚═╝"],
];
const TITLE_COLORS = ["110;140;255", "77;107;254", "30;58;138"]; // light -> deep blue

/** Aligned key-value row: `  key     value` with accent bold key. */
function Row({ k, v, color }) {
  return h(
    Text,
    null,
    `  ${paint(pad(k, 10), "accent-bold")}${paint(v, color ?? "bold")}`
  );
}

export default function Splash({ meta }) {
  if (!meta) return null;
  const resumed = meta.resumed ? paint("(resumed)", "warning") : "";
  const statsLine = [
    meta.skills !== undefined ? `skills ${meta.skills}` : null,
    meta.plugins !== undefined ? `plugins ${meta.plugins}` : null,
    meta.version ? `v${meta.version}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return h(
    Box,
    { flexDirection: "column", marginBottom: 1 },
    DSH_TITLE.map((row, i) =>
      h(
        Text,
        { key: `t${i}`, bold: true, color: `#${TITLE_COLORS[Math.min(i, 2)]}` },
        row.join(" ")
      )
    ),
    h(Text, null, WHALE),
    h(
      Box,
      {
        flexDirection: "column",
        borderStyle: "round",
        borderColor: "#4D6BFE",
        paddingX: 1,
        marginTop: 1,
      },
      h(Text, { bold: true, color: "#4D6BFE" }, ` DeepSeek Harness `),
      h(Text, { dimColor: true }, " ─────────────────────────────────────────────"),
      h(Row, { k: "model", v: `${meta.model}${resumed ? ` ${resumed}` : ""}` }),
      meta.mode ? h(Row, { k: "mode", v: meta.mode }) : null,
      h(Row, { k: "session", v: shortId(meta.sessionId) }),
      h(Row, { k: "workspace", v: meta.cwd }),
      statsLine !== "" ? h(Row, { k: "stats", v: statsLine }) : null,
      h(Text, { dimColor: true }, " ─────────────────────────────────────────────"),
      h(
        Text,
        { dimColor: true },
        `  ${paint("resume:", "dim")} dsh --profile tui --resume ${meta.sessionId}`
      ),
      h(
        Text,
        null,
        `  ${paint("/help", "accent")} 命令 · ${paint("/config", "accent")} 显示开关 · ${paint("/quit", "accent")} 退出`
      )
    )
  );
}
