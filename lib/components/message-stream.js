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
        const body = entry.text === "" ? paint("(thinking…)", "dim") : entry.text;
        return h(
          Box,
          { key: entry.key, flexDirection: "column", marginLeft: 1 },
          entry.reasoning !== "" ? h(Text, { dimColor: true }, entry.reasoning) : null,
          h(Text, { wrap: "wrap" }, body)
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
      // notice
      const color = entry.tone === "error" ? "red" : entry.tone === "warning" ? "yellow" : undefined;
      const role = entry.tone === "error" ? "error" : entry.tone === "warning" ? "warning" : "dim";
      return h(
        Text,
        { key: entry.key, color },
        paint(`⚠ ${entry.text}`, role)
      );
    })
  );
}
