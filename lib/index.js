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
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
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
  "/help", "/quit", "/config", "/mode", "/model", "/resume", "/sessions", "/compact", "/jobs", "/plan", "/goal",
];

const FOLD_CYCLE = ["collapsed", "expanded", "hidden"];

/** /config items (Codex-experiment style checkboxes). */
const CONFIG_ITEMS = [
  { key: "turns", label: "轮次 / 步数" },
  { key: "llmMs", label: "LLM 时间" },
  { key: "toolMs", label: "工具调用时间" },
  { key: "cache", label: "缓存命中率" },
  { key: "tps", label: "TPS" },
];
const DEFAULT_CONFIG = { turns: true, steps: true, llmMs: true, toolMs: true, cache: true, tps: true };
const CONFIG_PATH = join(
  process.env.DSH_HOME ?? join(process.env.HOME ?? "/root", ".dsh"),
  "profiles",
  "tui",
  "tui-config.json"
);

function loadConfig() {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(CONFIG_PATH, "utf8")) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(config) {
  try {
    mkdirSync(join(CONFIG_PATH, ".."), { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch {
    /* best-effort persistence */
  }
}

/** Compact ms into "1m02s" / "12.3s" / "842ms". */
export { fmtMs } from "./util/format.js";

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
  const presetsSvc = ctx.get("agentPresets");
  const setup = async (agentCtx) => {
    installModelSelection(agentCtx, { current: selection, assembled: void 0 });
    // Join the default agent preset (standard/code/minimal/cordis) so the
    // agent gets the preset tool set (incl. ask_user_question), like web.
    if (presetsSvc) {
      try {
        await presetsSvc.mount(agentCtx);
      } catch (error) {
        process.stderr.write(`dsh: tui: preset mount failed: ${error.message}\n`);
      }
    }
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

  let input = null;
  let instance = null;
  let submitting = false;

  const store = createStore(
    {
      events: [],
      meta: {
        model: selection.model,
        provider: selection.provider,
        sessionId: agent.session.id,
        cwd: agent.session.header.cwd ?? process.cwd(),
        resumed,
      },
      input: { buffer: "", cursor: 0, vim: false, busy: false, suggestions: [], selected: 0 },
      status: { branch: gitBranch(process.cwd()) },
      stats: {
        turns: 0,
        steps: 0,
        llmMs: 0,
        toolMs: 0,
        ttftMs: 0,
        ttftSteps: 0,
        decodeMs: 0,
        decodeTokens: 0,
        cacheRead: 0,
        uncachedInput: 0,
      },
      config: loadConfig(),
      configMenu: null, // { selected } while open
      modeMenu: null, // { items, selected } while open
      modeCurrent: null, // default agent-preset id (settings)
      modelMenu: null, // { items, selected, effort } while open
      question: null, // { item, index, total } while an ask_user_question is open
      fold: "collapsed",
    },
    // Every store change re-renders the tree through Ink directly (React
    // effects don't run reliably in this environment).
    () => {
      if (instance) instance.rerender(h(App, { store, ctl }));
    }
  );

  const projections = ctx.get("sessionProjections");
  const presets = ctx.get("agentPresets");
  const notice = (tone, text) => {
    store.set({ events: [...store.get().events, { kind: "notice", tone, text }] });
  };
  if (presets?.defaultId) store.set({ modeCurrent: presets.defaultId });
  const refreshStats = () => {
    if (!projections) return;
    try {
      const snap = projections.snapshot(agent.session);
      const s = snap.values.sessionStats;
      const u = snap.values.tokenUsage;
      if (!s) return;
      store.set({
        stats: {
          turns: s.turns ?? 0,
          steps: s.steps ?? 0,
          llmMs: s.llmMs ?? 0,
          toolMs: s.toolMs ?? 0,
          ttftMs: s.ttftMs ?? 0,
          ttftSteps: s.ttftSteps ?? 0,
          decodeMs: s.decodeMs ?? 0,
          decodeTokens: s.decodeTokens ?? 0,
          cacheRead: u?.cacheReadTokens ?? 0,
          uncachedInput: u?.uncachedInputTokens ?? 0,
        },
      });
    } catch {
      /* projection seam unavailable */
    }
  };

  const channel = createChannel(agent, (ev) => {
    store.set({ events: [...store.get().events, ev] });
    refreshStats();
  });
  refreshStats();

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
      // Tab: accept the currently selected suggestion
      const { suggestions, selected } = store.get().input;
      const list = suggestions ?? [];
      if (list.length > 0) input.acceptSuggestion(list[selected ?? 0]);
    },
    onSuggestionNav(delta) {
      // Up/Down: move the selection through the visible suggestions
      const { suggestions, selected } = store.get().input;
      const list = suggestions ?? [];
      if (list.length === 0) return;
      const n = list.length;
      const next = (((selected ?? 0) + delta) % n + n) % n;
      store.set({ input: { ...store.get().input, selected: next } });
    },
    openConfig() {
      input?.setMenu("config");
      store.set({ configMenu: { selected: 0 } });
    },
    closeConfig() {
      input?.setMenu(null);
      store.set({ configMenu: null });
    },
    configNav(delta) {
      const menu = store.get().configMenu;
      if (!menu) return;
      const n = CONFIG_ITEMS.length;
      const next = (((menu.selected ?? 0) + delta) % n + n) % n;
      store.set({ configMenu: { selected: next } });
    },
    configToggle() {
      const menu = store.get().configMenu;
      if (!menu) return;
      const key = CONFIG_ITEMS[menu.selected ?? 0].key;
      const config = { ...store.get().config, [key]: !store.get().config[key] };
      saveConfig(config);
      store.set({ config });
    },
    async openMode() {
      if (!presets) {
        notice("error", "agent presets unavailable in this profile");
        return;
      }
      let list = [];
      try {
        list = await presets.list();
        list.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
      } catch (error) {
        notice("error", `failed to list presets: ${error.message}`);
        return;
      }
      input?.setMenu("mode");
      store.set({ modeMenu: { items: list, selected: 0 }, modeCurrent: presets.defaultId });
    },
    closeMode() {
      input?.setMenu(null);
      store.set({ modeMenu: null });
    },
    modeNav(delta) {
      const menu = store.get().modeMenu;
      if (!menu || !menu.items?.length) return;
      const n = menu.items.length;
      const next = (((menu.selected ?? 0) + delta) % n + n) % n;
      store.set({ modeMenu: { ...menu, selected: next } });
    },
    async modeSelect() {
      const menu = store.get().modeMenu;
      if (!menu || !menu.items?.length) return;
      const item = menu.items[menu.selected ?? 0];
      const settings = ctx.get("settings");
      try {
        await settings?.update("agent-presets", { default: item.id });
        store.set({ modeCurrent: item.id });
        notice("info", `模式已切换为「${item.name ?? item.id}」— 新会话生效`);
      } catch (error) {
        notice("error", `切换失败: ${error.message}`);
      }
      ctl.closeMode();
    },
    async openModel() {
      const llm = ctx.get("llm");
      if (!llm) {
        notice("error", "llm service unavailable");
        return;
      }
      const selection = defaultModel.currentSelection();
      let list = [];
      try {
        list = await llm.listModels(selection.provider);
      } catch (error) {
        notice("error", `failed to list models: ${error.message}`);
        return;
      }
      const items = list.map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
        contextWindow: m.contextWindow ?? m.context?.contextWindow,
      }));
      const selIdx = Math.max(0, items.findIndex((m) => m.id === selection.model));
      input?.setMenu("model");
      store.set({
        modelMenu: { items, selected: selIdx, effort: selection.reasoningEffort ?? "max" },
      });
    },
    closeModel() {
      input?.setMenu(null);
      store.set({ modelMenu: null });
    },
    modelNav(delta) {
      const menu = store.get().modelMenu;
      if (!menu || !menu.items?.length) return;
      const n = menu.items.length;
      const next = (((menu.selected ?? 0) + delta) % n + n) % n;
      store.set({ modelMenu: { ...menu, selected: next } });
    },
    modelToggleEffort() {
      const menu = store.get().modelMenu;
      if (!menu) return;
      const cycle = ["max", "low"];
      const next = cycle[(cycle.indexOf(menu.effort) + 1) % cycle.length];
      store.set({ modelMenu: { ...menu, effort: next } });
    },
    async modelSelect() {
      const menu = store.get().modelMenu;
      if (!menu || !menu.items?.length) return;
      const item = menu.items[menu.selected ?? 0];
      try {
        await defaultModel.saveSelection({
          provider: defaultModel.currentSelection().provider,
          model: item.id,
          reasoningEffort: menu.effort,
        });
        notice("info", `模型已切换为 ${item.id}（推理力度 ${menu.effort}）— 新会话生效`);
      } catch (error) {
        notice("error", `切换失败: ${error.message}`);
      }
      ctl.closeModel();
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
      // Live completion: recompute candidates on every edit.
      const suggestions = input.suggestionsFor(buffer);
      store.set({
        input: { ...store.get().input, buffer, cursor, vim, suggestions, selected: 0 },
      });
    },
    onSubmit: (text) => {
      const trimmed = text.trim();
      if (trimmed.startsWith("/")) {
        const [command] = trimmed.split(/\s+/);
        if (command === "/quit" || command === "/exit" || command === "/q") {
          ctl.exit();
          return;
        }
        if (command === "/config") {
          ctl.openConfig();
          return;
        }
        if (command === "/mode") {
          ctl.openMode();
          return;
        }
        if (command === "/model") {
          ctl.openModel();
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
    onSuggestionNav: (delta) => ctl.onSuggestionNav(delta),
    onCycleFold: () => ctl.cycleFold(),
    // Unified menu callbacks: route by which menu is open.
    onMenuNav: (delta) => {
      if (store.get().modeMenu) ctl.modeNav(delta);
      else if (store.get().modelMenu) ctl.modelNav(delta);
      else if (store.get().configMenu) ctl.configNav(delta);
    },
    onMenuToggle: () => {
      if (store.get().modeMenu) ctl.modeSelect();
      else if (store.get().modelMenu) ctl.modelSelect();
      else if (store.get().configMenu) ctl.configToggle();
    },
    onMenuExtra: () => {
      if (store.get().modelMenu) ctl.modelToggleEffort();
    },
    onMenuClose: () => {
      if (store.get().modeMenu) ctl.closeMode();
      else if (store.get().modelMenu) ctl.closeModel();
      else if (store.get().configMenu) ctl.closeConfig();
    },
    // ask_user_question provider support (see registerProvider below).
    onQuestionSubmit: (text) => {
      const q = pendingQ;
      if (!q) return;
      pendingQ = null;
      input?.setQuestionActive(false);
      store.set({ question: null });
      const opts = q.item.options ?? [];
      let selected = [];
      let custom;
      if (opts.length > 0) {
        const nums = text
          .split(/[,，\s]+/)
          .map((s) => parseInt(s, 10))
          .filter((n) => Number.isInteger(n) && n >= 1 && n <= opts.length);
        if (nums.length > 0) {
          selected = [...new Set(nums)].map((n) => opts[n - 1].label);
        } else {
          custom = text; // typed an "other" answer
        }
      } else {
        custom = text;
      }
      q.resolve({ id: q.item.id, selected, custom });
    },
    onQuestionCancel: () => {
      const q = pendingQ;
      if (!q) return;
      pendingQ = null;
      input?.setQuestionActive(false);
      store.set({ question: null });
      q.reject(new Error("question canceled"));
    },
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

  // ask_user_question provider: pause the agent turn until the user answers.
  let pendingQ = null;
  const askOne = (item, index, total) =>
    new Promise((resolve, reject) => {
      input?.setQuestionActive(true);
      store.set({ question: { item, index, total } });
      pendingQ = { item, resolve, reject };
    });
  const userQuestions = ctx.get("userQuestions");
  if (userQuestions) {
    userQuestions.registerProvider({
      async ask(request) {
        const answers = [];
        for (let i = 0; i < request.questions.length; i++) {
          answers.push(await askOne(request.questions[i], i, request.questions.length));
        }
        return { answers };
      },
    });
  }

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
        "  /config          status-bar display toggles (space to switch)",
        "  /mode            agent mode: standard/code/minimal/cordis (next session)",
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
