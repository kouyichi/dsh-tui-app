/**
 * dsh-tui theme — the single source of SGR codes for the whole UI.
 * Components never emit raw escape sequences; they call paint(role).
 *
 * Palette roles (semantic, merged per the archived official-TUI lessons):
 *   accent  brand blue #4D6BFE (prompt, status accents, user line)
 *   success green              (tool ok, good states)
 *   error   red                (tool failures, turn errors)
 *   warning yellow             (max-tokens, aborted, notices)
 *   dim     gray               (recessed card bodies, metadata)
 *   bold    bold               (headers, tool names)
 *
 * @module dsh-tui-app/theme/palette
 */

/** Brand blue as 24-bit SGR: DeepSeek #4D6BFE. */
export const BRAND = [77, 107, 254];

const CODES = {
  accent: `38;2;${BRAND.join(";")}`,
  success: "32",
  error: "31",
  warning: "33",
  dim: "2",
  bold: "1",
  // composed helpers
  "accent-bold": `1;38;2;${BRAND.join(";")}`,
  "error-bold": "1;31",
  "success-dim": "2;32",
  "warning-dim": "2;33",
};

/** Wrap text in the SGR for a palette role. */
export function paint(text, role = "dim") {
  const code = CODES[role] ?? CODES.dim;
  return `\u001b[${code}m${text}\u001b[0m`;
}

/** Plain text length after stripping ANSI escapes (for alignment). */
export function visibleLength(text) {
  return text.replace(/\u001b\[[0-9;]*m/g, "").length;
}

/** Pad a possibly-ANSI string to `width` visible columns (left-align). */
export function pad(text, width) {
  const gap = width - visibleLength(text);
  return gap > 0 ? text + " ".repeat(gap) : text;
}
