import { test } from "node:test";
import assert from "node:assert/strict";
import { Roots } from "../mods/decisions/refresh.js";

const git = (...answers) => {
  const calls = [];
  const exec = async (command, args, options) => {
    calls.push({ command, args, options });
    const answer = answers.length > 1 ? answers.shift() : answers[0];
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { exec, calls };
};

test("a git lookup that could not run is tried again, and cached once it answers", async () => {
  const { exec, calls } = git(new Error("machine unreachable"), { code: 0, stdout: "/srv/app\n", stderr: "" });
  const roots = new Roots(exec);

  assert.deepEqual(await roots.of("/srv/app/sub", "m5"), { root: "/srv/app/sub", confirmed: false });
  assert.equal(roots.get("m5", "/srv/app/sub"), undefined);
  assert.deepEqual(await roots.of("/srv/app/sub", "m5"), { root: "/srv/app", confirmed: true });
  assert.deepEqual(await roots.of("/srv/app/sub", "m5"), { root: "/srv/app", confirmed: true });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].options, { cwd: "/srv/app/sub", on: "m5" });
});

test("a folder git says is not a repository is its own root, and is not asked again", async () => {
  const { exec, calls } = git({ code: 128, stdout: "", stderr: "fatal: not a git repository (or any of the parent directories): .git\n" });
  const roots = new Roots(exec);

  assert.deepEqual(await roots.of("/notes"), { root: "/notes", confirmed: true });
  assert.deepEqual(await roots.of("/notes"), { root: "/notes", confirmed: true });
  assert.equal(calls.length, 1);
});

test("any other git error is not cached and is tried again", async () => {
  const { exec, calls } = git(
    { code: 128, stdout: "", stderr: "fatal: detected dubious ownership in repository at '/srv/app'\n" },
    { code: 0, stdout: "/srv/app\n", stderr: "" },
  );
  const roots = new Roots(exec);

  assert.deepEqual(await roots.of("/srv/app/sub", "m5"), { root: "/srv/app/sub", confirmed: false });
  assert.deepEqual(await roots.of("/srv/app/sub", "m5"), { root: "/srv/app", confirmed: true });
  assert.equal(roots.get("m5", "/srv/app/sub"), "/srv/app");
  assert.equal(calls.length, 2);
});
