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

import { buildTranscript } from "./components/message-stream.js";
import App from "./runtime/app.js";
import { runTextMode } from "./runtime/text-mode.js";
import { paint, setTheme, themeName, listThemes } from "./theme/palette.js";

export const name = "tui-runner";
export const inject = ["tuiStartup", "tuiExtensions"];

const COMMANDS = [
  "/help", "/quit", "/new", "/config", "/mode", "/model", "/plugins", "/resume", "/sessions",
  "/jobs", "/goal", "/tab",
];

const FOLD_CYCLE = ["collapsed", "expanded", "hidden"];

/**
 * Busy 时排队、回合结束（agent idle）后自动执行的命令——它们会触碰 agent
 * 会话状态（压缩/开新会话/切会话/重发输入），立即执行会打断或干扰当前回合。
 */
const DEFER_UNTIL_IDLE = new Set(["/compact", "/new", "/tab", "/undo"]);

/**
 * Busy 时立即后台执行（内核命令桥不占 agent turn）、但生效时机在回合后的命令
 * ——执行成功后在结果里附带"当前对话完成后自动起效"的告知。
 */
const DEFER_NOTIFY = new Set(["/goal", "/permission", "/plan"]);

/** /config items (Codex-experiment style checkboxes). */
const CONFIG_ITEMS = [
  { key: "turns", label: "轮次 / 步数" },
  { key: "steps", label: "步骤数" },
  { key: "llmMs", label: "LLM 时间" },
  { key: "toolMs", label: "工具调用时间" },
  { key: "cache", label: "缓存命中率" },
  { key: "tps", label: "TPS" },
];
/**
 * /config session parameters (edited with `e`, applied to the tui profile's
 * cordis.patch.yml `compaction-basic` row — takes effect on next launch).
 * `null` = leave the dsh default untouched.
 */
const CONFIG_PARAMS = [
  { key: "contextWindow", label: "上下文窗口 (tokens)", min: 1000, max: 2000000, patchKey: "contextWindow" },
  { key: "compressThreshold", label: "压缩触发阈值 (0.05–1)", min: 0.05, max: 1, patchKey: "thresholdRatio" },
  { key: "compactRetainTokens", label: "压缩后保留 (tokens)", min: 100, max: 200000, patchKey: "retainTokens" },
  { key: "autoCompact", label: "自动压缩 (true/false)", bool: true, patchKey: "auto" },
];
const DEFAULT_CONFIG = {
  turns: true, steps: true, llmMs: true, toolMs: true, cache: true, tps: true,
  disabledPlugins: [],
  contextWindow: null, compressThreshold: null, compactRetainTokens: null, autoCompact: null,
};
const CONFIG_PATH = join(
  process.env.DSH_HOME ?? join(process.env.HOME ?? "/root", ".dsh"),
  "profiles",
  "tui",
  "tui-config.json"
);

/** Plugins that must never be toggled off (TUI itself + core services). */
const PROTECTED_PLUGINS = new Set([
  "dsh-tui-app", "tui-runner", "tui-startup",
  "@deepseek-ai/dsh-agent", "@deepseek-ai/dsh-session", "@deepseek-ai/dsh-llm",
  "@deepseek-ai/dsh-settings-file", "@deepseek-ai/cordis-plugin-loader",
  "@deepseek-ai/dsh-app-boot", "@deepseek-ai/dsh-agent-loop",
  "@deepseek-ai/dsh-session-persistence-jsonl",
]);
const isBuiltin = (name) => name.startsWith("@deepseek-ai/");

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

/**
 * Write the /config session parameters into the tui profile's
 * cordis.patch.yml (`compaction-basic` row, last-write-wins by id).
 * Takes effect on the next dsh launch. Keys with null values are skipped.
 */
const TUI_PATCH_PATH = join(
  process.env.DSH_HOME ?? join(process.env.HOME ?? "/root", ".dsh"),
  "profiles", "tui", "cordis.patch.yml"
);

function updateCompactionPatch(config) {
  try {
    const active = CONFIG_PARAMS
      .filter((p) => config[p.key] != null)
      .map((p) => [p.patchKey, config[p.key]]);
    if (active.length === 0) return; // all defaults — nothing to write
    let patch = "";
    try { patch = readFileSync(TUI_PATCH_PATH, "utf8"); } catch { /* new file */ }
    const lines = patch.length > 0 ? patch.split("\n") : [];
    // Locate the existing compaction-basic row (and its config block).
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("id: compaction-basic")) { start = i; break; }
    }
    // Swallow our own preceding marker comments/blank lines so repeated
    // edits don't leave duplicated "# dsh-tui /config" headers behind.
    if (start >= 0) {
      let k = start - 1;
      while (k >= 0 && (lines[k].startsWith("# dsh-tui /config") || lines[k].trim() === "")) k--;
      start = k + 1;
    }
    let end = lines.length;
    if (start >= 0) {
      for (let j = start + 1; j < lines.length; j++) {
        if (lines[j].trimStart().startsWith("- id:") && !lines[j].includes("compaction-basic")) {
          end = j;
          break;
        }
      }
    }
    const block = [
      "# dsh-tui /config 会话参数（TUI 生成，重启生效）",
      "- id: compaction-basic",
      "  config:",
      ...active.map(([k, v]) => `    ${k}: ${typeof v === "boolean" ? (v ? "true" : "false") : v}`),
    ];
    if (start >= 0) lines.splice(start, end - start, ...block);
    else {
      if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
      lines.push(...block);
    }
    writeFileSync(TUI_PATCH_PATH, lines.join("\n") + "\n");
  } catch (err) {
    /* best-effort: config still persisted in tui-config.json */
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
  let { agent, dispose } = handle;
  await agent.whenIdle();

  /** Create (or resume) an agent; used for the initial session and tab switches. */
  const makeAgent = async (sessionId) => {
    let h;
    let resumedFlag = false;
    if (sessionId !== void 0 && sessionId !== "") {
      h = await agents.resume({ resumeSessionId: sessionId, agentOptions, setup });
      resumedFlag = true;
    } else {
      h = await agents.create({
        sessionId: SessionId(`session-${randomUUID()}`),
        meta: { cwd: process.cwd() },
        agentOptions,
        setup,
      });
    }
    await h.agent.whenIdle();
    return { agent: h.agent, dispose: h.dispose, resumed: resumedFlag };
  };

  let input = null;
  let instance = null;
  let submitting = false;
  const deferQueue = []; // busy 时排队的命令，回合结束自动执行（flushDeferred）
  let switching = false; // tab-switch mutex

  // Brick-extension seam: the tuiExtensions service is provided by the
  // dsh-tui-bridge brick (zero-dependency, activates first). Companion bricks
  // (dsh-tui-compact/usage/...) register commands/panels/fields/themes/hooks.
  const ext = ctx.get("tuiExtensions");
  // Restore the persisted theme (config.theme), then expose bricks' themes.
  setTheme(loadConfig().theme);
  const store = createStore(
    {
      events: [],
      meta: {
        model: selection.model,
        provider: selection.provider,
        sessionId: agent.session.id,
        cwd: agent.session.header.cwd ?? process.cwd(),
        resumed,
        mode: null,
        skills: undefined,
        plugins: undefined,
      },
      theme: themeName(),
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
      jobsPanel: null, // { jobs, selected, logText } while /jobs is open
      lastAssistantId: null, // newest assistant message id (for /feedback)
      tabs: [{ id: "t0", sessionId: agent.session.id, title: "会话 1" }],
      activeTab: 0,
      fold: "collapsed",
    },
    // Every store change re-renders the tree through Ink directly (React
    // effects don't run reliably in this environment).
    () => {
      if (instance) instance.rerender(h(App, { store, ctl }));
    }
  );

  // Apply persisted plugin unloads (disabledPlugins from tui-config.json).
  (async () => {
    const disabledList = loadConfig().disabledPlugins ?? [];
    if (disabledList.length === 0) return;
    const loaderSvc = ctx.get("loader");
    if (!loaderSvc?.entries) return;
    for (const e of loaderSvc.entries()) {
      if (disabledList.includes(e?.options?.name) && !PROTECTED_PLUGINS.has(e?.options?.name)) {
        try {
          await e.update({ disabled: true });
        } catch {
          /* keep going */
        }
      }
    }
  })();

  const projections = ctx.get("sessionProjections");
  const presets = ctx.get("agentPresets");
  const notice = (tone, text) => {
    store.set({ events: [...store.get().events, { kind: "notice", tone, text }] });
  };
  if (presets?.defaultId) store.set({ modeCurrent: presets.defaultId });

  // Splash stats: mode name, skill count, plugin row count (best-effort).
  (async () => {
    const meta = { ...store.get().meta };
    if (presets?.defaultId) {
      try {
        const roster = await presets.list();
        const cur = roster.find((p) => p.id === presets.defaultId);
        meta.mode = cur?.name ?? presets.defaultId;
      } catch {
        meta.mode = presets.defaultId;
      }
    }
    const skillSvc = ctx.get("skills");
    if (skillSvc?.list) {
      try {
        const r = await skillSvc.list();
        meta.skills = Array.isArray(r) ? r.length : r?.candidates?.length ?? 0;
      } catch {
        meta.skills = 0;
      }
    }
    const loader = ctx.get("loader");
    if (loader?.entries) {
      try {
        meta.plugins = [...loader.entries()].length;
      } catch {
        meta.plugins = 0;
      }
    }
    store.set({ meta });
  })();
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
          totalTokens: (u?.cacheReadTokens ?? 0) + (u?.uncachedInputTokens ?? 0) + (u?.outputTokens ?? 0),
          toolCalls: store.get().stats?.toolCalls ?? 0,
        },
      });
    } catch {
      /* projection seam unavailable */
    }
  };

  // Batching: stream events can arrive at token rate (dozens/sec); rendering
  // the whole tree per event is the main throughput killer. Accumulate for a
  // short window and commit one store.set (one Ink rerender) per batch.
  let pendingEvents = [];
  let flushTimer = null;
  const flushPending = () => {
    flushTimer = null;
    if (pendingEvents.length === 0) return;
    const evs = pendingEvents;
    pendingEvents = [];
    const s = store.get();
    store.set({ events: [...s.events, ...evs] });
    let toolCalls = s.stats?.toolCalls ?? 0;
    for (const ev of evs) {
      if (ev.kind === "tool-start") toolCalls += 1;
      if (ev.kind === "assistant" && ev.id) store.set({ lastAssistantId: ev.id });
    }
    if (toolCalls !== (s.stats?.toolCalls ?? 0)) store.set({ stats: { ...s.stats, toolCalls } });
    refreshStats();
  };

  const setBusyState = (b) => {
    if (input) input.setBusy(b);
    store.set({ input: { ...store.get().input, busy: b } });
  };

  let channel = createChannel(agent, (ev) => {
    // Turn edges must not wait for the 50ms batch: Ctrl+C routing depends on
    // the input layer's busy flag matching the agent's real turn state (a
    // stale flag previously turned Ctrl+C into /quit while the agent ran).
    if (ev.kind === "turn-start") setBusyState(true);
    else if (ev.kind === "turn-end") setBusyState(false);
    pendingEvents.push(ev);
    if (flushTimer === null) flushTimer = setTimeout(flushPending, 50);
  });
  const makeChannel = (agentRef) =>
    createChannel(agentRef, (ev) => {
      if (ev.kind === "turn-start") setBusyState(true);
      else if (ev.kind === "turn-end") setBusyState(false);
      pendingEvents.push(ev);
      if (flushTimer === null) flushTimer = setTimeout(flushPending, 50);
    });
  refreshStats();

  // Subagent lifecycle edges surface in the transcript as notices.
  const subagentUnsub = [];
  for (const evt of ["subagent/start", "subagent/end"]) {
    subagentUnsub.push(
      agent.ctx.on(evt, (_s, info) => {
        const name = info?.agentId ?? info?.id ?? "subagent";
        if (evt === "subagent/start") {
          notice("info", `子代理启动: ${name}${info?.mode ? ` (${info.mode})` : ""}`);
        } else {
          notice("info", `子代理完成: ${name}`);
        }
      })
    );
  }

  // Goal progress surfaces as transcript notices (P4 lightweight view).
  let goalUnsub = agent.ctx.on("goal/changed", (_s, { change }) => {
    const g = change?.goal ?? change;
    if (!g) return;
    const phase = g.phase ?? change?.phase ?? "";
    const text = g.text ?? g.goal ?? "";
    const blocked = g.blockedReason ?? change?.blockedReason;
    notice(
      phase === "blocked" ? "warning" : "info",
      `目标${phase === "blocked" ? "受阻" : phase ? `（${phase}）` : ""}: ${String(text).slice(0, 80)}${blocked ? ` — ${String(blocked).slice(0, 60)}` : ""}`
    );
  });

  /**
   * 回合结束后的排队命令自动执行（并行分诊的落地点）。
   * 逐条复用 onSubmit 的命令路由；若执行中触发了新回合（如 /undo 重发输入），
   * 剩余命令放回队首，等下一次回合结束再继续。
   * 必须定义在 run() 内（访问 deferQueue/submitting/store/onSubmit 闭包）。
   */
  const flushDeferred = async () => {
    if (deferQueue.length === 0) return;
    const batch = deferQueue.splice(0);
    store.set({ pendingCount: deferQueue.length });
    for (const line of batch) {
      if (submitting) {
        const rest = batch.slice(batch.indexOf(line));
        deferQueue.unshift(...rest);
        store.set({ pendingCount: deferQueue.length });
        return;
      }
      try {
        await handleSubmit(line);
      } catch {
        /* 单条失败不影响后续 */
      }
    }
  };

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
        // Alt+Enter / brick queued sends reuse submit(); leave the box empty
        // afterwards (previously the text stayed and polluted the next command).
        input?.setBuffer("");
        store.set({ input: { ...store.get().input, buffer: "", cursor: 0 } });
        flushDeferred(); // 回合完成：自动执行排队命令（不阻塞 submit 返回）
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
    onSuggestionNav: (delta) => {
      const { suggestions } = store.get().input;
      if (suggestions?.length) {
        // menu panels win; else move the completion selection
        if (store.get().extPanel) ctl.extNav(delta);
        else if (store.get().jobsPanel) ctl.jobsNav(delta);
        else if (store.get().modeMenu) ctl.modeNav(delta);
        else if (store.get().modelMenu) ctl.modelNav(delta);
        else if (store.get().configMenu) ctl.configNav(delta);
        else {
          const { selected } = store.get().input;
          const n = suggestions.length;
          const next = (((selected ?? 0) + delta) % n + n) % n;
          store.set({ input: { ...store.get().input, selected: next } });
        }
      } else {
        // no candidates: browse command history
        input.historyNav(delta);
      }
    },
    /* -------- brick extension seam -------- */
    notice(tone, text) {
      store.set({ events: [...store.get().events, { kind: "notice", tone, text: String(text) }] });
    },
    extStatusFields() {
      const out = [];
      for (const f of [...ext.statusFields.values()].sort((a, b) => a.order - b.order)) {
        try {
          const s = f.render(store.get());
          if (typeof s === "string" && s.length) out.push(s);
        } catch { /* a broken field must never break the status bar */ }
      }
      return out;
    },
    async openExtPanel(id) {
      const def = ext.panels.get(id);
      if (!def) {
        notice("error", `扩展面板不存在: ${id}`);
        return;
      }
      store.set({ extPanel: { id, title: def.title, lines: ["加载中…"], scroll: 0, selected: 0 } });
      input?.setMenu("ext");
      try {
        const res = await def.load(store.get());
        const lines = Array.isArray(res?.lines) ? res.lines : [String(res ?? "")];
        store.set({ extPanel: { id, title: def.title, lines, scroll: 0, selected: 0 } });
      } catch (err) {
        store.set({ extPanel: { id, title: def.title, lines: [`加载失败: ${err.message}`], scroll: 0, selected: 0 } });
      }
    },
    closeExtPanel() {
      store.set({ extPanel: null });
      input?.setMenu(null);
    },
    extNav(delta) {
      const p = store.get().extPanel;
      if (!p) return;
      const total = p.lines?.length || 0;
      const max = Math.max(0, total - 24);
      const scroll = Math.max(0, Math.min(max, (p.scroll || 0) + delta));
      const selected = Math.max(0, Math.min(23, (p.selected || 0) + delta));
      store.set({ extPanel: { ...p, scroll, selected } });
    },
    extConfirm() {
      const p = store.get().extPanel;
      if (!p) return;
      const def = ext.panels.get(p.id);
      const line = p.lines?.[(p.selected ?? 0) + (p.scroll ?? 0)];
      if (def && typeof def.confirm === "function") {
        try { def.confirm(line, ctl, store); } catch (e) { notice("error", `面板动作失败: ${e.message}`); }
      } else {
        ctl.closeExtPanel();
      }
    },
    leaderKey(key) {
      const fn = ext.inputHooks.onLeader.get(key);
      if (fn) fn({ ctl, store });
      else notice("warning", `leader 未绑定: ctrl+x ${key}（/help 查看）`);
    },
    doubleEsc() {
      for (const fn of ext.inputHooks.onDoubleEsc) {
        try { fn({ ctl, store }); } catch (e) { notice("error", `hook 失败: ${e.message}`); }
      }
    },
    altEnter(text) {
      for (const fn of ext.inputHooks.onAltEnter) {
        try { fn(String(text || ""), { ctl, store }); } catch (e) { notice("error", `hook 失败: ${e.message}`); }
      }
    },
    altUp() {
      for (const fn of ext.inputHooks.onAltUp) {
        try { fn({ ctl, store }); } catch (e) { notice("error", `hook 失败: ${e.message}`); }
      }
    },
    applyTheme(name) {
      const registered = ext.themes.has(name);
      if (!registered && !["deep", "light"].includes(name)) {
        notice("error", `主题不存在: ${name}（可用: ${listThemes().join(", ")}）`);
        return;
      }
      setTheme(name);
      const config = { ...loadConfig(), theme: name };
      saveConfig(config);
      store.set({ config, theme: themeName() });
      notice("info", `主题已切换: ${name}`);
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
      const n = CONFIG_ITEMS.length + CONFIG_PARAMS.length;
      const next = (((menu.selected ?? 0) + delta) % n + n) % n;
      store.set({ configMenu: { selected: next, editing: false, editKey: null, editBuffer: "" } });
    },
    configToggle() {
      const menu = store.get().configMenu;
      if (!menu) return;
      const idx = menu.selected ?? 0;
      if (idx >= CONFIG_ITEMS.length) {
        notice("info", "会话参数用 e 编辑（回车确认，esc 取消，清空恢复默认）");
        return;
      }
      const key = CONFIG_ITEMS[idx].key;
      const config = { ...store.get().config, [key]: !store.get().config[key] };
      saveConfig(config);
      store.set({ config });
    },
    configEdit() {
      const menu = store.get().configMenu;
      if (!menu) return;
      const idx = menu.selected ?? 0;
      if (idx < CONFIG_ITEMS.length) {
        notice("info", "显示开关用空格切换");
        return;
      }
      const param = CONFIG_PARAMS[idx - CONFIG_ITEMS.length];
      const cur = store.get().config[param.key];
      const buf = cur == null ? "" : String(cur);
      input?.setConfigEdit(param.key, buf);
      store.set({ configMenu: { ...menu, editing: true, editKey: param.key, editBuffer: buf } });
    },
    configEditChange(buffer) {
      const menu = store.get().configMenu;
      if (!menu) return;
      store.set({ configMenu: { ...menu, editBuffer: buffer } });
    },
    configEditSubmit(buffer) {
      const menu = store.get().configMenu;
      if (!menu) return;
      const param = CONFIG_PARAMS.find((p) => p.key === menu.editKey);
      if (!param) return;
      const text = String(buffer ?? "").trim();
      let value;
      if (text === "") {
        value = null; // restore default
      } else if (param.bool) {
        if (!/^(true|false|1|0|on|off|yes|no)$/i.test(text)) {
          notice("error", `请输入 true/false（或 1/0/on/off）`);
          return;
        }
        value = /^(true|1|on|yes)$/i.test(text);
      } else {
        value = Number(text);
        if (!Number.isFinite(value)) {
          notice("error", `请输入数字（${param.min}–${param.max}）`);
          return;
        }
        value = Math.min(param.max, Math.max(param.min, value));
      }
      const config = { ...store.get().config, [param.key]: value };
      saveConfig(config);
      updateCompactionPatch(config);
      input?.setConfigEdit(null, "");
      store.set({
        configMenu: { ...menu, editing: false, editKey: null, editBuffer: "" },
        config,
      });
      notice(
        "info",
        `已设置 ${param.label} = ${value == null ? "默认（dsh 内置）" : value}。重启 dsh 后生效（已写入 tui profile 的 cordis.patch.yml）`
      );
    },
    configEditCancel() {
      const menu = store.get().configMenu;
      if (!menu) return;
      input?.setConfigEdit(null, "");
      store.set({ configMenu: { ...menu, editing: false, editKey: null, editBuffer: "" } });
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
        const when = submitting ? "当前对话完成后自动起效" : "新会话生效";
        notice("info", `模式已切换为「${item.name ?? item.id}」— ${when}`);
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
      // listModels 的 modelInfo() 不带 contextWindow（内核 adapter 实现）——
      // 逐模型 resolveModelInfo 补真实窗口（adapter configured ?? defaultContextWindow）。
      const items = [];
      for (const m of list) {
        let cw = m.contextWindow ?? m.context?.contextWindow;
        if (!cw && llm.resolveModelInfo) {
          try {
            const info = await llm.resolveModelInfo(selection.provider, m.id);
            cw = info?.context?.contextWindow;
          } catch { /* keep undefined */ }
        }
        items.push({ id: m.id, name: m.name ?? m.id, contextWindow: cw });
      }
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
        const when = submitting ? "当前对话完成后自动起效" : "新会话生效";
        notice("info", `模型已切换为 ${item.id}（推理力度 ${menu.effort}）— ${when}`);
      } catch (error) {
        notice("error", `切换失败: ${error.message}`);
      }
      ctl.closeModel();
    },
    // jobs panel (/jobs): list + live updates + log + kill.
    openJobs() {
      const jobs = ctx.get("jobs");
      if (!jobs) {
        notice("error", "jobs service unavailable");
        return;
      }
      input?.setMenu("jobs");
      store.set({ jobsPanel: { jobs: [], selected: 0, logText: "" } });
      ctl.refreshJobs();
      ctl.jobsUnsub = jobs.onJobsChanged?.(() => ctl.refreshJobs());
    },
    refreshJobs() {
      const jobs = ctx.get("jobs");
      if (!jobs || !store.get().jobsPanel) return;
      try {
        // Pass the agent as caller so jobs owned by this session are visible
        // (list() without a caller only returns owner-less jobs).
        const list = jobs.list(agent);
        const now = Date.now();
        store.set({
          jobsPanel: {
            ...store.get().jobsPanel,
            jobs: list.map((j) => ({
              id: j.id,
              kind: j.kind ?? "",
              status: j.status ?? "",
              ageMs: j.createdAt ? now - j.createdAt : 0,
            })),
          },
        });
      } catch {
        /* keep last state */
      }
    },
    closeJobs() {
      ctl.jobsUnsub?.();
      input?.setMenu(null);
      store.set({ jobsPanel: null });
    },
    // /goal [<objective>]: with text = create & arm the goal (the round
    // driver picks it up automatically); without = show current state.
    async goalCmd(objective) {
      const goals = ctx.get("goals");
      if (!goals?.get || !goals.create) {
        notice("error", "goal 服务不可用");
        return;
      }
      if (objective) {
        try {
          const g = goals.create(agent, { objective });
          notice(
            "info",
            `🎯 目标已设定: ${String(g.objective ?? objective).slice(0, 120)}（agent 将自动执行）`
          );
        } catch (error) {
          notice("error", `设定目标失败: ${error.message}`);
        }
        return;
      }
      try {
        const g = goals.get(agent);
        if (!g) {
          notice("info", "当前无活跃目标 — 用法: /goal <要完成的事>");
          return;
        }
        const phase = g.phase ?? "running";
        const rounds = g.roundsStarted ?? 0;
        const cap = g.maxGoalRounds ?? "∞";
        const lines = [
          `目标: ${String(g.objective ?? "").slice(0, 120)}`,
          `阶段: ${phase}  轮次: ${rounds}/${cap}${g.blockedReason ? `  受阻: ${String(g.blockedReason).slice(0, 60)}` : ""}`,
          `更新: ${new Date(g.updatedAt ?? Date.now()).toLocaleTimeString()}`,
        ];
        notice("info", `🎯 目标状态:\n${lines.map((l) => `  ${l}`).join("\n")}`);
      } catch (error) {
        notice("error", `读取目标失败: ${error.message}`);
      }
    },
    jobsNav(delta) {
      const menu = store.get().jobsPanel;
      if (!menu || !menu.jobs?.length) return;
      const n = menu.jobs.length;
      const next = (((menu.selected ?? 0) + delta) % n + n) % n;
      store.set({ jobsPanel: { ...menu, selected: next, logText: "" } });
    },
    async jobsToggleLog() {
      const menu = store.get().jobsPanel;
      if (!menu || !menu.jobs?.length) return;
      const job = menu.jobs[menu.selected ?? 0];
      const jobs = ctx.get("jobs");
      if (!jobs) return;
      try {
        const { text } = jobs.read(job.id, agent);
        store.set({
          jobsPanel: {
            ...menu,
            logText: menu.logText === "" ? (text || "(no output)") : "",
          },
        });
      } catch (error) {
        store.set({ jobsPanel: { ...menu, logText: `(read failed: ${error.message})` } });
      }
    },
    jobsKill() {
      const menu = store.get().jobsPanel;
      if (!menu || !menu.jobs?.length) return;
      const job = menu.jobs[menu.selected ?? 0];
      const jobs = ctx.get("jobs");
      if (!jobs) return;
      try {
        jobs.kill(job.id, agent, "killed from tui /jobs panel");
        notice("info", `已停止任务 ${job.id}`);
      } catch (error) {
        notice("error", `停止失败: ${error.message}`);
      }
      ctl.refreshJobs();
    },
    // agent; switching persists the current one and re-attaches listeners).
    async switchTab(i) {
      if (switching) {
        notice("warning", "正在切换中，请稍候");
        return;
      }
      const s = store.get();
      const tabs = s.tabs;
      if (!tabs[i] || i === s.activeTab) return;
      if (submitting) {
        notice("warning", "agent 正忙，先 Ctrl+C 再切换");
        return;
      }
      switching = true;
      const target = tabs[i];
      notice("info", `切换到会话 ${target.sessionId.slice(0, 16)}…`);
      try {
        await sessions.flush(agent.session);
        channel.detach();
        for (const u of subagentUnsub) u();
        subagentUnsub.length = 0;
        goalUnsub?.();
        await dispose();
        const h = await makeAgent(target.sessionId);
        agent = h.agent;
        dispose = h.dispose;
        // re-attach listeners to the new agent
        channel = makeChannel(agent);
        for (const evt of ["subagent/start", "subagent/end"]) {
          subagentUnsub.push(
            agent.ctx.on(evt, (_s2, info) => {
              const name = info?.agentId ?? info?.id ?? "subagent";
              notice("info", `${evt === "subagent/start" ? "子代理启动" : "子代理完成"}: ${name}`);
            })
          );
        }
        goalUnsub = agent.ctx.on("goal/changed", (_s2, { change }) => {
          const g = change?.goal ?? change;
          if (!g) return;
          notice("info", `目标: ${String(g.text ?? g.goal ?? "").slice(0, 80)}`);
        });
        store.set({
          activeTab: i,
          meta: {
            ...store.get().meta,
            sessionId: agent.session.id,
            cwd: agent.session.header.cwd ?? process.cwd(),
            resumed: true,
          },
          events: [],
          stats: {
            turns: 0, steps: 0, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0,
            decodeMs: 0, decodeTokens: 0, cacheRead: 0, uncachedInput: 0,
          },
          lastAssistantId: null,
        });
        refreshStats();
        notice("info", `已切换到 ${target.sessionId}`);
      } catch (error) {
        notice("error", `切换失败: ${error.message}`);
      } finally {
        switching = false;
      }
    },
    async newTab() {
      if (submitting) {
        notice("warning", "agent 正忙，先 Ctrl+C 再新建会话");
        return;
      }
      try {
        await sessions.flush(agent.session);
        channel.detach();
        for (const u of subagentUnsub) u();
        subagentUnsub.length = 0;
        goalUnsub?.();
        await dispose();
        const h = await makeAgent(undefined);
        agent = h.agent;
        dispose = h.dispose;
        channel = makeChannel(agent);
        for (const evt of ["subagent/start", "subagent/end"]) {
          subagentUnsub.push(
            agent.ctx.on(evt, (_s2, info) => {
              const name = info?.agentId ?? info?.id ?? "subagent";
              notice("info", `${evt === "subagent/start" ? "子代理启动" : "子代理完成"}: ${name}`);
            })
          );
        }
        goalUnsub = agent.ctx.on("goal/changed", (_s2, { change }) => {
          const g = change?.goal ?? change;
          if (!g) return;
          notice("info", `目标: ${String(g.text ?? g.goal ?? "").slice(0, 80)}`);
        });
        const tabs = [...store.get().tabs, { id: `t${store.get().tabs.length}`, sessionId: agent.session.id, title: `会话 ${store.get().tabs.length + 1}` }];
        store.set({
          tabs,
          activeTab: tabs.length - 1,
          meta: {
            ...store.get().meta,
            sessionId: agent.session.id,
            cwd: agent.session.header.cwd ?? process.cwd(),
            resumed: false,
          },
          events: [],
          stats: {
            turns: 0, steps: 0, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0,
            decodeMs: 0, decodeTokens: 0, cacheRead: 0, uncachedInput: 0,
          },
          lastAssistantId: null,
        });
        refreshStats();
      } catch (error) {
        notice("error", `新建会话失败: ${error.message}`);
      }
    },
    openPlugins() {
      const loader = ctx.get("loader");
      if (!loader?.entries) {
        notice("error", "loader 不可用");
        return;
      }
      const map = new Map();
      try {
        for (const e of loader.entries()) {
          const name = e?.options?.name ?? e?.options?.id ?? "?";
          const rec = map.get(name) ?? { name, count: 0, disabled: 0, ids: [], entries: [] };
          rec.count += 1;
          if (e?.options?.disabled) rec.disabled += 1;
          rec.ids.push(e?.options?.id ?? "");
          rec.entries.push(e);
          map.set(name, rec);
        }
      } catch (error) {
        notice("error", `读取插件失败: ${error.message}`);
        return;
      }
      const all = [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
      const builtin = all.filter((p) => isBuiltin(p.name));
      const user = all.filter((p) => !isBuiltin(p.name));
      input?.setMenu("plugins");
      store.set({ pluginsPanel: { builtin, user, selected: 0, detail: "" } });
    },
    closePlugins() {
      input?.setMenu(null);
      store.set({ pluginsPanel: null });
    },
    pluginsNav(delta) {
      const menu = store.get().pluginsPanel;
      if (!menu) return;
      const list = menu.section === 0 ? menu.builtin : menu.user;
      const n = list?.length ?? 0;
      if (n === 0) return;
      const next = (((menu.selected ?? 0) + delta) % n + n) % n;
      store.set({ pluginsPanel: { ...menu, selected: next, detail: "" } });
    },
    pluginsSectionNav(delta) {
      const menu = store.get().pluginsPanel;
      if (!menu) return;
      const nSections = 2;
      const next = (((menu.section ?? 0) + delta) % nSections + nSections) % nSections;
      store.set({ pluginsPanel: { ...menu, section: next, selected: 0, detail: "" } });
    },
    pluginsDetail() {
      const menu = store.get().pluginsPanel;
      if (!menu) return;
      const p = ctl.pluginsAt(menu.selected ?? 0);
      if (!p) return;
      store.set({
        pluginsPanel: {
          ...menu,
          detail: menu.detail === "" ? `行: ${p.ids.join(", ")}` : "",
        },
      });
    },
    pluginsAt(i) {
      const menu = store.get().pluginsPanel;
      if (!menu) return null;
      const list = menu.section === 0 ? menu.builtin : menu.user;
      return list?.[i] ?? null;
    },
    async pluginsToggle() {
      const menu = store.get().pluginsPanel;
      if (!menu) return;
      const p = ctl.pluginsAt(menu.selected ?? 0);
      if (!p) return;
      if (PROTECTED_PLUGINS.has(p.name)) {
        notice("warning", `${p.name} 为核心插件，不可卸载`);
        return;
      }
      const wantEnabled = p.disabled > 0; // currently (partly) disabled -> load
      const disabledList = [...(loadConfig().disabledPlugins ?? [])];
      try {
        for (const e of p.entries) {
          await e.update({ disabled: !wantEnabled });
        }
        if (wantEnabled) {
          const i = disabledList.indexOf(p.name);
          if (i >= 0) disabledList.splice(i, 1);
        } else if (!disabledList.includes(p.name)) {
          disabledList.push(p.name);
        }
        const cfg = { ...store.get().config, disabledPlugins: disabledList };
        saveConfig(cfg);
        store.set({ config: cfg });
        notice("info", `${wantEnabled ? "已加载" : "已卸载"} ${p.name}`);
        ctl.openPlugins();
      } catch (error) {
        notice("error", `切换失败: ${error.message}`);
      }
    },
    // /new: start a fresh conversation (same as a new tab).
    newConversation() {
      ctl.newTab();
    },
    exit() {
      store.set({ input: { ...store.get().input, busy: false } });
      input?.stop();
      channel.detach();
      instance?.unmount();
      // Let Ink flush its last frame, then print the farewell below it.
      setTimeout(() => {
        io.stdout.write("bye.\n");
        // io.exit(0) is the launcher's bounded whole-tree shutdown (it arms a
        // 5s force-exit fallback). Agent-handle dispose() can hang in some
        // compositions; never let agent teardown block the exit path.
        io.exit(0);
        dispose().catch(() => {});
        // Root cause of the observed /quit hang: stdin stays open (raw mode
        // resumed, no EOF on a PTY) and holds the event loop forever even
        // after the tree disposed and exitCode was set. Close it explicitly,
        // plus an unref'd hard-exit safety net in case anything else lingers.
        try { process.stdin.pause(); process.stdin.destroy(); } catch { /* ignore */ }
        setTimeout(() => process.exit(0), 3000).unref();
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
  // 提交路由独立成 run() 内函数：input 配置与 flushDeferred（回合结束自动执行
  // 排队命令）共用。不能定义在对象字面量属性里——flushDeferred 无法引用它。
  const handleSubmit = async (text) => {
    const trimmed = text.trim();
    input.historyPush(trimmed);
    if (trimmed.startsWith("/")) {
      const [command] = trimmed.split(/\s+/);
      // 并行分诊：busy 时触碰会话状态的命令 → 排队，回合结束自动执行
      if (submitting && DEFER_UNTIL_IDLE.has(command)) {
        if (!deferQueue.includes(trimmed)) {
          deferQueue.push(trimmed);
          notice("info", `⏳ ${command} 已排队：当前对话完成后自动执行（Ctrl+C 可提前结束回合）`);
          store.set({ pendingCount: deferQueue.length });
        }
        return;
      }
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
      if (command === "/jobs") {
        ctl.openJobs();
        return;
      }
      if (command === "/tab") {
        const arg = trimmed.slice("/tab".length).trim();
        if (arg === "new") {
          ctl.newTab();
        } else if (/^\d+$/.test(arg)) {
          ctl.switchTab(parseInt(arg, 10) - 1);
        } else {
          notice("warning", "用法: /tab new | /tab <编号>（PgUp/PgDn 循环切换）");
        }
        return;
      }
      if (command === "/new") {
        ctl.newConversation();
        return;
      }
      if (command === "/plugins") {
        ctl.openPlugins();
        return;
      }
      // dsh 后台命令桥（优先于 brick）：ctx.commands 注册的官方命令
      // （/goal /compact /feedback /plan …）自动接到 TUI。busy 也允许——
      // 它们独立执行、不占 agent turn。
      const dshCommands = ctx.get("commands");
      if (dshCommands?.execute && dshCommands?.list?.(agent)?.some((d) => d.name === command.slice(1))) {
        const busyAtExec = submitting; // 执行前快照，用于"完成后起效"告知
        try {
          const exec = await dshCommands.execute(
            agent,
            trimmed,
            AbortSignal.timeout(60000)
          );
          if (exec) {
            const r = exec.result;
            let text =
              r?.text ?? (r?.kind === "success" ? "✓ 完成" : r?.kind === "show" ? "" : JSON.stringify(r));
            if (busyAtExec && DEFER_NOTIFY.has(command)) {
              text += text ? "\n（当前对话完成后自动起效）" : "（当前对话完成后自动起效）";
            }
            if (text) notice("info", text);
            return;
          }
        } catch (e) {
          notice("error", `${command} 失败: ${e.message}`);
          return;
        }
      }
      // brick-extension commands (dsh-tui-compact/usage/...) — busy 也并行执行
      const brick = ext.commands.get(command);
      if (brick) {
        try {
          // Handlers receive the store handle PLUS a flat snapshot of the
          // current state: store.set() stays available for panels, while
          // store.meta / store.stats / store.theme read the live values
          // (the bare store object exposes only get/set/subscribe).
          brick.handler(trimmed, ctl, { ...store, ...store.get() });
        } catch (e) {
          notice("error", `${command} 失败: ${e.message}`);
        }
        return;
      }
      handleCommand(ctx, agent, command, trimmed, store, io);
      return;
    }
    if (submitting) {
      notice("warning", "agent 正忙（Ctrl+C 可中断）");
      return;
    }
    // brick onSubmit hooks (e.g. A2A @agent dispatch); true = consumed.
    for (const fn of ext.inputHooks.onSubmit) {
      try {
        if (fn(trimmed, { ctl, store }) === true) return;
      } catch (e) {
        notice("error", `输入 hook 失败: ${e.message}`);
      }
    }
    ctl.submit(text);
  };

  input = new Input(io.stdin, {
    onChange: ({ buffer, cursor, vim }) => {
      // Live completion: recompute candidates on every edit.
      const suggestions = input.suggestionsFor(buffer);
      store.set({
        input: { ...store.get().input, buffer, cursor, vim, suggestions, selected: 0 },
      });
    },
    onSubmit: handleSubmit,
    onInterrupt: () => ctl.interrupt(),
    onQuit: () => ctl.exit(),
    onSuggestion: () => ctl.onSuggestion(),
    onSuggestionNav: (delta) => ctl.onSuggestionNav(delta),
    onCycleFold: () => ctl.cycleFold(),
    onTabSwitch: (delta) => ctl.onTabSwitch(delta),
    // brick-extension input hooks
    onLeaderKey: (key) => ctl.leaderKey(key),
    onDoubleEsc: () => ctl.doubleEsc(),
    onAltEnter: (text) => ctl.altEnter(text),
    onAltUp: () => ctl.altUp(),
    // Unified menu callbacks: route by which menu is open.
    onMenuNav: (delta) => {
      if (store.get().extPanel) ctl.extNav(delta);
      else if (store.get().pluginsPanel) ctl.pluginsNav(delta);
      else if (store.get().jobsPanel) ctl.jobsNav(delta);
      else if (store.get().modeMenu) ctl.modeNav(delta);
      else if (store.get().modelMenu) ctl.modelNav(delta);
      else if (store.get().configMenu) ctl.configNav(delta);
    },
    onMenuToggle: () => {
      if (store.get().extPanel) ctl.extConfirm();
      else if (store.get().pluginsPanel) ctl.pluginsDetail();
      else if (store.get().jobsPanel) ctl.jobsToggleLog();
      else if (store.get().modeMenu) ctl.modeSelect();
      else if (store.get().modelMenu) ctl.modelSelect();
      else if (store.get().configMenu) ctl.configToggle();
    },
    onMenuConfirm: () => {
      if (store.get().extPanel) ctl.extConfirm();
    },
    onMenuExtra: () => {
      if (store.get().pluginsPanel) ctl.pluginsToggle();
      else if (store.get().configMenu) ctl.configEdit();
      else if (store.get().jobsPanel) ctl.jobsKill();
      else if (store.get().modelMenu) ctl.modelToggleEffort();
    },
    onMenuClose: () => {
      if (store.get().extPanel) ctl.closeExtPanel();
      else if (store.get().pluginsPanel) ctl.closePlugins();
      else if (store.get().jobsPanel) ctl.closeJobs();
      else if (store.get().modeMenu) ctl.closeMode();
      else if (store.get().modelMenu) ctl.closeModel();
      else if (store.get().configMenu) ctl.closeConfig();
    },
    onConfigEditSubmit: (buffer) => ctl.configEditSubmit(buffer),
    onConfigEditCancel: () => ctl.configEditCancel(),
    onConfigEditChange: (buffer) => ctl.configEditChange(buffer),
    // ←→ in menus: plugins panel switches section; others ignore.
    onMenuSectionNav: (delta) => {
      if (store.get().pluginsPanel) ctl.pluginsSectionNav(delta);
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
    // PgUp/PgDn: cycle through tabs.
    onTabSwitch: (delta) => {
      const s = store.get();
      const n = s.tabs?.length ?? 0;
      if (n <= 1) return;
      const next = (((s.activeTab ?? 0) + delta) % n + n) % n;
      ctl.switchTab(next);
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
      // 核心命令 + 内核命令（ctx.commands）+ 积木命令（tuiExtensions）
      const names = new Set(COMMANDS);
      try {
        for (const d of ctx.get("commands")?.list?.(agent) ?? []) names.add(`/${d.name}`);
      } catch { /* ignore */ }
      for (const n of ext.commands.keys()) names.add(n);
      return [...names].filter((c) => c.startsWith(buffer)).sort();
    }
    if (buffer.startsWith("@")) {
      const q = buffer.slice(1);
      // Brick agent mentions (onSuggest, e.g. dsh-tui-a2a's @hermes/@claude)
      // merge with the core @file completion; brick candidates win the order.
      const names = [];
      for (const fn of ext.inputHooks.onSuggest) {
        try {
          for (const c of fn(buffer) ?? []) if (typeof c === "string" && c.trim() !== "") names.push(c);
        } catch { /* a broken suggester must not break completion */ }
      }
      let files = [];
      try {
        files = readdirSync(process.cwd())
          .filter((f) => f.startsWith(q))
          .slice(0, 8)
          .map((f) => `@${f}`);
      } catch {
        /* cwd unreadable */
      }
      return [...new Set([...names, ...files])].slice(0, 12);
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
function handleCommand(ctx, agent, command, full, store, io) {
  const notice = (tone, text) => {
    store.set({ events: [...store.get().events, { kind: "notice", tone, text }] });
  };
  switch (command) {
    case "/help": {
      const lines = ["commands:"];
      // 核心命令（本 TUI 自带）
      const core = [
        ["/help", "show this help"],
        ["/config", "status-bar display toggles (space to switch)"],
        ["/mode", "agent mode: standard/code/minimal/cordis (next session)"],
        ["/model", "switch model"],
        ["/new", "start a fresh conversation (new tab)"],
        ["/tab", "tab switch: new | <编号>（PgUp/PgDn 循环）"],
        ["/plugins", "plugin market (load/unload)"],
        ["/jobs", "list background jobs"],
        ["/sessions", "list persisted sessions"],
        ["/resume", "resume a past session（CLI: --resume <id>）"],
        ["/quit, /exit, /q", "quit"],
      ];
      lines.push("  核心:");
      for (const [n, d] of core) lines.push(`    ${n.padEnd(20)} ${d}`);
      // 内核命令（ctx.commands 注册，命令桥自动接管、不占 agent turn）
      const dshCommands = ctx.get("commands");
      let dshList = [];
      try {
        dshList = dshCommands?.list?.(agent) ?? [];
      } catch {
        dshList = [];
      }
      if (dshList.length > 0) {
        lines.push("  内核（命令桥直连）:");
        for (const d of dshList) {
          const hint = d.input?.hint ? ` <${d.input.hint}>` : "";
          lines.push(`    /${d.name}${hint}  ${d.description ?? ""}`.trimEnd());
        }
      }
      // 积木命令（tuiExtensions 注册）
      const ext = ctx.get("tuiExtensions");
      const brickNames = ext ? [...ext.commands.keys()].sort() : [];
      if (brickNames.length > 0) {
        lines.push("  积木:");
        for (const n of brickNames) {
          const def = ext.commands.get(n);
          lines.push(`    ${n.padEnd(20)} ${def?.description ?? ""}`.trimEnd());
        }
      }
      lines.push("");
      lines.push("typing:  multi-line (shift+enter) · vim mode (esc) · @file completion");
      lines.push("         Ctrl+O cycles tool-card folding · Ctrl+C interrupts a turn");
      notice("info", lines.join("\n"));
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
