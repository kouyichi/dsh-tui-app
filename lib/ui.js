/**
 * Minimal ANSI terminal UI for dsh-tui: line input over raw-mode stdin
 * (TTY) or piped line reading (non-TTY), plus tiny color helpers. Plain
 * escape sequences only — no external UI dependencies.
 *
 * @module dsh-tui-app/ui
 */

import readline from "node:readline";

/** Wrap text in one ANSI SGR code (e.g. "36" for cyan foreground). */
export function paint(text, code) {
	return `\u001b[${code}m${text}\u001b[0m`;
}

const KEY = {
	ENTER: 0x0d,
	LINEFEED: 0x0a,
	CTRL_C: 0x03,
	CTRL_D: 0x04,
	BACKSPACE: 0x7f,
	DEL: 0x08,
	ESC: 0x1b
};

/**
 * Interactive line input.
 *
 * TTY: raw-mode byte loop with a redrawn prompt line. Enter submits, Ctrl+C
 * quits (resolves `null`), Ctrl+D on an empty line quits, backspace edits,
 * and escape sequences (arrow keys etc.) are swallowed. Input can arrive in
 * bulk (paste, a pipe feeding the PTY): settled lines are queued and consumed
 * one by one by {@link nextLine}. While `busy` is set (an agent turn is
 * running) keystrokes are ignored except Ctrl+C, which calls `onInterrupt`
 * so the caller can cancel the running turn.
 *
 * Non-TTY (piped stdin): plain line reading; EOF resolves `null`.
 *
 * Call {@link stop} before exiting: an open raw-mode TTY stdin would keep
 * the event loop alive and the process would never terminate.
 */
export class Input {
	constructor(stdin, stdout, { onInterrupt } = {}) {
		this.stdin = stdin;
		this.stdout = stdout;
		this.onInterrupt = onInterrupt;
		this.tty = stdin.isTTY === true;
		this.buffer = "";
		this.prompt = "";
		this.busy = false;
		this.quit = false;
		this.queue = [];
		this.waiters = [];
		this.lastRendered = 0;
		this.swallow = 0;
		this.lines = null;
		this.rl = null;
		if (this.tty) {
			this.onDataBound = (chunk) => this.onData(chunk);
			this.onEndBound = () => this.pushLine(null);
			stdin.setRawMode(true);
			stdin.setEncoding("utf8");
			stdin.on("data", this.onDataBound);
			stdin.on("end", this.onEndBound);
			stdin.resume();
		} else {
			this.rl = readline.createInterface({
				input: stdin,
				terminal: false,
				crlfDelay: Infinity
			});
			this.lines = this.rl[Symbol.asyncIterator]();
		}
	}

	/**
	 * Read one input line. Resolves the line as typed, or `null` on
	 * EOF / Ctrl+C / Ctrl+D on an empty line (the caller should quit).
	 * Lines already settled (bulk input) are served from the queue first.
	 * @param prompt - prompt string to render (TTY mode only).
	 */
	async nextLine(prompt) {
		if (!this.tty) {
			const next = await this.lines.next();
			return next.done ? null : next.value;
		}
		if (this.queue.length > 0) return this.queue.shift();
		this.prompt = prompt;
		this.render();
		return await new Promise((resolve) => {
			this.waiters.push(resolve);
		});
	}

	onData(chunk) {
		if (this.quit) return;
		for (const char of chunk) {
			if (this.swallow > 0) {
				this.swallow -= 1;
				continue;
			}
			const code = char.codePointAt(0);
			if (this.busy) {
				if (code === KEY.CTRL_C) this.onInterrupt?.();
				continue;
			}
			if (code === KEY.ENTER || code === KEY.LINEFEED) {
				const line = this.buffer;
				this.buffer = "";
				this.stdout.write("\r\n");
				this.pushLine(line);
				continue;
			}
			if (code === KEY.CTRL_C) {
				this.stdout.write("\r\n");
				this.pushLine(null);
				continue;
			}
			if (code === KEY.CTRL_D) {
				if (this.buffer === "") {
					this.stdout.write("\r\n");
					this.pushLine(null);
					continue;
				}
				const line = this.buffer;
				this.buffer = "";
				this.stdout.write("\r\n");
				this.pushLine(line);
				continue;
			}
			if (code === KEY.BACKSPACE || code === KEY.DEL) {
				if (this.buffer.length > 0) {
					this.buffer = this.buffer.slice(0, -1);
					this.render();
				}
				continue;
			}
			if (code === KEY.ESC) {
				// Swallow the rest of one escape sequence (e.g. arrow keys).
				this.swallow = 2;
				continue;
			}
			if (code >= 0x20 && code !== 0x7f) {
				this.buffer += char;
				this.render();
			}
		}
	}

	/** Deliver one settled line to a waiting nextLine, or queue it. */
	pushLine(line) {
		if (this.waiters.length > 0) this.waiters.shift()(line);
		else this.queue.push(line);
	}

	/** Redraw the prompt line in place, clearing any tail from a longer line. */
	render() {
		const line = `${this.prompt}${this.buffer}`;
		const clear = this.lastRendered > line.length ? " ".repeat(this.lastRendered - line.length) : "";
		this.stdout.write(`\r${line}${clear}\r${line}`);
		this.lastRendered = line.length;
	}

	/**
	 * Release the input stream so the process can exit: drop listeners, leave
	 * raw mode, and pause (or close the piped reader). Idempotent.
	 */
	stop() {
		if (this.quit) return;
		this.quit = true;
		if (this.tty) {
			this.stdin.removeListener("data", this.onDataBound);
			this.stdin.removeListener("end", this.onEndBound);
			try {
				this.stdin.setRawMode(false);
			} catch {
				// stdin may already be gone; nothing to restore.
			}
			this.stdin.pause();
		} else {
			this.rl?.close();
		}
	}
}
