/**
 * Lightweight markdown renderer for assistant replies — no dependencies.
 * Token-based (NO ANSI inside Text children — Ink escapes embedded escapes
 * into literal text, which produced 【1m】 garbage). Inline styles are
 * expressed as nested <Text> with props; blocks are plain <Text> rows.
 *
 * @module dsh-tui-app/lib/markdown
 */
import React from "react";
import { Text } from "ink";
import { h } from "./runtime/jsx.js";

/**
 * Parse inline markdown into style tokens.
 * @returns [{ t: 'plain'|'bold'|'italic'|'code'|'link'|'strike', text, url? }]
 */
export function inlineTokens(md) {
  const tokens = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(\[[^\]]+\]\([^)]+\))|(~~[^~]+~~)/g;
  let last = 0;
  let m;
  while ((m = re.exec(md)) !== null) {
    if (m.index > last) tokens.push({ t: "plain", text: md.slice(last, m.index) });
    if (m[1]) tokens.push({ t: "code", text: m[1].slice(1, -1) });
    else if (m[2]) tokens.push({ t: "bold", text: m[2].slice(2, -2) });
    else if (m[3]) tokens.push({ t: "italic", text: m[3].slice(1, -1) });
    else if (m[4]) {
      const inner = m[4].match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      tokens.push({ t: "link", text: inner?.[1] ?? m[4], url: inner?.[2] });
    } else if (m[5]) tokens.push({ t: "strike", text: m[5].slice(2, -2) });
    last = re.lastIndex;
  }
  if (last < md.length) tokens.push({ t: "plain", text: md.slice(last) });
  return tokens;
}

/** Render inline tokens as nested Ink <Text> elements. */
export function renderInline(tokens) {
  return tokens.map((tok, i) => {
    switch (tok.t) {
      case "bold":
        return h(Text, { key: i, bold: true }, tok.text);
      case "italic":
        return h(Text, { key: i, italic: true, dimColor: true }, tok.text);
      case "code":
        return h(Text, { key: i, color: "#d9a066" }, tok.text);
      case "link":
        return h(
          Text,
          { key: i },
          h(Text, { color: "#4D6BFE" }, tok.text),
          h(Text, { dimColor: true }, ` (${tok.url})`)
        );
      case "strike":
        return h(Text, { key: i, dimColor: true }, tok.text);
      default:
        return h(Text, { key: i }, tok.text);
    }
  });
}

/** Block-level parse -> array of Ink elements (text rows, no embedded ANSI). */
export function renderMarkdown(md) {
  if (!md) return [];
  const lines = md.split("\n");
  const out = [];
  let i = 0;
  let codeBuf = [];
  let listBuf = [];

  const flushCode = (key) => {
    if (codeBuf.length === 0) return;
    out.push(
      h(
        Text,
        { key, color: "#d9a066" },
        codeBuf.map((l) => `  ${l}`).join("\n")
      )
    );
    codeBuf = [];
  };
  const flushList = (key) => {
    if (listBuf.length === 0) return;
    out.push(
      h(
        Text,
        { key },
        listBuf.map(([n, text]) => `  ${n === null ? "•" : `${n}.`} ${renderInline(inlineTokens(text))}`).map((el, idx) => h(Text, { key: `${key}-${idx}` }, el))
      )
    );
    listBuf = [];
  };

  while (i < lines.length) {
    const line = lines[i];
    const key = `b${out.length}`;
    if (/^```/.test(line.trim())) {
      flushList(`l${out.length}`);
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        codeBuf.push(lines[i]);
        i += 1;
      }
      i += 1;
      flushCode(key);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flushList(`l${out.length}`);
      out.push(h(Text, { key, dimColor: true }, " ───────────────────────────────"));
      i += 1;
      continue;
    }
    const hm = line.match(/^(#{1,4})\s+(.*)$/);
    if (hm) {
      flushList(`l${out.length}`);
      out.push(
        h(Text, { key, bold: true, color: "#4D6BFE" }, renderInline(inlineTokens(hm[2])))
      );
      i += 1;
      continue;
    }
    const qm = line.match(/^>\s?(.*)$/);
    if (qm) {
      flushList(`l${out.length}`);
      out.push(
        h(Text, { key, dimColor: true }, "│ ", renderInline(inlineTokens(qm[1])))
      );
      i += 1;
      continue;
    }
    const um = line.match(/^\s*[-*+]\s+(.*)$/);
    if (um) {
      listBuf.push([null, um[1]]);
      i += 1;
      continue;
    }
    const om = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (om) {
      listBuf.push([parseInt(om[1], 10), om[2]]);
      i += 1;
      continue;
    }
    flushList(`l${out.length}`);
    out.push(h(Text, { key, wrap: "wrap" }, renderInline(inlineTokens(line))));
    i += 1;
  }
  flushList(`l${out.length}`);
  return out;
}
