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
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(\[[^\]]+\]\([^)]+\))|(~~[^~]+~~)|(https?:\/\/[^\s)]+)/g;
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
    else if (m[6]) tokens.push({ t: "link", text: m[6], url: m[6] }); // bare URL
    last = re.lastIndex;
  }
  if (last < md.length) tokens.push({ t: "plain", text: md.slice(last) });
  return tokens;
}

/**
 * Keep the complete literal URL visible so terminal URL detection can copy
 * and open it. A Markdown label is useful context, but must not replace href.
 */
export function linkDisplayText(text, url) {
  const label = String(text ?? "").trim();
  const href = String(url ?? "").trim();
  if (!href) return label;
  if (!label || label === href) return href;
  return `${label} — ${href}`;
}

/** Wrap visible text in a safe OSC 8 terminal hyperlink. */
export function terminalHyperlink(text, url) {
  const display = String(text ?? "");
  const href = String(url ?? "").trim();
  if (!href || /[\u0000-\u001f\u007f]/.test(href)) return display;
  try {
    const parsed = new URL(href);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return display;
  } catch {
    return display;
  }
  return `\u001b]8;;${href}\u001b\\${display}\u001b]8;;\u001b\\`;
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
          { key: i, color: "#4D6BFE" },
          terminalHyperlink(linkDisplayText(tok.text, tok.url), tok.url)
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
        listBuf.map(([n, text], idx) => {
          const prefix = `  ${n === null ? "•" : `${n}.`} `;
          // renderInline returns element array — must be passed as children,
          // never interpolated into a string (that yields "[object Object]").
          return h(Text, { key: `${key}-${idx}` }, prefix, ...renderInline(inlineTokens(text)));
        })
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
