import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { Input } from "../lib/runtime/input.js";

function makeInput(opts = {}) {
  const stdin = new PassThrough();
  stdin.isTTY = true;
  stdin.setRawMode = () => stdin; // PassThrough has no setRawMode
  const calls = { change: [], submit: [], interrupt: 0, quit: 0, suggestion: 0, fold: 0 };
  const input = new Input(stdin, {
    onChange: (s) => calls.change.push(s),
    onSubmit: (t) => calls.submit.push(t),
    onInterrupt: () => calls.interrupt++,
    onQuit: () => calls.quit++,
    onSuggestion: () => calls.suggestion++,
    onCycleFold: () => calls.fold++,
    ...opts,
  });
  return { stdin, input, calls };
}

test("input: typing inserts at cursor and emits changes", () => {
  const { stdin, input, calls } = makeInput();
  stdin.write("hi");
  assert.equal(input.buffer, "hi");
  assert.equal(input.cursor, 2);
  assert.deepEqual(calls.change.at(-1), { buffer: "hi", cursor: 2, vim: false });
});

test("input: enter submits and clears buffer", () => {
  const { stdin, input, calls } = makeInput();
  stdin.write("你好");
  stdin.write("\n");
  assert.deepEqual(calls.submit, ["你好"]);
  assert.equal(input.buffer, "");
});

test("input: backspace edits", () => {
  const { stdin, input } = makeInput();
  stdin.write("ab");
  stdin.write("\x7f");
  assert.equal(input.buffer, "a");
  assert.equal(input.cursor, 1);
});

test("input: arrow keys move cursor without inserting", () => {
  const { stdin, input } = makeInput();
  stdin.write("abc");
  stdin.write("\u001b[D"); // left
  assert.equal(input.cursor, 2);
  stdin.write("X");
  assert.equal(input.buffer, "abXc");
  stdin.write("\u001b[C"); // right
  assert.equal(input.cursor, 4);
});

test("input: ctrl+c while idle quits; while busy interrupts", () => {
  const { stdin, input, calls } = makeInput();
  stdin.write("\u0003");
  assert.equal(calls.quit, 1);
  const { stdin: s2, input: i2, calls: c2 } = makeInput();
  i2.setBusy(true);
  s2.write("\u0003");
  assert.equal(c2.interrupt, 1);
  assert.equal(c2.quit, 0);
});

test("input: busy allows typing, ctrl+c interrupts (submit gating moved to index)", () => {
  const { stdin, input, calls } = makeInput();
  input.setBusy(true);
  stdin.write("abc");
  assert.equal(input.buffer, "abc");
  stdin.write("\u0003");
  assert.equal(calls.interrupt, 1);
  assert.equal(calls.quit, 0);
  // typing still lands while busy; enter submits (caller decides what to do)
  stdin.write("\n");
  assert.deepEqual(calls.submit, ["abc"]);
});

test("input: bracketed paste inserts whole content at cursor", () => {
  const { stdin, input } = makeInput();
  stdin.write("\u001b[200~hello world\u001b[201~");
  assert.equal(input.buffer, "hello world");
  assert.equal(input.cursor, 11);
});

test("input: shift+enter inserts newline (multi-line)", () => {
  const { stdin, input, calls } = makeInput();
  stdin.write("a\u001b[13;2ub");
  assert.equal(input.buffer, "a\nb");
  stdin.write("\n");
  assert.deepEqual(calls.submit, ["a\nb"]);
});

test("input: vim mode — esc toggles, h/l/x/i work", () => {
  const { stdin, input } = makeInput();
  stdin.write("hello");
  stdin.write("\u001b"); // normal mode
  assert.equal(input.vim, true);
  stdin.write("h"); // move left
  assert.equal(input.cursor, 4);
  stdin.write("x"); // delete char
  assert.equal(input.buffer, "hell");
  stdin.write("0"); // line start
  assert.equal(input.cursor, 0);
  stdin.write("i"); // insert mode
  assert.equal(input.vim, false);
  stdin.write("X");
  assert.equal(input.buffer, "Xhell");
});

test("input: tab triggers suggestion callback; ctrl+o triggers fold", () => {
  const { stdin, calls } = makeInput();
  stdin.write("\t");
  assert.equal(calls.suggestion, 1);
  stdin.write("\u000f");
  assert.equal(calls.fold, 1);
});

test("input: ctrl+d on empty line quits, on text does nothing", () => {
  const { stdin, input, calls } = makeInput();
  stdin.write("\u0004");
  assert.equal(calls.quit, 1);
  const { stdin: s2, input: i2, calls: c2 } = makeInput();
  s2.write("a");
  s2.write("\u0004");
  assert.equal(c2.quit, 0);
  assert.equal(i2.buffer, "a");
});
