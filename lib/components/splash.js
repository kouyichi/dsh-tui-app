/**
 * Splash — the DeepSeek whale banner shown at every startup, Hermes-style:
 * a bordered panel carrying the brand title and aligned session meta
 * (accent label column), with the whale art above it. Static — no animation.
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
  return h(
    Box,
    { flexDirection: "column", marginBottom: 1 },
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
      h(Row, { k: "session", v: shortId(meta.sessionId) }),
      h(Row, { k: "workspace", v: meta.cwd }),
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
