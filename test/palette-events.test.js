import { test } from "node:test";
import assert from "node:assert/strict";
import { paint, visibleLength, pad, BRAND } from "../lib/theme/palette.js";
import { createChannel, textOf, previewArgs, previewResult } from "../lib/channel/events.js";

test("palette: paint wraps text in role SGR", () => {
  assert.equal(paint("x", "accent"), `\u001b[38;2;${BRAND.join(";")}mx\u001b[0m`);
  assert.equal(paint("x", "error"), "\u001b[31mx\u001b[0m");
  assert.equal(paint("x", "nope"), "\u001b[2mx\u001b[0m"); // unknown role -> dim
});

test("palette: visibleLength strips ANSI", () => {
  assert.equal(visibleLength(paint("你好", "accent")), 2);
});

test("palette: pad aligns by visible width", () => {
  assert.equal(pad(paint("ab", "dim"), 5).length, 5 + "\u001b[2m\u001b[0m".length);
});

test("channel: user message with source user emits user event", () => {
  const out = [];
  const agent = { ctx: { on: () => () => {} } };
  const ch = createChannel(agent, (e) => out.push(e));
  ch.onEvent({
    type: "user/message",
    data: { source: { kind: "user" }, content: [{ type: "text", text: "hi" }] },
  });
  assert.deepEqual(out, [{ kind: "user", text: "hi" }]);
});

test("channel: agent-sourced user/message is ignored", () => {
  const out = [];
  const agent = { ctx: { on: () => () => {} } };
  const ch = createChannel(agent, (e) => out.push(e));
  ch.onEvent({
    type: "user/message",
    data: { source: { kind: "tool" }, content: [{ type: "text", text: "x" }] },
  });
  assert.equal(out.length, 0);
});

test("channel: assistant deltas split text vs reasoning", () => {
  const out = [];
  const agent = { ctx: { on: () => () => {} } };
  const ch = createChannel(agent, (e) => out.push(e));
  ch.onEvent({ type: "assistant/chunk", data: { chunk: { type: "text-delta", text: "a" } } });
  ch.onEvent({ type: "assistant/chunk", data: { chunk: { type: "reasoning-delta", text: "r" } } });
  assert.deepEqual(out, [
    { kind: "assistant-delta", text: "a" },
    { kind: "assistant-delta", reasoning: "r" },
  ]);
});

test("channel: tool start/end pairs by callId with name lookup", () => {
  const out = [];
  const agent = { ctx: { on: () => () => {} } };
  const ch = createChannel(agent, (e) => out.push(e));
  ch.onEvent({ type: "tool/call", data: { callId: "c1", name: "bash", arguments: '{"command":"ls"}' } });
  ch.onEvent({
    type: "tool/result",
    data: { message: { content: [{ toolCallId: "c1" }] }, error: { code: "E1", message: "boom" } },
  });
  assert.deepEqual(out, [
    { kind: "tool-start", id: "c1", name: "bash", args: '{"command":"ls"}' },
    { kind: "tool-end", id: "c1", name: "bash", ok: false, preview: "E1: boom" },
  ]);
});

test("channel: turn/end error maps to error notice", () => {
  const out = [];
  const agent = { ctx: { on: () => () => {} } };
  const ch = createChannel(agent, (e) => out.push(e));
  ch.onEvent({ type: "turn/end", data: { reason: { kind: "error", error: { code: "X", message: "y" } } } });
  assert.deepEqual(out, [
    { kind: "turn-end" },
    { kind: "notice", tone: "error", text: "turn failed: X: y" },
  ]);
});

test("channel: detach returns the subscription teardown", () => {
  let detached = false;
  const agent = { ctx: { on: () => () => { detached = true; } } };
  const ch = createChannel(agent, () => {});
  ch.detach();
  assert.equal(detached, true);
});

test("helpers: textOf / previewArgs / previewResult", () => {
  assert.equal(textOf([{ type: "text", text: "a" }, { type: "x" }, { type: "text", text: "b" }]), "ab");
  assert.equal(previewArgs('  {"a":1}  '), '{"a":1}');
  assert.equal(previewResult([{ type: "tool-result", content: "ok" }]), "ok");
});
