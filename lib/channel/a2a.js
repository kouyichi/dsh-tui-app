/**
 * dsh-tui A2A client — dispatch tasks to the local agent network
 * (hermes:9900, claude-code:9901, codex:9902, dsh:9903) over A2A v1.0
 * JSON-RPC, with tasks/get polling for async endpoints.
 *
 * @module dsh-tui-app/channel/a2a
 */

export const A2A_AGENTS = {
  hermes: 9900,
  claude: 9901,
  codex: 9902,
  dsh: 9903,
};

const POLL_MS = 2000;
const TOTAL_TIMEOUT_MS = 1900 * 1000; // bridge tasks can run up to 30min

async function rpc(port, body) {
  const res = await fetch(`http://127.0.0.1:${port}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TOTAL_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`A2A HTTP ${res.status}`);
  return await res.json();
}

/**
 * Dispatch one task and wait for the terminal state.
 * @returns {Promise<{state: string, text: string, ms: number}>}
 */
export async function a2aSend(name, text) {
  const port = A2A_AGENTS[name];
  if (!port) throw new Error(`unknown A2A agent "${name}"`);
  const t0 = Date.now();
  const data = await rpc(port, {
    jsonrpc: "2.0",
    id: `tui-${t0}`,
    method: "message/send",
    params: { message: { parts: [{ text }] } },
  });
  let task = data?.result?.task;
  if (!task) throw new Error(`A2A bad response: ${JSON.stringify(data).slice(0, 200)}`);
  while (task.status?.state === "TASK_STATE_WORKING") {
    if (Date.now() - t0 > TOTAL_TIMEOUT_MS) throw new Error("A2A task timed out");
    await new Promise((r) => setTimeout(r, POLL_MS));
    const poll = await rpc(port, {
      jsonrpc: "2.0",
      id: "tui-poll",
      method: "tasks/get",
      params: { id: task.id },
    });
    task = poll?.result?.task ?? task;
  }
  const parts = task?.artifacts?.[0]?.parts ?? [];
  const textOut = parts.map((p) => p.text ?? "").join("") ||
    task?.status?.message?.parts?.map((p) => p.text ?? "").join("") ||
    "(no result)";
  return { state: task.status?.state ?? "UNKNOWN", text: textOut, ms: Date.now() - t0 };
}

/** Probe one endpoint's agent card (for /agents). */
export async function a2aProbe(name) {
  const port = A2A_AGENTS[name];
  try {
    const res = await fetch(`http://127.0.0.1:${port}/.well-known/agent-card.json`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { name, ok: false, detail: `HTTP ${res.status}` };
    const card = await res.json();
    return { name, ok: true, detail: card.description?.slice(0, 60) ?? card.name ?? "" };
  } catch (e) {
    return { name, ok: false, detail: e.message };
  }
}
