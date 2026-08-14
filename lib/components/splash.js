/**
 * Splash — the DeepSeek whale banner shown at every startup.
 * Art: official favicon path rendered to half-block chars in brand blue
 * (assets/whale-blue-ascii.txt, 72x27). Followed by brand line + meta rows.
 *
 * @module dsh-tui-app/components/splash
 */
import React from "react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Box, Text } from "ink";
import { h } from "../runtime/jsx.js";
import { paint } from "../theme/palette.js";

const WHALE = readFileSync(
  fileURLToPath(new URL("../assets/whale-blue-ascii.txt", import.meta.url)),
  "utf8"
).replace(/\n+$/, "");

export default function Splash({ meta }) {
  if (!meta) return null;
  const resumed = meta.resumed ? paint(" (resumed)", "warning") : "";
  return h(
    Box,
    { flexDirection: "column", marginBottom: 1 },
    h(Text, null, WHALE),
    h(Text, { bold: true, color: "#4D6BFE" }, `── DeepSeek Harness ──`),
    h(
      Text,
      null,
      `  model     ${meta.model} (${meta.provider})${resumed}`
    ),
    h(
      Text,
      null,
      `  session   ${meta.sessionId}   ${paint("resume with:", "dim")} dsh --profile tui --resume ${meta.sessionId}`
    ),
    h(Text, null, `  workspace ${meta.cwd}`),
    h(
      Text,
      { dimColor: true },
      `type ${paint("/help", "accent")} for commands, ${paint("/quit", "accent")} to exit`
    )
  );
}
