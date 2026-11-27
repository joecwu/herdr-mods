import { test } from "node:test";
import assert from "node:assert/strict";
import { machineOf, placeKey, addressOf, requesterLabel, mergeSnapshots, newlyPending } from "../mods/decisions/places.js";

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

const terminal = (address, tab, name = null) => ({ pane: `p-${address}`, terminal: address, tab, name });
const spaceWith = (...tabs) => [{ id: "s1", name: "Space", tabs: tabs.map(([id, name, named]) => ({ id, name, named })) }];

test("requesterLabel prefers the pane's name, then the tab's name when someone named it", () => {
  const spaces = spaceWith(["a", "LightPlay", true], ["b", "2", false]);

  assert.equal(requesterLabel("t1", [terminal("t1", "a")], spaces), "LightPlay");
  assert.equal(requesterLabel("t1", [terminal("t1", "a", "reviewer")], spaces), "reviewer");
  assert.equal(requesterLabel("m5/t2", [terminal("m5/t2", "b")], spaces), "m5/t2");
});

test("requesterLabel tells apart two agents in one tab by terminal id", () => {
  const spaces = spaceWith(["a", "LightPlay", true]);
  const panes = [terminal("m5/t3", "a"), terminal("m5/t4", "a"), terminal("t5", "a", "agent"), terminal("t6", "a", "agent")];

  assert.equal(requesterLabel("m5/t3", panes, spaces), "LightPlay · t3");
  assert.equal(requesterLabel("m5/t4", panes, spaces), "LightPlay · t4");
  assert.equal(requesterLabel("t5", panes, spaces), "agent · t5");
});

test("requesterLabel falls back to the address when the terminal id does not tell them apart", () => {
  const spaces = spaceWith(["a", "LightPlay", true]);
  const panes = [terminal("m5/t3", "a"), terminal("m6/t3", "a")];

  assert.equal(requesterLabel("m5/t3", panes, spaces), "m5/t3");
  assert.equal(requesterLabel("m6/t3", panes, spaces), "m6/t3");
});

test("requesterLabel counts only terminal panes, and only those in the same tab", () => {
  const spaces = spaceWith(["a", "LightPlay", true], ["b", "LightPlay", true]);
  const panes = [terminal("t1", "a"), { pane: "p-mod", terminal: null, tab: "a", name: "LightPlay" }, terminal("t2", "b")];

  assert.equal(requesterLabel("t1", panes, spaces), "LightPlay");
  assert.equal(requesterLabel("t9", panes, spaces), "t9");
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
