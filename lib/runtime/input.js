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
  CTRL_O: 0x0f,
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
    this.menu = null; // 'config' | 'mode' | 'model' | 'jobs' | 'search' | 'traj'
    this.questionActive = false; // answering an ask_user_question prompt
    this.configEdit = null; // { key, buffer } while editing a /config numeric param
    this.history = [];
    this.historyIdx = -1;
    this.pasting = "";
    this.pasteBuffer = "";
    this.quit = false;
    this.rl = null;
    this.leaderWaiting = false;
    this.leaderAt = 0;
    this.lastEscAt = 0;

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

  setMenu(kind) {
    this.menu = kind;
  }

  /** Enter/leave inline editing for a /config numeric param (e key). */
  setConfigEdit(key, current) {
    this.configEdit = key == null ? null : { key, buffer: String(current ?? "") };
  }

  /** Push a submitted line into the command history (ring of 50). */
  historyPush(text) {
    const t = text.trim();
    if (t === "") return;
    if (this.history[0] === t) return;
    this.history.unshift(t);
    if (this.history.length > 50) this.history.pop();
    this.historyIdx = -1;
  }

  /** Up/down through history (delta -1 = older). */
  historyNav(delta) {
    if (this.history.length === 0) return;
    if (delta < 0) {
      this.historyIdx = Math.min(this.historyIdx + 1, this.history.length - 1);
    } else {
      this.historyIdx -= 1;
      if (this.historyIdx < -1) this.historyIdx = -1;
    }
    const text = this.historyIdx >= 0 ? this.history[this.historyIdx] : "";
    this.setBuffer(text, text.length);
  }

  setQuestionActive(active) {
    this.questionActive = active;
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
    // Index loop so escape sequences can consume their own length.
    let i = 0;
    while (i < chunk.length) {
      if (this.questionActive) {
        // Answering an ask_user_question prompt: text/number input submits on
        // Enter; Esc cancels; Ctrl+C cancels too (the agent turn aborts).
        const char = chunk[i];
        if (char === "\u001b") {
          const consumed = this.handleEscape(chunk.slice(i));
          i += consumed;
          continue;
        } else if (char === "\r" || char === "\n") {
          const text = this.buffer;
          this.buffer = "";
          this.cursor = 0;
          this.emit();
          this.opts.onQuestionSubmit?.(text);
        } else if (char === "\u0003") {
          this.opts.onQuestionCancel?.();
        } else if (char === "\u0004" && this.buffer === "") {
          this.opts.onQuestionCancel?.();
        } else if (char === "\u007f" || char === "\b") {
          this.backspace();
        } else if (char >= " ") {
          this.insert(char);
        }
        i += 1;
        continue;
      }
      if (this.menu) {
        // Menu mode (/config, /mode, /model): space toggles/selects, arrows
        // navigate, e triggers the menu's extra action, enter/esc closes.
        // Inline /config param editing takes precedence over menu keys.
        if (this.configEdit) {
          const char = chunk[i];
          if (char === "\u001b") {
            const consumed = this.handleEscape(chunk.slice(i));
            i += consumed;
            continue;
          } else if (char === "\r" || char === "\n") {
            const text = this.configEdit.buffer;
            this.configEdit = null;
            this.opts.onConfigEditSubmit?.(text);
          } else if (char === "\u0003" || char === "\u0004") {
            this.configEdit = null;
            this.opts.onConfigEditCancel?.();
          } else if (char === "\u0015" || char === "\u0017") {
            // Ctrl+U / Ctrl+W: clear the whole edit buffer
            this.configEdit.buffer = "";
            this.opts.onConfigEditChange?.("");
          } else if (char === "\u007f" || char === "\b") {
            this.configEdit.buffer = this.configEdit.buffer.slice(0, -1);
            this.opts.onConfigEditChange?.(this.configEdit.buffer);
          } else if (char >= " ") {
            this.configEdit.buffer += char;
            this.opts.onConfigEditChange?.(this.configEdit.buffer);
          }
          i += 1;
          continue;
        }
        const char = chunk[i];
        if (char === " ") {
          this.opts.onMenuToggle?.();
        } else if (char === "e" || char === "E" || char === "t" || char === "T") {
          this.opts.onMenuExtra?.();
        } else if (char === "\u001b") {
          const consumed = this.handleEscape(chunk.slice(i));
          i += consumed;
          continue;
        } else if (char === "\r" || char === "\n") {
          // ext panels confirm the selected row on Enter; others close.
          if (this.menu === "ext") this.opts.onMenuConfirm?.();
          else this.opts.onMenuClose?.();
        } else if (char === "q" || char === "Q") {
          if (this.menu === "ext") this.opts.onMenuClose?.();
        } else if (char === "\u007f" || char === "\b") {
          this.opts.onMenuClose?.();
        }
        i += 1;
        continue;
      }
      if (this.busy) {
        // While a turn runs, typing is allowed (commands like /jobs must stay
        // reachable); the submit path in index.js decides what may fire.
        // Only Ctrl+C gets special routing here.
        const char = chunk[i];
        if (char === "\u0003") {
          this.opts.onInterrupt?.();
          i += 1;
          continue;
        }
        // fall through to normal editing (no submit on enter: guarded below)
      }
      const char = chunk[i];
      // Leader key (ctrl+x): wait for the next keystroke, then dispatch to
      // brick hooks (e.g. ctrl+x m = /model). 2s timeout resets the wait.
      if (this.leaderWaiting && Date.now() - this.leaderAt > 2000) this.leaderWaiting = false;
      if (char === "\u0018") {
        this.leaderWaiting = true;
        this.leaderAt = Date.now();
        i += 1;
        continue;
      }
      if (this.leaderWaiting) {
        this.leaderWaiting = false;
        this.opts.onLeaderKey?.(char);
        i += 1;
        continue;
      }
      if (char === "\u001b") {
        const consumed = this.handleEscape(chunk.slice(i));
        i += consumed;
        continue;
      }
      const code = char.codePointAt(0);
      if (this.vim && char >= " " && code !== KEY.ENTER && code !== KEY.LINEFEED && code !== KEY.CTRL_C) {
        this.vimKey(char);
        i += 1;
        continue;
      }
      if (code === KEY.ENTER || code === KEY.LINEFEED || code === KEY.CTRL_J) {
        this.submit();
      } else if (code === KEY.CTRL_C) {
        this.opts.onQuit?.();
      } else if (code === KEY.CTRL_D) {
        if (this.buffer === "") this.opts.onQuit?.();
      } else if (code === 0x15) {
        // Ctrl+U: clear the whole line (standard readline/terminal binding).
        this.setBuffer("");
      } else if (code === KEY.BACKSPACE || code === KEY.DEL) {
        this.backspace();
      } else if (code === KEY.TAB) {
        this.opts.onSuggestion?.();
      } else if (code === KEY.CTRL_O) {
        this.opts.onCycleFold?.();
      } else if (char >= " ") {
        this.insert(char);
      }
      i += 1;
    }
  }

  /**
   * Parse one escape sequence starting at `seq` (begins with ESC).
   * Returns how many characters were consumed. Handles CSI sequences
   * (ESC [ ... final-byte) and the lone-ESC vim-mode toggle.
   */
  handleEscape(seq) {
    if (seq.length < 2) {
      if (this.menu) {
        this.opts.onMenuClose?.();
        return 1;
      }
      if (this.questionActive) {
        this.opts.onQuestionCancel?.();
        return 1;
      }
      // Double-Esc (idle, empty buffer): brick hook (rewind/fork picker).
      if (!this.vim && this.buffer === "" && !this.busy) {
        const now = Date.now();
        if (now - this.lastEscAt < 400) {
          this.lastEscAt = 0;
          this.opts.onDoubleEsc?.();
          return 1;
        }
        this.lastEscAt = now;
        return 1;
      }
      this.vim = !this.vim;
      this.emit();
      return 1;
    }
    // Alt+Enter: queue a follow-up (brick hook: /btw side-session, steer).
    // Accept both the legacy ESC+CR form and the kitty keyboard protocol
    // (\u001b[13;3u), which modern terminals send.
    if (seq.startsWith("\u001b\r") || seq.startsWith("\u001b[13;3u")) {
      this.opts.onAltEnter?.(this.buffer);
      return seq.startsWith("\u001b[13;3u") ? 8 : 2;
    }
    // Alt+Up: take back the queued follow-up (brick hook).
    if (seq.startsWith("\u001b[1;3A")) {
      this.opts.onAltUp?.();
      return 6;
    }
    if (seq.startsWith("\u001b[C")) {
      if (this.menu) {
        this.opts.onMenuSectionNav?.(1);
        return 3;
      }
      this.moveCursor(1);
      return 3;
    }
    if (seq.startsWith("\u001b[D")) {
      if (this.menu) {
        this.opts.onMenuSectionNav?.(-1);
        return 3;
      }
      this.moveCursor(-1);
      return 3;
    }
    if (seq.startsWith("\u001b[A")) {
      const nav = this.menu ? this.opts.onMenuNav : this.opts.onSuggestionNav;
      nav?.(-1);
      return 3;
    }
    if (seq.startsWith("\u001b[B")) {
      const nav = this.menu ? this.opts.onMenuNav : this.opts.onSuggestionNav;
      nav?.(1);
      return 3;
    }
    if (seq.startsWith("\u001b[H")) { this.cursor = 0; this.emit(); return 3; }
    if (seq.startsWith("\u001b[F")) { this.cursor = this.buffer.length; this.emit(); return 3; }
    if (seq.startsWith("\u001b[1~")) { this.cursor = 0; this.emit(); return 3; }
    if (seq.startsWith("\u001b[4~")) { this.cursor = this.buffer.length; this.emit(); return 3; }
    if (seq.startsWith("\u001b[3~")) { this.deleteForward(); return 3; }
    if (seq.startsWith("\u001b[5~")) { if (!this.menu) this.opts.onTabSwitch?.(-1); return 3; } // PgUp
    if (seq.startsWith("\u001b[6~")) { if (!this.menu) this.opts.onTabSwitch?.(1); return 3; } // PgDn
    if (seq.startsWith(SHIFT_ENTER)) { this.insert("\n"); return SHIFT_ENTER.length; }
    // Generic CSI: consume up to the terminating byte (@-~).
    if (seq[1] === "[") {
      const m = seq.slice(2).match(/^[0-9;:]*([@-~])/);
      if (m) return 2 + m[0].length;
    }
    // Unknown escape: consume just the ESC (keep the rest as normal input).
    return 1;
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
    else if (char === "k" || char === "j") {
      // vim-style history navigation: k = newer (up), j = older (down)
      this.historyNav(char === "k" ? -1 : 1);
    }
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
