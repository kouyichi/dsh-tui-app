/**
 * Lightweight markdown renderer for assistant replies — no dependencies.
 * Block-level: headings, lists, ordered lists, blockquotes, fenced code,
 * horizontal rules, paragraphs. Inline: **bold**, *italic*, `code`,
 * [text](url), ~~strikethrough~~. Output is Ink elements (Text with ANSI).
 *
 * @module dsh-tui-app/lib/markdown
 */
import React from "react";
import { Text } from "ink";
import { h } from "./runtime/jsx.js";
import { paint } from "./theme/palette.js";

/** Inline markdown -> ANSI string. Simple ordered regex passes. */
export function inline(md) {
  let s = md;
  // code first (protect from other rules)
  s = s.replace(/`([^`]+)`/g, (_m, c) => paint(c, "warning"));
  s = s.replace(/\*\*([^*]+)\*\*/g, (_m, b) => paint(b, "bold"));
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, (_m, pre, i) => `${pre}${paint(i, "2;3")}`);
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t, u) => `${paint(t, "accent")}${paint(` (${u})`, "dim")}`);
  s = s.replace(/~~([^~]+)~~/g, (_m, d) => paint(d, "2"));
  return s;
}

/** Block-level parse -> array of Ink elements. */
export function renderMarkdown(md) {
  if (!md) return [];
  const lines = md.split("\n");
  const out = [];
  let i = 0;
  let codeBuf = [];
  let listBuf = [];
  let ordered = null; // null | current number

  const flushCode = (key) => {
    if (codeBuf.length === 0) return;
    out.push(
      h(
        Text,
        { key, dimColor: true },
        codeBuf.map((l) => `  ${l}`).join("\n")
      )
    );
    codeBuf = [];
  };
  const flushList = (key) => {
    if (listBuf.length === 0) return;
    const prefix = (n) => (n === null ? "•" : `${n}.`);
    out.push(
      h(
        Text,
        { key },
        listBuf.map(([n, text]) => `  ${prefix(n)} ${inline(text)}`).join("\n")
      )
    );
    listBuf = [];
  };

  while (i < lines.length) {
    const line = lines[i];
    const key = `b${out.length}`;
    // fenced code
    if (/^```/.test(line.trim())) {
      flushList(`l${out.length}`);
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        codeBuf.push(lines[i]);
        i += 1;
      }
      i += 1; // closing fence
      flushCode(key);
      continue;
    }
    // horizontal rule
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flushList(`l${out.length}`);
      out.push(h(Text, { key, dimColor: true }, " ───────────────────────────────"));
      i += 1;
      continue;
    }
    // heading
    const hm = line.match(/^(#{1,4})\s+(.*)$/);
    if (hm) {
      flushList(`l${out.length}`);
      out.push(h(Text, { key, bold: true, color: "#4D6BFE" }, ` ${inline(hm[2])}`));
      i += 1;
      continue;
    }
    // blockquote
    const qm = line.match(/^>\s?(.*)$/);
    if (qm) {
      flushList(`l${out.length}`);
      out.push(h(Text, { key, dimColor: true }, `│ ${inline(qm[1])}`));
      i += 1;
      continue;
    }
    // unordered list
    const um = line.match(/^\s*[-*+]\s+(.*)$/);
    if (um) {
      listBuf.push([null, um[1]]);
      i += 1;
      continue;
    }
    // ordered list
    const om = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (om) {
      listBuf.push([parseInt(om[1], 10), om[2]]);
      i += 1;
      continue;
    }
    // paragraph
    flushList(`l${out.length}`);
    out.push(h(Text, { key, wrap: "wrap" }, inline(line)));
    i += 1;
  }
  flushList(`l${out.length}`);
  return out;
}
