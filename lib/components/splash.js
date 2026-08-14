/**
 * Splash — the DeepSeek whale banner shown at every startup, with
 * Hermes-style formatted session meta: aligned label column, accent brand
 * line, separator rules, and a dedicated resume hint line (full session id
 * stays copyable instead of wrapping the meta block).
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

const RULE = "─".repeat(46);

/**
 * Whale spout lines above the art: height follows the token rate.
 * tps 0      -> idle single droplet, slow pulse
 * tps < 150  -> 2 rows
 * tps >= 150 -> 3 rows, faster droplets
 */
function spoutLines(anim) {
  const tps = anim?.tps ?? 0;
  const tick = anim?.tick ?? 0;
  if (tps <= 0) {
    // idle pulse every ~2.5s (tick % 6 === 0)
    return tick % 6 === 0 ? [paint("  °", "accent")] : [];
  }
  const rows = tps >= 150 ? 3 : 2;
  const out = [];
  for (let i = 0; i < rows; i++) {
    const drift = (tick + i) % 3;
    const droplet = i === rows - 1 ? "·" : "°";
    out.push(paint(`  ${" ".repeat(drift)}${droplet}`, "accent"));
  }
  return out;
}

/** Aligned key-value row: `  key     value` with accent bold key. */
function Row({ k, v, color }) {
  return h(
    Text,
    null,
    `  ${paint(pad(k, 10), "accent-bold")}${paint(v, color ?? "bold")}`
  );
}

export default function Splash({ meta, anim }) {
  if (!meta) return null;
  const resumed = meta.resumed ? paint("(resumed)", "warning") : "";
  const spout = spoutLines(anim);
  return h(
    Box,
    { flexDirection: "column", marginBottom: 1 },
    ...spout.map((line, i) => h(Text, { key: `s${i}` }, line)),
    h(Text, null, WHALE),
    h(Text, { bold: true, color: "#4D6BFE" }, `── ${paint("DeepSeek Harness", "accent-bold")} ──`),
    h(Text, { dimColor: true }, ` ${RULE}`),
    h(Row, { k: "model", v: `${meta.model}${resumed ? ` ${resumed}` : ""}` }),
    h(Row, { k: "session", v: shortId(meta.sessionId) }),
    h(Row, { k: "workspace", v: meta.cwd }),
    h(Text, { dimColor: true }, ` ${RULE}`),
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
  );
}
