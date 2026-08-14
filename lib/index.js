/**
 * dsh-tui-app — Ink-based interactive terminal chat driver (v2).
 *
 * Cordis plugin over dsh-base: creates (or resumes) one Agent through the
 * core registry, subscribes to its live `session/event` stream, normalizes
 * events through the channel, and renders the transcript + input with Ink.
 * No Host, HTTP server, or browser plugins are mounted.
 *
 * @module dsh-tui-app
 */

import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { PassThrough } from "node:stream";
import { render } from "ink";
import React from "react";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import { h } from "./runtime/jsx.js";
import { createStore } from "./runtime/store.js";
import { Input } from "./runtime/input.js";
import { createChannel } from "./channel/events.js";
import App from "./runtime/app.js";
import { runTextMode } from "./runtime/text-mode.js";
import { paint } from "./theme/palette.js";

export const name = "tui-runner";
export const inject = ["tuiStartup"];

const COMMANDS = [
  "/help", "/quit", "/model", "/resume", "/sessions", "/compact", "/jobs", "/plan", "/goal",
];

const FOLD_CYCLE = ["collapsed", "expanded", "hidden"];

/** Report an unexpected direct-driver failure and request a failing exit. */
function fail(io, error) {
  io.stderr.write(`dsh: ${error instanceof Error ? error.message : String(error)}\n`);
  io.exit(1);
}

/** Read git branch of a cwd (cheap, best-effort). */
function gitBranch(cwd) {
  try {
    const head = readFileSync(`${cwd}/.git/HEAD`, "utf8").trim();
    if (head.startsWith("ref:")) return head.slice(head.lastIndexOf("/") + 1);
    return head.slice(0, 7);
  } catch {
    return null;
  }
}

async function run(ctx, resumeSessionId, io) {
  await ctx.get("loader")?.await();
  const agents = ctx.get("agents");
  const defaultModel = ctx.get("agentDefaultModel");
  const sessions = ctx.get("sessions");
  if (agents === void 0 || defaultModel === void 0 || sessions === void 0) {
    io.stderr.write("dsh: tui-runner: missing core services (agents/agentDefaultModel/sessions)\n");
    io.exit(1);
    return;
  }

  const selection = defaultModel.currentSelection();
  const agentOptions = { provider: selection.provider, model: selection.model };
  const setup = (agentCtx) => {
    installModelSelection(agentCtx, { current: selection, assembled: void 0 });
  };

  let handle;
  let resumed = false;
  if (resumeSessionId !== void 0 && resumeSessionId !== "") {
    try {
      handle = await agents.resume({ resumeSessionId, agentOptions, setup });
      resumed = true;
    } catch (error) {
      io.stderr.write(`dsh: cannot resume session "${resumeSessionId}": ${error instanceof Error ? error.message : String(error)}\n`);
      io.exit(1);
      return;
    }
  } else {
    handle = await agents.create({
      sessionId: SessionId(`session-${randomUUID()}`),
      meta: { cwd: process.cwd() },
      agentOptions,
      setup,
    });
  }
  const { agent, dispose } = handle;
  await agent.whenIdle();

  const store = createStore({
    events: [],
    meta: {
      model: selection.model,
      provider: selection.provider,
      sessionId: agent.session.id,
      cwd: agent.session.header.cwd ?? process.cwd(),
      resumed,
    },
    input: { buffer: "", cursor: 0, vim: false, busy: false, suggestions: [] },
    status: { branch: gitBranch(process.cwd()) },
    fold: "collapsed",
  });

  const channel = createChannel(agent, (ev) => {
    store.set({ events: [...store.get().events, ev] });
  });

  let input = null;
  let instance = null;
  let submitting = false;
  const ctl = {
    async submit(text) {
      if (submitting) return; // one turn at a time
      submitting = true;
      input?.setBusy(true);
      store.set({ input: { ...store.get().input, busy: true } });
      try {
        // v1 ordering: followup first, then wait. (An await before followup
        // was suspected of racing the agent's ctx lifecycle.)
        agent.followup(
          createUserMessage({ content: [{ type: "text", text }], source: { kind: "user" } })
        );
        await agent.whenIdle();
        await sessions.flush(agent.session);
      } finally {
        submitting = false;
        input?.setBusy(false);
        store.set({ input: { ...store.get().input, busy: false } });
      }
    },
    interrupt() {
      agent.cancel({ kind: "interrupted" });
    },
    cycleFold() {
      const cur = store.get().fold;
      const next = FOLD_CYCLE[(FOLD_CYCLE.indexOf(cur) + 1) % FOLD_CYCLE.length];
      store.set({ fold: next });
    },
    onSuggestion() {
      const { buffer } = store.get().input;
      const sugg = input.suggestionsFor(buffer);
      if (sugg && sugg.length > 0) {
        // accept first suggestion: replace trailing token
        input.acceptSuggestion(sugg[0]);
      }
    },
    exit() {
      store.set({ input: { ...store.get().input, busy: false } });
      input?.stop();
      channel.detach();
      instance?.unmount();
      // Let Ink flush its last frame, then print the farewell below it.
      setTimeout(() => {
        io.stdout.write("bye.\n");
        dispose().finally(() => io.exit(0));
      }, 50);
    },
    onExitRequest: null,
  };
  ctl.exitRequested = () => ctl.onExitRequest?.();

  // Non-TTY (pipes, CI): plain text rendering + readline. Ink needs a TTY.
  if (!io.stdout.isTTY) {
    const meta = store.get().meta;
    const banner = [
      `${paint("dsh tui", "accent-bold")} — interactive coding agent${meta.resumed ? paint(" (resumed)", "warning") : ""}`,
      `  model     ${meta.model} (${meta.provider})`,
      `  session   ${meta.sessionId}`,
      `  workspace ${meta.cwd}`,
      `type /help for commands, /quit to exit`,
    ].join("\n");
    runTextMode({ io, agent, store, ctl, banner });
    return;
  }

  // suggestions for the current buffer (commands / files)
  input = new Input(io.stdin, {
    onChange: ({ buffer, cursor, vim }) => {
      store.set({ input: { ...store.get().input, buffer, cursor, vim } });
    },
    onSubmit: (text) => {
      const trimmed = text.trim();
      if (trimmed.startsWith("/")) {
        const [command] = trimmed.split(/\s+/);
        if (command === "/quit" || command === "/exit" || command === "/q") {
          ctl.exit();
          return;
        }
        handleCommand(ctx, command, trimmed, store, io);
        return;
      }
      ctl.submit(text);
    },
    onInterrupt: () => ctl.interrupt(),
    onQuit: () => ctl.exit(),
    onSuggestion: () => ctl.onSuggestion(),
    onCycleFold: () => ctl.cycleFold(),
  });
  input.suggestionsFor = (buffer) => {
    if (buffer.startsWith("/")) {
      return COMMANDS.filter((c) => c.startsWith(buffer));
    }
    if (buffer.startsWith("@")) {
      const q = buffer.slice(1);
      try {
        return readdirSync(process.cwd())
          .filter((f) => f.startsWith(q))
          .slice(0, 8)
          .map((f) => `@${f}`);
      } catch {
        return [];
      }
    }
    return [];
  };
  input.acceptSuggestion = (sugg) => {
    const { buffer } = store.get().input;
    let text = buffer;
    if (sugg.startsWith("/")) {
      text = sugg;
    } else if (sugg.startsWith("@")) {
      text = `@${sugg.slice(1)} `;
    }
    input.setBuffer(text, text.length);
  };

  // Ink render: give Ink a dummy stdin so our raw-mode layer owns the real one.
  // Small settle delay: with a pipe feeding stdin instantly, the first
  // keystrokes can otherwise arrive before the agent's ctx settles after
  // create() — the v1 pull-model input masked this by construction.
  await new Promise((resolve) => setTimeout(resolve, 250));
  instance = render(h(App, { store, ctl }), {
    stdin: new PassThrough(),
    stdout: io.stdout,
    stderr: io.stderr,
    exitOnCtrlC: false,
    clear: false,
  });

  await instance.waitUntilExit().catch(() => {});
  io.exit(0);
}

/** Non-submit commands: print into the stream as notices. */
function handleCommand(ctx, command, full, store, io) {
  const notice = (tone, text) => {
    store.set({ events: [...store.get().events, { kind: "notice", tone, text }] });
  };
  switch (command) {
    case "/help": {
      const lines = [
        "commands:",
        "  /help            show this help",
        "  /model           switch model",
        "  /resume          continue a past session",
        "  /sessions        list persisted sessions",
        "  /compact         compact the session history",
        "  /jobs            list background jobs",
        "  /plan /goal      mode entry points",
        "  /quit, /exit     quit",
        "",
        "typing:  multi-line (shift+enter) · vim mode (esc) · @file completion",
        "         Ctrl+O cycles tool-card folding · Ctrl+C interrupts a turn",
      ].join("\n");
      notice("info", lines);
      break;
    }
    case "/sessions": {
      const persistence = ctx.get("sessionPersistence");
      if (!persistence) {
        notice("error", "session listing unavailable");
        break;
      }
      persistence
        .list()
        .then((headers) => {
          if (headers.length === 0) notice("info", "no sessions yet");
          else
            notice(
              "info",
              `sessions (${headers.length}):\n` +
                headers
                  .map((hdr) => `  ${hdr.id}${hdr.title ? `  ${paint(hdr.title, "dim")}` : ""}${hdr.cwd ? `  @ ${hdr.cwd}` : ""}`)
                  .join("\n")
            );
        })
        .catch((e) => notice("error", `failed to list sessions: ${e.message}`));
      break;
    }
    case "/model":
      notice("info", "model switching lands in phase 2 (route: base agent-default-model)");
      break;
    case "/resume":
      notice("info", "use: dsh --profile tui --resume <sessionId>  (or relaunch with --resume)");
      break;
    case "/compact": {
      const compact = ctx.get("commandCompact");
      if (compact) notice("info", "compacting…");
      else notice("warning", "compaction unavailable in this profile");
      break;
    }
    case "/jobs": {
      const jobs = ctx.get("jobs");
      if (!jobs) {
        notice("info", "no jobs service mounted");
        break;
      }
      const list = jobs.list?.() ?? [];
      notice("info", list.length === 0 ? "no background jobs" : `jobs:\n${list.map((j) => `  ${j.id}  ${j.status ?? ""}`).join("\n")}`);
      break;
    }
    case "/plan":
      notice("info", "plan mode: ask the agent to plan; base handles approval (phase 2 visual)");
      break;
    case "/goal":
      notice("info", "goal mode entry (phase 2)");
      break;
    default:
      notice("error", `unknown command "${command}" — type /help`);
  }
}

export function apply(ctx, config) {
  const exit = ctx.get("appExit");
  if (exit === void 0) throw new Error("tui-runner: the launcher must provide ctx.appExit before the tree mounts");
  const io = { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr, exit };
  run(ctx, config?.sessionId, io).catch((error) => {
    fail(io, error);
  });
}
