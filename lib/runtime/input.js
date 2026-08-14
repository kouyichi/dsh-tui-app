/**
 * dsh-tui runtime input — event-driven raw-mode line editor.
 *
 * Unlike the v1 Input (pull-based nextLine), this one pushes state changes
 * to React via callbacks, so the input line renders live under Ink:
 *   onChange({buffer, cursor})  every edit
 *   onSubmit(text)              Enter on a non-empty buffer
 *   onInterrupt()               Ctrl+C while the agent is busy
 *   onQuit()                    Ctrl+C idle / Ctrl+D on empty line / EOF
 *
 * Features: multi-line (\n via shift+enter or ctrl+j), bracketed paste,
 * minimal vim mode (esc toggles; h/j/k/l/0/$/x/i/a/enter), IME-friendly
 * (committed composition characters arrive as plain bytes and are inserted;
 * the terminal draws its own composition popup at the cursor).
 * Non-TTY stdin falls back to plain readline lines.
 *
 * @module dsh-tui-app/runtime/input
 */

import readline from "node:readline";

const KEY = {
  ENTER: 0x0d,
  LINEFEED: 0x0a,
  CTRL_C: 0x03,
  CTRL_D: 0x04,
  CTRL_J: 0x0a,
  BACKSPACE: 0x7f,
  DEL: 0x08,
  ESC: 0x1b,
  TAB: 0x09,
};

const PASTE_START = "\u001b[200~";
const PASTE_END = "\u001b[201~";
const SHIFT_ENTER = "\u001b[13;2u";

export class Input {
  /**
   * @param stdin - process.stdin (or a stream)
   * @param opts - { onChange, onSubmit, onInterrupt, onQuit, onSuggestion }
   */
  constructor(stdin, opts = {}) {
    this.stdin = stdin;
    this.opts = opts;
    this.tty = stdin.isTTY === true;
    this.buffer = "";
    this.cursor = 0;
    this.busy = false;
    this.vim = false;
    this.pasting = "";
    this.pasteBuffer = "";
    this.quit = false;
    this.rl = null;

    if (this.tty) {
      this.onDataBound = (chunk) => this.onData(chunk);
      this.onEndBound = () => this.opts.onQuit?.();
      stdin.setRawMode(true);
      stdin.setEncoding("utf8");
      stdin.on("data", this.onDataBound);
      stdin.on("end", this.onEndBound);
      stdin.resume();
    } else {
      this.rl = readline.createInterface({ input: stdin, terminal: false, crlfDelay: Infinity });
      this.rl.on("line", (line) => {
        if (line === "") this.opts.onQuit?.();
        else this.opts.onSubmit?.(line);
      });
      this.rl.on("close", () => this.opts.onQuit?.());
    }
  }

  setBusy(busy) {
    this.busy = busy;
  }

  /** Replace the whole buffer (e.g. from a suggestion accept). */
  setBuffer(text, cursor = text.length) {
    this.buffer = text;
    this.cursor = Math.max(0, Math.min(cursor, text.length));
    this.emit();
  }

  emit() {
    this.opts.onChange?.({ buffer: this.buffer, cursor: this.cursor, vim: this.vim });
  }

  insert(text) {
    if (this.vim) {
      // minimal vim: typing in normal mode replaces the char under cursor
      this.buffer = this.buffer.slice(0, this.cursor) + text + this.buffer.slice(this.cursor + 1);
      this.cursor += text.length;
      this.vim = false;
    } else {
      this.buffer = this.buffer.slice(0, this.cursor) + text + this.buffer.slice(this.cursor);
      this.cursor += text.length;
    }
    this.emit();
  }

  backspace() {
    if (this.cursor <= 0) return;
    this.buffer = this.buffer.slice(0, this.cursor - 1) + this.buffer.slice(this.cursor);
    this.cursor -= 1;
    this.emit();
  }

  submit() {
    const line = this.buffer;
    if (line.trim() === "") return;
    this.buffer = "";
    this.cursor = 0;
    this.emit();
    this.opts.onSubmit?.(line);
  }

  onData(chunk) {
    if (this.quit) return;
    // bracketed paste framing
    if (this.pasteBuffer !== null) {
      this.pasteBuffer += chunk;
      if (this.pasteBuffer.endsWith(PASTE_END)) {
        const inner = this.pasteBuffer.slice(PASTE_START.length, -PASTE_END.length);
        this.pasteBuffer = null;
        this.insert(inner);
      } else if (!this.pasteBuffer.startsWith(PASTE_START)) {
        // not actually a paste; treat as normal bytes
        const raw = this.pasteBuffer;
        this.pasteBuffer = null;
        this.onData(raw);
      }
      return;
    }
    if (chunk.startsWith(PASTE_START)) {
      this.pasteBuffer = chunk;
      return;
    }
    if (chunk === SHIFT_ENTER) {
      this.insert("\n");
      return;
    }
    if (this.busy) {
      // While a turn is running, only Ctrl+C matters — and it must be
      // checked per character: a bulk chunk (pipe/paste) can contain a full
      // second command line after the first submit, and letting it through
      // would race the running turn (e.g. /quit disposing the agent).
      if (chunk.includes(String.fromCharCode(KEY.CTRL_C))) this.opts.onInterrupt?.();
      return;
    }
    for (const char of chunk) {
      if (this.busy) {
        // A bulk chunk (pipe/paste) can contain a full second command line
        // after the first submit; letting it through would race the running
        // turn (e.g. /quit disposing the agent mid-turn). Only Ctrl+C passes.
        if (char === String.fromCharCode(KEY.CTRL_C)) this.opts.onInterrupt?.();
        continue;
      }
      if (char === "\u001b") {
        // escape sequence or vim-mode toggle
        if (chunk.length > 1) {
          // parse common sequences: arrows, home/end, delete
          this.handleEscape(chunk);
          break;
        }
        this.vim = !this.vim;
        this.emit();
        continue;
      }
      const code = char.codePointAt(0);
      if (this.vim && char >= " " && code !== KEY.ENTER && code !== KEY.LINEFEED && code !== KEY.CTRL_C) {
        this.vimKey(char);
        continue;
      }
      if (code === KEY.ENTER || code === KEY.LINEFEED || code === KEY.CTRL_J) {
        this.submit();
      } else if (code === KEY.CTRL_C) {
        this.opts.onQuit?.();
      } else if (code === KEY.CTRL_D) {
        if (this.buffer === "") this.opts.onQuit?.();
      } else if (code === KEY.BACKSPACE || code === KEY.DEL) {
        this.backspace();
      } else if (code === KEY.TAB) {
        this.opts.onSuggestion?.();
      } else if (char >= " ") {
        this.insert(char);
      }
    }
  }

  handleEscape(seq) {
    // arrows: \x1b[A up, \x1b[B down, \x1b[C right, \x1b[D left
    if (seq === "\u001b[C") this.moveCursor(1);
    else if (seq === "\u001b[D") this.moveCursor(-1);
    else if (seq === "\u001b[H" || seq === "\u001b[1~") this.cursor = 0, this.emit();
    else if (seq === "\u001b[F" || seq === "\u001b[4~") this.cursor = this.buffer.length, this.emit();
    else if (seq === "\u001b[3~") this.deleteForward();
    // vim normal-mode keys handled in the byte loop (single chars)
  }

  moveCursor(delta) {
    this.cursor = Math.max(0, Math.min(this.buffer.length, this.cursor + delta));
    this.emit();
  }

  deleteForward() {
    if (this.cursor >= this.buffer.length) return;
    this.buffer = this.buffer.slice(0, this.cursor) + this.buffer.slice(this.cursor + 1);
    this.emit();
  }

  /** Single-char vim normal-mode actions (h/j/k/l/0/$/x/i/a). */
  vimKey(char) {
    if (char === "h") this.moveCursor(-1);
    else if (char === "l" || char === " ") this.moveCursor(1);
    else if (char === "0") this.cursor = 0, this.emit();
    else if (char === "$") this.cursor = this.buffer.length, this.emit();
    else if (char === "x") this.deleteForward();
    else if (char === "i") this.vim = false, this.emit();
    else if (char === "a") { this.moveCursor(1); this.vim = false; this.emit(); }
    else if (char === "k" || char === "j") { /* history: reserved */ }
    else if (char === "\r" || char === "\n") this.submit();
  }

  stop() {
    this.quit = true;
    if (this.tty) {
      this.stdin.removeListener("data", this.onDataBound);
      this.stdin.removeListener("end", this.onEndBound);
      this.stdin.setRawMode(false);
    } else {
      this.rl?.close();
    }
  }
}
