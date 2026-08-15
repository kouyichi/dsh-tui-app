/**
 * MessageStream — renders the normalized event log as a transcript:
 * user messages, assistant text (streamed deltas accumulate into the last
 * assistant message), tool cards, and notices. Ctrl+O cycles fold state:
 * collapsed -> expanded -> hidden (per-turn tool cards collapse to header).
 *
 * @module dsh-tui-app/components/message-stream
 */
import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { h } from "../runtime/jsx.js";
import { paint } from "../theme/palette.js";
import { ToolCard } from "./tool-card.js";

/** Group raw events into transcript entries (user/assistant/tool/notice). */
export function buildTranscript(events) {
  const out = [];
  let assistant = null; // accumulating streamed assistant message
  for (const ev of events) {
    switch (ev.kind) {
      case "user":
        out.push({ key: `u${out.length}`, type: "user", text: ev.text });
        assistant = null;
        break;
      case "assistant-delta": {
        if (!assistant) {
          assistant = { key: `a${out.length}`, type: "assistant", text: "", reasoning: "" };
          out.push(assistant);
        }
        if (ev.text) assistant.text += ev.text;
        if (ev.reasoning) assistant.reasoning += ev.reasoning;
        break;
      }
      case "assistant": {
        // Non-streamed final message: the streamed deltas already rendered
        // this step's text — only fill in when nothing was streamed yet.
        if (assistant && !assistant.text && !assistant.reasoning) {
          assistant.text = ev.text;
        } else if (!assistant) {
          assistant = { key: `a${out.length}`, type: "assistant", text: ev.text, reasoning: "" };
          out.push(assistant);
        }
        // else: delta already covered it — drop the duplicate.
        break;
      }
      case "tool-start":
        out.push({
          key: `t${ev.id}`,
          type: "tool",
          id: ev.id,
          name: ev.name,
          args: ev.args,
          ok: undefined,
          preview: "",
        });
        assistant = null;
        break;
      case "tool-end": {
        const card = out.find((e) => e.type === "tool" && e.id === ev.id);
        if (card) {
          card.ok = ev.ok;
          card.preview = ev.preview;
        }
        break;
      }
      case "notice":
        out.push({ key: `n${out.length}`, type: "notice", tone: ev.tone, text: ev.text });
        assistant = null;
        break;
      case "a2a":
        out.push({
          key: `a2a${out.length}`,
          type: "a2a",
          name: ev.name,
          text: ev.text,
          result: ev.result,
          ok: ev.ok,
          ms: ev.ms,
        });
        assistant = null;
        break;
      default:
        break;
    }
  }
  return out;
}

export default function MessageStream({ events, fold, ctl }) {
  const transcript = useMemo(() => buildTranscript(events), [events]);

  return h(
    Box,
    { flexDirection: "column" },
    transcript.map((entry) => {
      if (entry.type === "user") {
        return h(
          Box,
          { key: entry.key, flexDirection: "row" },
          h(Text, null, paint("❯ ", "accent")),
          h(Text, { wrap: "wrap" }, entry.text)
        );
      }
      if (entry.type === "assistant") {
        const thinking = entry.reasoning ?? "";
        const text = entry.text ?? "";
        const showThinking = thinking !== "" && fold !== "hidden";
        return h(
          Box,
          { key: entry.key, flexDirection: "column", marginLeft: 1 },
          showThinking
            ? h(
                Box,
                { flexDirection: "column" },
                h(Text, { dimColor: true }, paint(`🤔 思考${fold === "expanded" ? "" : "（Ctrl+O 展开）"}`, "dim")),
                fold === "expanded" ? h(Text, { dimColor: true, wrap: "wrap" }, `│ ${thinking.slice(0, 600)}${thinking.length > 600 ? "…" : ""}`) : null
              )
            : null,
          text !== ""
            ? h(
                Box,
                { flexDirection: "column", marginTop: showThinking ? 1 : 0 },
                h(Text, { wrap: "wrap" }, text)
              )
            : !showThinking
              ? h(Text, { dimColor: true }, "(thinking…)")
              : null
        );
      }
      if (entry.type === "tool") {
        return h(ToolCard, {
          key: entry.key,
          name: entry.name,
          args: entry.args,
          ok: entry.ok,
          preview: entry.preview,
          fold,
        });
      }
      if (entry.type === "notice") {
        const color = entry.tone === "error" ? "red" : entry.tone === "warning" ? "yellow" : undefined;
        const role = entry.tone === "error" ? "error" : entry.tone === "warning" ? "warning" : "dim";
        return h(
          Text,
          { key: entry.key, color },
          paint(`⚠ ${entry.text}`, role)
        );
      }
      if (entry.type === "a2a") {
        const head =
          paint(`A2A @${entry.name}`, "accent-bold") +
          (entry.ok ? paint(`  ✓ ${(entry.ms / 1000).toFixed(1)}s`, "success") : paint("  ✗", "error"));
        const body =
          fold === "hidden"
            ? null
            : h(Text, { key: "body", wrap: "wrap", dimColor: true }, `  ${entry.result.slice(0, 500)}`);
        return h(
          Box,
          { key: entry.key, flexDirection: "column", marginLeft: 1 },
          h(Text, null, head),
          h(Text, { wrap: "wrap" }, `  ${entry.text.slice(0, 80)}`),
          body
        );
      }
      return null;
    })
  );
}
