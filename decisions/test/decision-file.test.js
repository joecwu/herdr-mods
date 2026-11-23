import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, withMeta, decidedMeta, segments, timestamp, PENDING, DECIDED, REJECTED } from "../mods/decisions/decision-file.js";

const FILE = `---
title: Pick the retry policy
status: pending
requester: t7
created: 2026-11-20 14:10
options: ["A: Backoff", "B: Fixed"]
---
## Background

Deliveries fail 2% of the time.
`;

test("parse reads the frontmatter fields and the body", () => {
  const item = parse(FILE, "/repo/.decisions/2026-11-20-retry.md");

  assert.equal(item.id, "2026-11-20-retry");
  assert.equal(item.title, "Pick the retry policy");
  assert.equal(item.status, PENDING);
  assert.equal(item.requester, "t7");
  assert.equal(item.created, "2026-11-20 14:10");
  assert.deepEqual(item.options, ["A: Backoff", "B: Fixed"]);
  assert.equal(item.body, "## Background\n\nDeliveries fail 2% of the time.");
});

test("parse returns null when the text has no frontmatter", () => {
  assert.equal(parse("# Just notes\n", "/repo/.decisions/notes.md"), null);
  assert.equal(parse(null, "/repo/.decisions/missing.md"), null);
});

test("parse falls back to the file name, pending and no options", () => {
  const item = parse("---\nrequester: t3\n---\nBody", "/repo/.decisions/push-release.md");

  assert.equal(item.title, "push-release");
  assert.equal(item.status, PENDING);
  assert.deepEqual(item.options, []);
});

test("parse ignores options that are not a JSON array", () => {
  const item = parse("---\ntitle: T\noptions: A, B\n---\n", "/x/a.md");

  assert.deepEqual(item.options, []);
});

test("parse unquotes values and keeps colons inside them", () => {
  const item = parse('---\ntitle: "Ship it: yes or no"\nnote: \'later\'\n---\n', "/x/a.md");

  assert.equal(item.title, "Ship it: yes or no");
  assert.equal(item.note, "later");
});

test("parse accepts CRLF line endings", () => {
  const item = parse("---\r\ntitle: Windows\r\nstatus: pending\r\n---\r\nBody\r\n", "/x/a.md");

  assert.equal(item.title, "Windows");
  assert.equal(item.body, "Body");
});

test("withMeta replaces existing keys, appends new ones and keeps the body", () => {
  const next = withMeta(FILE, { status: DECIDED, decision: '"A: Backoff"' });
  const item = parse(next, "/x/a.md");

  assert.equal(item.status, DECIDED);
  assert.equal(item.decision, "A: Backoff");
  assert.equal(item.title, "Pick the retry policy");
  assert.equal(item.body, "## Background\n\nDeliveries fail 2% of the time.");
  assert.equal(next.match(/^status:/gm).length, 1);
});

test("withMeta throws when the text has no frontmatter", () => {
  assert.throws(() => withMeta("no frontmatter", { status: DECIDED }), /no frontmatter/);
});

test("a decision with a note survives a write and a read", () => {
  const note = 'Not yet: "pricing" still uses it';
  const next = withMeta(FILE, decidedMeta(REJECTED, note, new Date(2026, 10, 23, 9, 5)));
  const item = parse(next, "/x/a.md");

  assert.equal(item.status, DECIDED);
  assert.equal(item.decision, REJECTED);
  assert.equal(item.note, note);
  assert.match(next, /^decided_at: 2026-11-23 09:05$/m);
});

test("segments splits a body at its fenced code blocks", () => {
  const body = "Run this:\n\n```sh\nmake report\n```\n\nThen this:\n\n```\ncd app\nnpm test\n```\nDone.";

  assert.deepEqual(segments(body), [
    { text: "Run this:" },
    { code: "make report" },
    { text: "Then this:" },
    { code: "cd app\nnpm test" },
    { text: "Done." },
  ]);
});

test("segments returns one text part when there is no code block", () => {
  assert.deepEqual(segments("Only prose."), [{ text: "Only prose." }]);
  assert.deepEqual(segments(""), []);
});

test("segments skips an empty code block", () => {
  assert.deepEqual(segments("Before\n```\n\n```\nAfter"), [{ text: "Before" }, { text: "After" }]);
});

test("timestamp pads to YYYY-MM-DD HH:MM in local time", () => {
  assert.equal(timestamp(new Date(2026, 0, 5, 7, 3)), "2026-01-05 07:03");
});
