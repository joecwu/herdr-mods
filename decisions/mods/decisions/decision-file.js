// The decision file format: frontmatter with one `key: value` per line, then a markdown body.
// Pure functions with no Herdr imports, so they run under `node --test`.

export const PENDING = "pending";
export const DECIDED = "decided";
export const APPROVED = "approved";
export const REJECTED = "rejected";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const FENCE = /```[^\n]*\n([\s\S]*?)\n?```/g;

function unquote(value) {
  if (/^".*"$/.test(value)) {
    try { return String(JSON.parse(value)); } catch { return value.slice(1, -1); }
  }
  return /^'.*'$/.test(value) ? value.slice(1, -1) : value;
}

function parseOptions(value) {
  try {
    const list = JSON.parse(value ?? "[]");
    return Array.isArray(list) ? list.map(String) : [];
  } catch { return []; }
}

/** Reads a decision file. Returns null when the text has no frontmatter. */
export function parse(text, path) {
  const match = FRONTMATTER.exec(text ?? "");
  if (!match) return null;
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const at = line.indexOf(":");
    if (at > 0) meta[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  const id = path.split("/").pop().replace(/\.md$/, "");
  return {
    path,
    id,
    title: unquote(meta.title ?? "") || id,
    status: unquote(meta.status ?? "") || PENDING,
    requester: unquote(meta.requester ?? ""),
    created: unquote(meta.created ?? ""),
    options: parseOptions(meta.options),
    decision: unquote(meta.decision ?? ""),
    note: unquote(meta.note ?? ""),
    body: match[2].trim(),
  };
}

/** Returns the text with those frontmatter keys replaced or added. The body is untouched. */
export function withMeta(text, updates) {
  const match = FRONTMATTER.exec(text);
  if (!match) throw new Error("the file has no frontmatter");
  const remaining = { ...updates };
  const lines = match[1].split(/\r?\n/).map((line) => {
    const key = line.slice(0, Math.max(line.indexOf(":"), 0)).trim();
    if (!(key in remaining)) return line;
    const value = remaining[key];
    delete remaining[key];
    return `${key}: ${value}`;
  });
  const added = Object.entries(remaining).map(([key, value]) => `${key}: ${value}`);
  return `---\n${[...lines, ...added].join("\n")}\n---\n${match[2]}`;
}

/** The frontmatter a decision gets when the person decides. */
export function decidedMeta(decision, note, at) {
  return { status: DECIDED, decision: JSON.stringify(decision), note: JSON.stringify(note), decided_at: timestamp(at) };
}

/** Splits a body at its fenced code blocks: `{ text }` for markdown, `{ code }` for a block. */
export function segments(body) {
  const out = [];
  let at = 0;
  for (const match of body.matchAll(FENCE)) {
    const before = body.slice(at, match.index).trim();
    if (before) out.push({ text: before });
    if (match[1].trim()) out.push({ code: match[1] });
    at = match.index + match[0].length;
  }
  const rest = body.slice(at).trim();
  if (rest) out.push({ text: rest });
  return out;
}

/** Local time as `YYYY-MM-DD HH:MM`. */
export function timestamp(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
