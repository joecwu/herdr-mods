import { test } from "node:test";
import assert from "node:assert/strict";
import { strings } from "../mods/decisions/strings.js";

const SAMPLE = { title: "T", rejected: true, label: "Rejected", note: "why", path: "/p/.decisions/t.md", dir: ".decisions" };

test("an unknown or missing language falls back to English", () => {
  assert.equal(strings("fr"), strings("en"));
  assert.equal(strings(undefined), strings("en"));
});

test("every language defines the same keys with the same kinds of value", () => {
  const en = strings("en"), zh = strings("zh-TW");

  assert.notEqual(zh, en);
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en)) assert.equal(typeof zh[key], typeof en[key], key);
});

test("the message to a session carries the reason and the file path", () => {
  for (const lang of ["en", "zh-TW"]) {
    const message = strings(lang).sessionMessage(SAMPLE);

    assert.ok(message.includes("why"), lang);
    assert.ok(message.includes(SAMPLE.path), lang);
    assert.ok(message.includes(".decisions/done/"), lang);
  }
});

test("the message leaves the note out when there is none", () => {
  const message = strings("en").sessionMessage({ ...SAMPLE, rejected: false, label: "Approve", note: "" });

  assert.ok(message.includes("was decided: Approve."));
  assert.ok(!message.includes("Note:"));
});
