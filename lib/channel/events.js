/**
 * dsh-tui channel — subscribes to the agent's live `session/event` stream
 * and normalizes raw events into a flat, render-friendly event log.
 *
 * Raw event types seen on the stream (verified against the headless session
 * log): user/message, assistant/chunk (text-delta | reasoning-delta),
 * assistant/message, tool/call, tool/result, turn/end (reason.kind in
 * error|max-tokens|aborted), plus turn/start, step/start, step/end, approvals.
 *
 * Normalized events (what React consumes):
 *   {kind:'splash'}                     — initial banner info
 *   {kind:'user', text}
 *   {kind:'assistant-delta', text?, reasoning?}
 *   {kind:'assistant', text}            — non-streamed final message
 *   {kind:'tool-start', id, name, args}
 *   {kind:'tool-end', id, name, ok, preview}
 *   {kind:'notice', tone:'error'|'warning', text}
 *
 * @module dsh-tui-app/channel/events
 */

/** Join the text blocks of a message content array. */
export function textOf(content) {
  return (content ?? [])
    .filter((block) => block?.type === "text")
    .map((block) => block.text)
    .join("");
}

/** Compact raw tool arguments JSON to one line. */
export function previewArgs(raw) {
  const text = raw == null ? "" : String(raw).replace(/\s+/g, " ").trim();
  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
}

/** Compact a tool result payload to one line. */
export function previewResult(content) {
  const block = Array.isArray(content) ? content[0] : content;
  const raw = block?.type === "tool-result" ? block.content : block;
  let text;
  try {
    text = typeof raw === "string" ? raw : JSON.stringify(raw);
  } catch {
    text = String(raw);
  }
  text = text.replace(/\s+/g, " ").trim();
  return text.length > 200 ? `${text.slice(0, 197)}...` : text;
}

/**
 * Build the subscriber. Returns { onEvent, detach }.
 * `emit` receives normalized events; `agent` is the dsh Agent handle whose
 * ctx emits `session/event`.
 */
export function createChannel(agent, emit) {
  const callNames = new Map();

  function onEvent(event) {
    switch (event.type) {
      case "user/message": {
        if (event.data.source?.kind !== "user") return;
        const text = textOf(event.data.content);
        if (text === "") return;
        emit({ kind: "user", text });
        break;
      }
      case "assistant/chunk": {
        const chunk = event.data.chunk;
        if (chunk?.type === "text-delta" && chunk.text !== "") {
          emit({ kind: "assistant-delta", text: chunk.text });
        } else if (chunk?.type === "reasoning-delta" && chunk.text !== "") {
          emit({ kind: "assistant-delta", reasoning: chunk.text });
        }
        break;
      }
      case "assistant/message": {
        const text = textOf(event.data.message?.content);
        if (text !== "") emit({ kind: "assistant", text });
        break;
      }
      case "tool/call": {
        const name = event.data.name;
        callNames.set(event.data.callId, name);
        emit({
          kind: "tool-start",
          id: event.data.callId,
          name,
          args: previewArgs(event.data.arguments),
        });
        break;
      }
      case "tool/result": {
        const callId = event.data.message?.content?.[0]?.toolCallId;
        const name = callNames.get(callId) ?? "tool";
        const error = event.data.error;
        if (error !== void 0) {
          emit({
            kind: "tool-end",
            id: callId,
            name,
            ok: false,
            preview: `${error.code ?? "error"}: ${error.message ?? "failed"}`,
          });
        } else {
          emit({
            kind: "tool-end",
            id: callId,
            name,
            ok: true,
            preview: previewResult(event.data.message?.content),
          });
        }
        break;
      }
      case "turn/end": {
        const reason = event.data.reason;
        if (reason?.kind === "error") {
          const failure = reason.error;
          emit({
            kind: "notice",
            tone: "error",
            text: `turn failed: ${failure?.code ?? "UNKNOWN"}: ${failure?.message ?? String(reason.error)}`,
          });
        } else if (reason?.kind === "max-tokens") {
          emit({
            kind: "notice",
            tone: "warning",
            text: "output reached the max-token limit",
          });
        } else if (reason?.kind === "aborted") {
          emit({ kind: "notice", tone: "warning", text: "turn interrupted" });
        }
        break;
      }
      default:
        break;
    }
  }

  const detach = agent.ctx.on("session/event", (_subject, event) => onEvent(event));
  return { onEvent, detach };
}
