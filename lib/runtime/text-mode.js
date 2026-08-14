/**
 * dsh-tui text mode — fallback renderer when stdout is not a TTY (pipes,
 * CI, logs). Same channel/agent logic as the Ink path, but renders events
 * as plain text lines and reads input via readline. Ported from the v1
 * TurnRenderer so the non-TTY experience stays stable.
 *
 * @module dsh-tui-app/runtime/text-mode
 */

import readline from "node:readline";
import { paint } from "../theme/palette.js";
import { textOf } from "../channel/events.js";

export function runTextMode({ io, agent, store, ctl, banner }) {
  io.stdout.write(banner + "\n");
  const detach = agent.ctx.on("session/event", (_s, event) => {
    renderRawEvent(io.stdout, event);
  });

  const rl = readline.createInterface({ input: io.stdin, terminal: false, crlfDelay: Infinity });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (trimmed === "") return;
    if (trimmed === "/quit" || trimmed === "/exit" || trimmed === "/q") {
      detach();
      rl.close();
      io.stdout.write("bye.\n");
      io.exit(0);
      return;
    }
    ctl.submit(trimmed);
  });
  rl.on("close", () => {
    detach();
    io.stdout.write("bye.\n");
    io.exit(0);
  });
}

/** Minimal raw-event -> text renderer (mirrors v1 TurnRenderer). */
function renderRawEvent(stdout, event) {
  switch (event.type) {
    case "user/message": {
      if (event.data.source?.kind !== "user") return;
      const text = textOf(event.data.content);
      if (text === "") return;
      stdout.write(`\n${paint("you:", "accent")} ${text}\n`);
      break;
    }
    case "assistant/chunk": {
      const chunk = event.data.chunk;
      if (chunk?.type === "text-delta" && chunk.text !== "") stdout.write(chunk.text);
      else if (chunk?.type === "reasoning-delta" && chunk.text !== "")
        stdout.write(paint(chunk.text, "dim"));
      break;
    }
    case "assistant/message": {
      const text = textOf(event.data.message?.content);
      if (text !== "") stdout.write(`\n${text}\n`);
      break;
    }
    case "tool/call": {
      const args = String(event.data.arguments ?? "").replace(/\s+/g, " ").slice(0, 120);
      stdout.write(`\n${paint(`⚙ ${event.data.name}(${args})`, "warning")}\n`);
      break;
    }
    case "tool/result": {
      const error = event.data.error;
      if (error !== void 0)
        stdout.write(`${paint(`✗ ${error.code ?? "error"}: ${error.message ?? "failed"}`, "error")}\n`);
      else stdout.write(`${paint("✓ ok", "success")}\n`);
      break;
    }
    case "turn/end": {
      const reason = event.data.reason;
      if (reason?.kind === "error")
        stdout.write(`\n${paint(`✗ turn failed: ${reason.error?.code ?? "UNKNOWN"}`, "error")}\n`);
      else if (reason?.kind === "max-tokens")
        stdout.write(`\n${paint("(output reached the max-token limit)", "warning")}\n`);
      else if (reason?.kind === "aborted")
        stdout.write(`\n${paint("(turn interrupted)", "warning")}\n`);
      break;
    }
    default:
      break;
  }
}
