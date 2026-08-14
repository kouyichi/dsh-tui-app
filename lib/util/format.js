/**
 * dsh-tui format helpers — small display-formatting utilities.
 *
 * @module dsh-tui-app/util/format
 */

/** Compact ms into "1m02s" / "12.3s" / "842ms". */
export function fmtMs(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "-";
  if (ms >= 60000) {
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${m}m${String(s).padStart(2, "0")}s`;
  }
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

/** Truncate a long id for display: "session-6d8f06c1…1029c". */
export function shortId(id, head = 16, tail = 6) {
  if (!id || id.length <= head + tail + 1) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}
