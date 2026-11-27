import { test } from "node:test";
import assert from "node:assert/strict";
import { machineOf, placeKey, addressOf, mergeSnapshots, newlyPending } from "../mods/decisions/places.js";

test("machineOf reads the machine prefix, and null for this machine", () => {
  assert.equal(machineOf("m5/p3"), "m5");
  assert.equal(machineOf("p3"), null);
  assert.equal(machineOf(null), null);
});

test("placeKey tells the same path on two machines apart", () => {
  assert.equal(placeKey(null, "/repo"), "/repo");
  assert.equal(placeKey("m5", "/repo"), "m5:/repo");
  assert.notEqual(placeKey("m5", "/repo"), placeKey("m6", "/repo"));
});

test("addressOf prefixes a remote session's bare terminal id with its machine", () => {
  assert.equal(addressOf("m5", "t3"), "m5/t3");
  assert.equal(addressOf("m5", "m5/t3"), "m5/t3");
  assert.equal(addressOf(null, "t3"), "t3");
  assert.equal(addressOf("m5", ""), "");
});

const machine = (state, projects, over = {}) => ({ state, baselined: true, error: null, projects: new Map(projects.map((p) => [p.root, p])), ...over });
const project = (root, items, error = null) => ({ root, name: root, items, error });
const pending = (key, on = null) => ({ key, on, status: "pending", title: key });

test("mergeSnapshots lists every machine's projects with a read, and a warning per failure", () => {
  const machines = new Map([
    [null, machine("ok", [project("/repo", [pending("a")]), project("/new", null, "permission denied")])],
    ["m5", machine("unreachable", [project("m5:/srv", [pending("b", "m5")], "timed out")])],
    ["m6", machine("unreachable", [], { baselined: false })],
  ]);
  const { projects, warnings } = mergeSnapshots(machines);

  assert.deepEqual(projects.map((p) => p.root), ["/repo", "m5:/srv"]);
  assert.deepEqual(warnings, [
    { kind: "projectFailed", project: "/new", why: "permission denied" },
    { kind: "unreachable", machine: "m5", stale: true },
    { kind: "unreachable", machine: "m6", stale: false },
  ]);
});

test("newlyPending announces only keys not seen, and none from a machine read for the first time", () => {
  const projects = [project("/repo", [pending("a"), pending("b"), { ...pending("c"), status: "decided" }]), project("m5:/srv", [pending("d", "m5")])];
  const { fresh, announced } = newlyPending(new Set(["a"]), projects, new Set(["m5"]));

  assert.deepEqual(fresh.map((i) => [i.key, i.project]), [["b", "/repo"]]);
  assert.deepEqual([...announced], ["a", "b", "d"]);
});
