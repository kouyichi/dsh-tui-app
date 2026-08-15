/**
 * Splash — Hermes-aligned startup banner: figlet "DSH" brand title + bordered
 * info panel on the LEFT, the DeepSeek whale art on the RIGHT (side-by-side,
 * like Hermes' logo+text layout).
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
  ]
    .filter(Boolean)
    .join(" · ");

  const left = h(
    Box,
    { flexDirection: "column" },
    DSH_TITLE.map((row, i) =>
      h(
        Text,
        { key: `t${i}`, bold: true, color: `#${TITLE_COLORS[Math.min(i, 2)]}` },
        row.join(" ")
      )
    ),
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
      h(Text, { dimColor: true }, " ─────────────────────────────"),
      h(Row, { k: "model", v: `${meta.model}${resumed ? ` ${resumed}` : ""}` }),
      meta.mode ? h(Row, { k: "mode", v: meta.mode }) : null,
      h(Row, { k: "session", v: shortId(meta.sessionId) }),
      h(Row, { k: "workspace", v: meta.cwd }),
      statsLine !== "" ? h(Row, { k: "stats", v: statsLine }) : null,
      h(Text, { dimColor: true }, " ─────────────────────────────"),
      h(
        Text,
        { dimColor: true },
        `  ${paint("resume:", "dim")} dsh --profile tui --resume ${meta.sessionId}`
      ),
      h(
        Text,
        null,
        `  ${paint("/help", "accent")} · ${paint("/config", "accent")} · ${paint("/quit", "accent")}`
      )
    )
  );

  const right = h(Text, null, WHALE);

  return h(Box, { flexDirection: "row", marginBottom: 1 }, left, h(Text, null, "   "), right);
}
