import { test } from "node:test";
import assert from "node:assert/strict";
import { tellRequester } from "../mods/decisions/tell.js";
import { strings } from "../mods/decisions/strings.js";

const text = strings("en");
const SEND = { address: "m5/t3", label: "LightPlay · t3", message: "[decisions panel] done" };

const recording = (answer) => {
  const calls = [];
  const hc = async (args) => {
    calls.push(args);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { hc, calls };
};

test("a delivered message resolves with nothing to show, sent to the full address", async () => {
  const { hc, calls } = recording({ code: 0, stdout: "", stderr: "" });

  assert.equal(await tellRequester(hc, SEND, text), null);
  assert.deepEqual(calls, [["send", "m5/t3", "[decisions panel] done"]]);
});

test("hc refusing names the session by its label and keeps hc's reason", async () => {
  const { hc, calls } = recording({ code: 1, stdout: "", stderr: "no such terminal: m5/t3\n" });
  const line = await tellRequester(hc, SEND, text);

  assert.equal(line, text.notifyFailed("LightPlay · t3", "no such terminal: m5/t3"));
  assert.ok(line.includes("LightPlay · t3") && line.includes("no such terminal: m5/t3"));
  assert.equal(calls[0][1], "m5/t3");
});

test("hc failing to run names the session by its label and keeps the error", async () => {
  const { hc, calls } = recording(new Error("machine m5 is unreachable"));
  const line = await tellRequester(hc, SEND, text);

  assert.ok(line.includes("LightPlay · t3"), line);
  assert.ok(line.includes("machine m5 is unreachable"), line);
  assert.ok(!line.includes("m5/t3"), line);
  assert.equal(calls[0][1], "m5/t3");
});
