/**
 * dsh-tui-app — interactive terminal chat driver.
 *
 * The bundle patch rides over dsh-base without Host, HTTP, or browser
 * plugins. This runner creates (or resumes) one Agent through the core
 * registry, subscribes to its live `session/event` stream for streaming
 * display of turns and tool calls, and runs a stdin loop of followup turns
 * against the same agent. Every turn is flushed to the session store, so a
 * later `dsh --profile tui --resume <sessionId>` continues the conversation.
 *
 * @module dsh-tui-app
 */

import { randomUUID } from "node:crypto";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import { Input, paint } from "./ui.js";

/** Stable Cordis plugin name. */
export const name = "tui-runner";

/** Core services required before the interactive run can start. */
export const inject = ["tuiStartup"];

/** Prompt rendered before each input line. */
const PROMPT = `${paint("❯", "36")} `;

const HELP_TEXT = `commands:
  /help            show this help
  /sessions        list sessions persisted under \$DSH_HOME/sessions
  /quit, /exit     flush the session and quit

anything else is sent to the agent as your next message
`;

/** Join the text blocks of a message's content. */
function textOf(content) {
	return (content ?? [])
		.filter((block) => block?.type === "text")
		.map((block) => block.text)
		.join("");
}

/** Compact a raw tool-arguments JSON string for one-line display. */
function previewArgs(raw) {
	const text = raw == null ? "" : String(raw).replace(/\s+/g, " ").trim();
	return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

/** Compact a tool result payload (string or block array) for one-line display. */
function previewResult(content) {
	const block = Array.isArray(content) ? content[0] : content;
	const raw = block?.type === "tool-result" ? block.content : block;
	let text;
	try {
		text = typeof raw === "string" ? raw : JSON.stringify(raw);
	} catch {
		text = String(raw);
	}
	text = text.replace(/\s+/g, " ").trim();
	return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

/**
 * Live renderer over the agent's `session/event` stream: echoes user turns,
 * streams assistant text/reasoning chunks, and shows each tool call and its
 * result as it happens.
 */
class TurnRenderer {
	constructor(stdout) {
		this.stdout = stdout;
		this.streamedSteps = new Set();
		this.callNames = new Map();
	}

	onEvent(event) {
		switch (event.type) {
			case "user/message": {
				if (event.data.source?.kind !== "user") return;
				const text = textOf(event.data.content);
				if (text === "") return;
				this.stdout.write(`\n${paint("you:", "36")} ${text}\n`);
				break;
			}
			case "assistant/chunk": {
				const chunk = event.data.chunk;
				if (chunk?.type === "text-delta" && chunk.text !== "") {
					this.streamedSteps.add(`${event.data.turn}:${event.data.step}`);
					this.stdout.write(chunk.text);
				} else if (chunk?.type === "reasoning-delta" && chunk.text !== "") {
					this.stdout.write(paint(chunk.text, "2"));
				}
				break;
			}
			case "assistant/message": {
				const key = `${event.data.turn}:${event.data.step}`;
				if (this.streamedSteps.has(key)) return; // already streamed chunk by chunk
				const text = textOf(event.data.message?.content);
				if (text !== "") this.stdout.write(`\n${text}\n`);
				break;
			}
			case "tool/call": {
				const name = event.data.name;
				this.callNames.set(event.data.callId, name);
				this.stdout.write(`\n${paint(`⚙ ${name}(${previewArgs(event.data.arguments)})`, "33")}\n`);
				break;
			}
			case "tool/result": {
				const callId = event.data.message?.content?.[0]?.toolCallId;
				const toolName = this.callNames.get(callId) ?? "tool";
				const error = event.data.error;
				if (error !== void 0) {
					this.stdout.write(`${paint(`✗ ${toolName} → ${error.code ?? "error"}: ${error.message ?? "failed"}`, "31")}\n`);
				} else {
					this.stdout.write(`${paint(`✓ ${toolName} → ${previewResult(event.data.message?.content)}`, "2")}\n`);
				}
				break;
			}
			case "turn/end": {
				const reason = event.data.reason;
				if (reason?.kind === "error") {
					const failure = reason.error;
					this.stdout.write(`\n${paint(`✗ turn failed: ${failure?.code ?? "UNKNOWN"}: ${failure?.message ?? String(reason.error)}`, "31")}\n`);
				} else if (reason?.kind === "max-tokens") {
					this.stdout.write(`\n${paint("(output reached the max-token limit)", "33")}\n`);
				} else if (reason?.kind === "aborted") {
					this.stdout.write(`\n${paint("(turn interrupted)", "33")}\n`);
				}
				break;
			}
			default:
				break;
		}
	}
}

/** The startup banner: identity of this run and how to come back to it. */
function banner(agent, selection, resumed) {
	return [
		"",
		`${paint("dsh tui", "1")} — interactive coding agent${resumed ? ` (${paint("resumed", "33")})` : ""}`,
		`  model     ${selection.model} (${selection.provider})`,
		`  session   ${agent.session.id}   ${paint("resume with:", "2")} dsh --profile tui --resume ${agent.session.id}`,
		`  workspace ${agent.session.header.cwd ?? process.cwd()}`,
		`type ${paint("/help", "36")} for commands, ${paint("/quit", "36")} to exit`,
		""
	].join("\n");
}

/** List persisted sessions (id, title, workspace) for the /sessions command. */
async function printSessions(ctx, stdout) {
	const persistence = ctx.get("sessionPersistence");
	if (persistence === void 0) {
		stdout.write("(session listing unavailable: no session persistence backend)\n");
		return;
	}
	let headers;
	try {
		headers = await persistence.list();
	} catch (error) {
		stdout.write(`(failed to list sessions: ${error instanceof Error ? error.message : String(error)})\n`);
		return;
	}
	if (headers.length === 0) {
		stdout.write("no sessions yet\n");
		return;
	}
	stdout.write(`sessions (${headers.length}):\n`);
	for (const header of headers) {
		const title = header.title !== void 0 && header.title !== "" ? `  ${paint(header.title, "2")}` : "";
		const cwd = header.cwd !== void 0 ? `  @ ${header.cwd}` : "";
		stdout.write(`  ${header.id}${title}${cwd}\n`);
	}
}

/** Report an unexpected direct-driver failure and request a failing exit. */
function fail(io, error) {
	io.stderr.write(`dsh: ${error instanceof Error ? error.message : String(error)}\n`);
	io.exit(1);
}

/**
 * Run the interactive loop: create/resume one agent, then read lines, submit
 * each as a followup turn, and quit on /quit, Ctrl+C, or EOF.
 * @param ctx - plugin context carrying the core services and launcher IO.
 * @param resumeSessionId - session to continue, or undefined for a fresh one.
 * @param io - process-facing effects.
 */
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
			setup
		});
	}
	const { agent, dispose } = handle;
	await agent.whenIdle();

	const renderer = new TurnRenderer(io.stdout);
	const unsubscribe = agent.ctx.on("session/event", (_subject, event) => renderer.onEvent(event));
	const input = new Input(io.stdin, io.stdout, {
		onInterrupt: () => agent.cancel({ kind: "interrupted" })
	});
	try {
		io.stdout.write(banner(agent, selection, resumed));
		while (true) {
			const line = await input.nextLine(PROMPT);
			if (line === null) break;
			const trimmed = line.trim();
			if (trimmed === "") continue;
			if (trimmed.startsWith("/")) {
				const [command] = trimmed.split(/\s+/);
				if (command === "/quit" || command === "/exit" || command === "/q") break;
				if (command === "/help" || command === "/?") {
					io.stdout.write(HELP_TEXT);
					continue;
				}
				if (command === "/sessions") {
					await printSessions(ctx, io.stdout);
					continue;
				}
				io.stdout.write(`unknown command "${command}" — type /help\n`);
				continue;
			}
			input.busy = true;
			try {
				agent.followup(createUserMessage({
					content: [{ type: "text", text: trimmed }],
					source: { kind: "user" }
				}));
				await agent.whenIdle();
			} finally {
				input.busy = false;
			}
			await sessions.flush(agent.session);
			io.stdout.write("\n");
		}
		io.stdout.write("bye.\n");
		await sessions.flush(agent.session);
	} finally {
		input.stop();
		unsubscribe();
		await dispose();
	}
	io.exit(0);
}

/**
 * Mount the interactive driver.
 * @param ctx - plugin context carrying core services and the launcher-provided exit request.
 * @param config - validated startup config (`sessionId` from the tuiStartup service).
 */
export function apply(ctx, config) {
	const exit = ctx.get("appExit");
	if (exit === void 0) throw new Error("tui-runner: the launcher must provide ctx.appExit before the tree mounts");
	const io = { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr, exit };
	run(ctx, config?.sessionId, io).catch((error) => {
		fail(io, error);
	});
}
