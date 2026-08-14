/**
 * dsh-tui-app/startup — the interactive app's command-line provider.
 *
 * Parses the app's own flag family from the launcher's immutable argument
 * snapshot (`ctx.cmdlineArgs`), then publishes the {@link TUI_STARTUP_SERVICE}
 * that the runner consumes lazily. Help and parse errors are terminal: the
 * text is written and `ctx.appExit` is requested before anything is provided.
 *
 * The launcher owns only its own flags (`--profile`, `--patch`, the config
 * dumps); everything after them reaches the tree verbatim, so
 * `dsh --profile tui --resume session-abc` boots this profile with
 * `["--resume", "session-abc"]` as the app arguments.
 *
 * @module dsh-tui-app/startup
 */

/** Stable Cordis plugin name. */
export const name = "tui-startup";

/** Services required before the app arguments can be read. */
export const inject = ["cmdlineArgs"];

/** Service provided by this plugin and injected by the interactive runner. */
export const TUI_STARTUP_SERVICE = "tuiStartup";

/** The app's help text, printed for `-h/--help` and on usage errors. */
export const USAGE = `Usage: dsh --profile tui [options]

An interactive terminal chat with a dsh agent. Starts a new session or
continues an existing one (--resume). Each turn runs through the same agent
with the base tool suite (fs, bash, jobs, web search, ...) enabled; tool calls
and the final answer stream to the terminal as they happen. Every turn is
flushed to the session store (\$DSH_HOME/sessions) and survives restarts.

Options:
  --resume <sessionId>  continue an existing session
  -h, --help            show this help

Commands typed at the prompt:
  /help                 show this help
  /sessions             list persisted sessions
  /quit, /exit          flush the session and quit

Examples:
  dsh --profile tui                          start a new chat
  dsh --profile tui --resume session-abc123  continue an existing chat
`;

/**
 * Parse the app argument list. Returns a discriminated result:
 * `{ kind: "start", sessionId }`, `{ kind: "help" }`, or
 * `{ kind: "error", message }`. Repeated `--resume` flags keep the last one.
 * @param argv - the launcher's frozen argument snapshot.
 */
export function parseArgs(argv) {
	const sessionIds = [];
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "-h" || argument === "--help") return { kind: "help" };
		if (argument === "--resume") {
			const value = argv[index + 1];
			if (value === void 0 || value.startsWith("-")) return { kind: "error", message: "error: option '--resume <sessionId>' argument missing" };
			sessionIds.push(value);
			index += 1;
			continue;
		}
		if (argument.startsWith("--resume=")) {
			const value = argument.slice("--resume=".length);
			if (value === "") return { kind: "error", message: "error: option '--resume <sessionId>' argument missing" };
			sessionIds.push(value);
			continue;
		}
		return { kind: "error", message: `error: unknown option '${argument}'` };
	}
	return { kind: "start", sessionId: sessionIds.at(-1) };
}

/**
 * Parse and provide the interactive app's startup facts as an ordinary
 * Cordis service. On help or a usage error nothing is provided and the
 * process exits through the launcher's exit request.
 * @param ctx - plugin context carrying the command line and exit request.
 */
export function apply(ctx) {
	const cmdline = ctx.get("cmdlineArgs");
	const exit = ctx.get("appExit");
	if (cmdline === void 0 || exit === void 0) throw new Error("tui-startup: the launcher must provide ctx.cmdlineArgs and ctx.appExit before the tree mounts");
	const parsed = parseArgs(cmdline.get());
	if (parsed.kind === "help") {
		process.stdout.write(USAGE);
		exit(0);
		return;
	}
	if (parsed.kind === "error") {
		process.stderr.write(`dsh: ${parsed.message}\n`);
		process.stderr.write(USAGE);
		exit(1);
		return;
	}
	ctx.provide(TUI_STARTUP_SERVICE, { sessionId: parsed.sessionId });
}
