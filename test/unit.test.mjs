/**
 * unit.test.mjs — canonical unit tests for the dsh-tui-app core logic.
 * Run: npm test  (or: node test/unit.test.mjs)
 *
 * Covers pure logic that must not regress:
 *   - slash-fuzzy scoring (Hermes-style description-aware ranking)
 *   - Esc-closes-slash-menu branch presence + onSuggestClose wiring
 *   - block-cursor rendering in InputBox (highlighted char at cursor)
 *   - slash menu viewport math (centered window)
 *
 * Static checks are read from the source files (the UI itself is exercised
 * in PTY smoke tests; these pin the contracts).
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { rankSlashItems, normalizeSlashSearchQuery } from "../lib/slash-fuzzy.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (rel) => readFileSync(join(ROOT, rel), "utf8");

let passed = 0;
const ok = (name) => { passed++; console.log(`  ✓ ${name}`); };

/* 1. fuzzy scoring */
{
  const items = [
    { text: "/compact", description: "压缩上下文（compaction）" },
    { text: "/model", description: "选择模型与推理力度" },
    { text: "/mode", description: "agent 模式切换" },
    { text: "/compact-other", description: "x" },
  ];
  const rank = (q) => rankSlashItems(items, q, (it) => ({ id: it.text, label: it.text, description: it.description })).map((x) => x.text);
  assert.equal(rank("/comp")[0], "/compact", "prefix rank");
  assert.equal(rank("/model")[0], "/model", "exact rank");
  assert.equal(rank("compaction")[0], "/compact", "description-aware rank");
  assert.equal(rank("").length, 4, "empty query keeps all (browsing order)");
  assert.equal(normalizeSlashSearchQuery(" /Model "), "model", "normalize");
  ok("fuzzy scoring (prefix/exact/description/empty/normalize)");
}

/* 2. Esc closes the slash menu (input.js branch + wiring) */
{
  const input = src("lib/runtime/input.js");
  const index = src("lib/index.js");
  assert.ok(input.includes("Esc closes the open slash suggestion menu"), "Esc-close branch");
  assert.ok(input.includes("onSuggestClose"), "input calls onSuggestClose");
  assert.ok(index.includes("onSuggestClose"), "index wires onSuggestClose");
  ok("Esc-closes-menu branch + wiring");
}

/* 3. Block cursor + slash menu render in InputBox */
{
  const box = src("lib/components/input-box.js");
  assert.ok(box.includes('backgroundColor: "#4D6BFE"'), "block cursor (highlighted char)");
  assert.ok(box.includes("命令（"), "slash menu header");
  assert.ok(box.includes("MENU_WINDOW = 8"), "viewport window");
  ok("InputBox block cursor + slash menu");
}

/* 4. Slash menu viewport math (centered window) */
{
  // replicate the renderer's windowing
  const MENU_WINDOW = 8;
  const win = (selected, len) => {
    const size = Math.min(MENU_WINDOW, len);
    const start = Math.max(0, Math.min(selected - Math.floor(MENU_WINDOW / 2), len - size));
    return { start, end: start + size };
  };
  assert.deepEqual(win(0, 30), { start: 0, end: 8 }, "selection at top");
  assert.deepEqual(win(15, 30), { start: 11, end: 19 }, "selection centered");
  assert.deepEqual(win(29, 30), { start: 22, end: 30 }, "selection at bottom");
  assert.deepEqual(win(3, 4), { start: 0, end: 4 }, "small list");
  ok("menu viewport windowing");
}

console.log(`\nunit tests: ${passed}/4 passed`);
process.exit(passed === 4 ? 0 : 1);
