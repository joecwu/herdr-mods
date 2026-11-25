import test from "node:test";
import assert from "node:assert/strict";
import { bySpace } from "../mods/decisions/groups.js";

const play = { id: "s1", name: "LightPlay" };
const sre = { id: "s2", name: "SRE" };
const item = (path, requester, status = "pending") => ({ path, requester, status });
const places = (over = {}) => ({ order: [play, sre], terminals: new Map(), roots: new Map(), ...over });

test("puts a decision in its requester's space, not the space of its folder", () => {
  const projects = [{ root: "/work/shared", name: "shared", items: [item("a", "t1"), item("b", "t2")] }];
  const groups = bySpace(projects, places({ terminals: new Map([["t1", play], ["t2", sre]]), roots: new Map([["/work/shared", play]]) }));
  assert.deepEqual(groups.map((g) => [g.name, g.items.map((i) => i.path)]), [["LightPlay", ["a"]], ["SRE", ["b"]]]);
});

test("falls back to a space open on the project when the requester is gone", () => {
  const projects = [{ root: "/work/sre", name: "sre", items: [item("a", "t-closed")] }];
  const groups = bySpace(projects, places({ roots: new Map([["/work/sre", sre]]) }));
  assert.deepEqual(groups.map((g) => g.name), ["SRE"]);
});

test("gives a project no space knows its own group, after the spaces", () => {
  const projects = [
    { root: "/work/demo", name: "demo", items: [item("a", "")] },
    { root: "/work/play", name: "play", items: [item("b", "t1")] },
  ];
  const groups = bySpace(projects, places({ terminals: new Map([["t1", play]]) }));
  assert.deepEqual(groups.map((g) => g.name), ["LightPlay", "demo"]);
});

test("counts pending decisions and lists them before decided ones", () => {
  const projects = [{ root: "/r", name: "r", items: [item("done", "t1", "decided"), item("open", "t1")] }];
  const [group] = bySpace(projects, places({ terminals: new Map([["t1", play]]) }));
  assert.equal(group.pending, 1);
  assert.deepEqual(group.items.map((i) => i.path), ["open", "done"]);
});

test("keeps the spaces' order, leaves out empty ones and names each item's project", () => {
  const projects = [{ root: "/r", name: "repo", items: [item("a", "t2")] }];
  const groups = bySpace(projects, places({ terminals: new Map([["t2", sre]]) }));
  assert.deepEqual(groups.map((g) => g.name), ["SRE"]);
  assert.equal(groups[0].items[0].project, "repo");
});
