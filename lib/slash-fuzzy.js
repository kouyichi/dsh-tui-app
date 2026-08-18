/**
 * slash-fuzzy.js — description-aware fuzzy scoring for the slash-command menu.
 *
 * Ported from Hermes ui-tui/src/app/slash/fuzzyScore.ts (which itself ports
 * superagent-ai/grok-cli): candidates are scored in tiers — exact match on
 * id/label/alias (0), prefix (1), substring (2) — and the DESCRIPTION text is
 * tokenized and matched at a +3 offset. Typing "/comp" surfaces /compact even
 * when the description mentions compaction. Lower score wins; Infinity = no
 * match. An empty query returns the list untouched so browsing keeps order.
 *
 * @module dsh-tui-app/slash-fuzzy
 */

/** Lowercase the value and return it alongside its alphanumeric word tokens. */
export function tokenizeSearchText(value) {
  const normalized = String(value ?? "").toLowerCase();
  return [normalized, ...normalized.split(/[^a-z0-9]+/).filter(Boolean)];
}

/** Trim, drop leading slashes, lowercase — `/Model ` and `model` score alike. */
export function normalizeSlashSearchQuery(query) {
  return String(query ?? "").trim().replace(/^\/+/, "").toLowerCase();
}

function scoreFields(fields, query, offset) {
  for (const field of fields) {
    if (field === query || `/${field}` === query) return offset;
  }
  for (const field of fields) {
    if (field.startsWith(query) || `/${field}`.startsWith(query)) return offset + 1;
  }
  for (const field of fields) {
    if (field.includes(query)) return offset + 2;
  }
  return Number.POSITIVE_INFINITY;
}

/** Score one item against a normalized query. Lower is better; Infinity = no match. */
export function scoreSlashMenuItem(item, query) {
  const commandFields = [item.id, item.label ?? "", ...(item.aliases ?? [])].filter(Boolean).flatMap(tokenizeSearchText);
  const descriptionFields = tokenizeSearchText(item.description ?? "");
  return Math.min(scoreFields(commandFields, query, 0), scoreFields(descriptionFields, query, 3));
}

/** Filter and stable-sort `items` by score (then original order). */
export function rankSlashItems(items, query, toScoreItem) {
  const normalized = normalizeSlashSearchQuery(query);
  if (!normalized) return items;
  return items
    .map((item, index) => ({ index, item, score: scoreSlashMenuItem(toScoreItem(item), normalized) }))
    .filter((entry) => entry.score !== Number.POSITIVE_INFINITY)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((entry) => entry.item);
}
