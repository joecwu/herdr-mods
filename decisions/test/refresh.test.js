import { test } from "node:test";
import assert from "node:assert/strict";
import { Refresher } from "../mods/decisions/refresh.js";
import { placeKey, placesOf, mergeSnapshots, newlyPending } from "../mods/decisions/places.js";
import { bySpace } from "../mods/decisions/groups.js";

const decision = (title, status = "pending") => `---\ntitle: ${title}\nstatus: ${status}\nrequester: t1\n---\nBody\n`;
const NOT_A_REPO = { code: 128, stdout: "", stderr: "fatal: not a git repository (or any of the parent directories): .git\n" };

// Panes, files and git repositories on this machine (null) and others, behind Herdr's I/O calls.
// `onPublish` does what the panel does with a read: merge, announce, count the badge.
class World {
  constructor(fixedRoots = null) {
    this.files = new Map(); this.repos = new Map(); this.panes = []; this.layouts = new Map();
    this.calls = []; this.rules = []; this.offline = new Set(); this.holds = new Map();
    this.announced = new Set(); this.toasts = []; this.publishes = []; this.waiters = [];
    this.refresher = new Refresher({
      exec: (...call) => this.exec(...call),
      readTextFile: (...call) => this.readTextFile(...call),
      panes: () => this.panes,
      machines: () => [{ name: null, layout: "ready" }, ...[...this.layouts].map(([name, layout]) => ({ name, layout }))],
      onPublish: (change) => this.published(change),
    }, fixedRoots);
  }

  pane(on, cwd) {
    const n = this.panes.length + 1;
    this.panes.push({ pane: on ? `${on}/p${n}` : `p${n}`, terminal: on ? `${on}/t${n}` : `t${n}`, tab: "tab", name: null, cwd });
    if (on && !this.layouts.has(on)) this.layouts.set(on, "ready");
  }

  closePanes(on) { this.panes = this.panes.filter((p) => !p.pane.startsWith(`${on}/`)); }
  repo(on, root, ...folders) { for (const folder of [root, ...folders]) this.repos.set(placeKey(on, folder), root); }
  write(on, path, text) { if (text === null) this.files.delete(placeKey(on, path)); else this.files.set(placeKey(on, path), text); }

  hold(on) {
    let release;
    this.holds.set(on, new Promise((resolve) => { release = resolve; }));
    return () => { this.holds.delete(on); release(); };
  }

  async exec(command, args, options) {
    const on = options.on ?? null;
    this.calls.push({ command, args, options });
    if (this.holds.has(on)) await this.holds.get(on);
    if (this.offline.has(on)) throw new Error("machine unreachable");
    const ruled = this.rules.map((rule) => rule(command, args, options)).find((answer) => answer !== undefined);
    if (ruled instanceof Error) throw ruled;
    if (ruled) return ruled;
    if (command === "true") return { code: 0, stdout: "", stderr: "" };
    if (command === "git") {
      const root = this.repos.get(placeKey(on, options.cwd));
      return root ? { code: 0, stdout: `${root}\n`, stderr: "" } : NOT_A_REPO;
    }
    if (command === "find") {
      const prefix = `${placeKey(on, args[0])}/`;
      const inside = [...this.files.keys()].filter((key) => key.startsWith(prefix));
      if (!inside.length) return { code: 1, stdout: "", stderr: `find: ${args[0]}: No such file or directory\n` };
      const listed = inside.filter((key) => !key.slice(prefix.length).includes("/") && key.endsWith(".md"));
      return { code: 0, stdout: listed.map((key) => key.slice(on ? on.length + 1 : 0)).join("\n"), stderr: "" };
    }
    throw new Error(`unexpected exec ${command}`);
  }

  async readTextFile(path, options) {
    const on = options.on ?? null;
    this.calls.push({ command: "readTextFile", args: [path], options });
    if (this.holds.has(on)) await this.holds.get(on);
    if (this.offline.has(on)) throw new Error("machine unreachable");
    return this.files.get(placeKey(on, path)) ?? null;
  }

  published(change) {
    const { projects, warnings } = mergeSnapshots(this.refresher.machines);
    const { fresh, announced } = newlyPending(this.announced, projects, new Set(change.first ? [change.on] : []));
    this.announced = announced;
    this.toasts.push(...fresh.map((item) => item.title));
    const view = { ...change, loaded: this.refresher.loaded, titles: projects.flatMap((p) => p.items.map((item) => item.title)), warnings, badge: announced.size };
    this.publishes.push(view);
    this.waiters = this.waiters.filter((waiter) => !(waiter.test(view) && (waiter.resolve(view), true)));
  }

  // The next publish that passes `test`; fails instead of hanging when none comes.
  next(test) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no matching publish")), 500);
      this.waiters.push({ test, resolve: (view) => { clearTimeout(timer); resolve(view); } });
    });
  }

  get last() { return this.publishes.at(-1); }
  callsOn(on, command) { return this.calls.filter((c) => (c.options.on ?? null) === on && c.command === command); }
}

// This machine with /repo and decision "local", m5 with /srv and decision "remote".
const twoMachines = () => {
  const w = new World();
  w.pane(null, "/repo"); w.repo(null, "/repo"); w.write(null, "/repo/.decisions/a.md", decision("local"));
  w.pane("m5", "/srv"); w.repo("m5", "/srv"); w.write("m5", "/srv/.decisions/b.md", decision("remote"));
  return w;
};

test("a machine that is slow to answer holds up no update on this machine", async () => {
  const w = twoMachines();
  await w.refresher.refresh();
  const release = w.hold("m5");

  w.write(null, "/repo/.decisions/a.md", decision("local v1"));
  const v1 = w.next((view) => view.on === null);
  w.refresher.refresh();
  assert.deepEqual((await v1).titles, ["local v1", "remote"]);

  w.write(null, "/repo/.decisions/a.md", decision("local v2"));
  const v2 = w.next((view) => view.on === null);
  w.refresher.refresh();
  assert.deepEqual((await v2).titles, ["local v2", "remote"]);

  w.write("m5", "/srv/.decisions/b.md", decision("remote v1"));
  const remote = w.next((view) => view.on === "m5");
  release();
  assert.deepEqual((await remote).titles, ["local v2", "remote v1"]);
  await w.refresher.refresh();
  assert.deepEqual(w.last.titles, ["local v2", "remote v1"]);
});

test("the first load lasts until every machine it started with has answered once, even with a failure", async () => {
  const w = new World();
  w.pane(null, "/repo"); w.repo(null, "/repo");
  w.pane("m5", "/srv"); w.repo("m5", "/srv"); w.write("m5", "/srv/.decisions/b.md", decision("remote"));
  const release = w.hold("m5");
  w.offline.add("m5");

  const local = w.next((view) => view.on === null);
  const done = w.refresher.refresh();
  assert.deepEqual(await local, { on: null, first: true, loaded: false, titles: [], warnings: [], badge: 0 });

  release();
  await done;
  assert.equal(w.last.on, "m5");
  assert.equal(w.last.loaded, true);
});

test("reads on another machine time out after 5 s, and reads here keep exec's default", async () => {
  const w = twoMachines();
  await w.refresher.refresh();

  for (const command of ["true", "git", "find"]) {
    assert.ok(w.callsOn("m5", command).length, command);
    for (const call of w.callsOn("m5", command)) assert.equal(call.options.timeout, 5000, command);
  }
  for (const call of w.calls.filter((c) => !c.options.on && c.command !== "readTextFile")) assert.ok(!("timeout" in call.options), call.command);
  for (const call of w.calls.filter((c) => c.command === "readTextFile")) assert.deepEqual(Object.keys(call.options), ["on"]);
  assert.equal(w.callsOn(null, "true").length, 0);
});

test("a project that fails to read keeps its last read, and the machine's other projects update", async () => {
  const w = new World();
  w.pane("m5", "/srv/a"); w.repo("m5", "/srv/a"); w.write("m5", "/srv/a/.decisions/a.md", decision("a1"));
  w.pane("m5", "/srv/b"); w.repo("m5", "/srv/b"); w.write("m5", "/srv/b/.decisions/b.md", decision("b1"));
  await w.refresher.refresh();

  w.rules.push((command, args) => (command === "find" && args[0] === "/srv/a/.decisions" ? new Error("no such folder") : undefined));
  w.write("m5", "/srv/b/.decisions/c.md", decision("b2"));
  await w.refresher.refresh();

  assert.deepEqual(w.last.titles, ["a1", "b1", "b2"]);
  assert.deepEqual(w.last.warnings, [{ kind: "projectFailed", project: "a @m5", why: "no such folder" }]);
});

test("a machine whose probe is refused keeps every project's last read and says it can't be reached", async () => {
  const w = new World();
  w.pane("m5", "/srv/a"); w.repo("m5", "/srv/a"); w.write("m5", "/srv/a/.decisions/a.md", decision("a1"));
  w.pane("m5", "/srv/b"); w.repo("m5", "/srv/b"); w.write("m5", "/srv/b/.decisions/b.md", decision("b1"));
  await w.refresher.refresh();
  const before = w.calls.length;

  w.offline.add("m5");
  await w.refresher.refresh();

  assert.deepEqual(w.last.titles, ["a1", "b1"]);
  assert.deepEqual(w.last.warnings, [{ kind: "unreachable", machine: "m5", stale: true }]);
  assert.deepEqual(w.calls.slice(before).map((c) => c.command), ["true"]);
});

test("a probe that does not exit 0, as when it timed out, counts as unreachable", async () => {
  const w = twoMachines();
  await w.refresher.refresh();

  w.rules.push((command) => (command === "true" ? { code: 124, stdout: "", stderr: "timed out\n" } : undefined));
  await w.refresher.refresh();

  assert.deepEqual(w.last.titles, ["local", "remote"]);
  assert.deepEqual(w.last.warnings, [{ kind: "unreachable", machine: "m5", stale: true }]);
});

test("a machine Herdr lists as unavailable keeps its last read without being asked", async () => {
  const w = twoMachines();
  await w.refresher.refresh();
  const before = w.callsOn("m5", "true").length;

  w.layouts.set("m5", "unavailable");
  await w.refresher.refresh();

  assert.deepEqual(w.last.titles, ["local", "remote"]);
  assert.deepEqual(w.last.warnings, [{ kind: "unreachable", machine: "m5", stale: true }]);
  assert.equal(w.callsOn("m5", "true").length, before);
});

test("a machine never reached shows only the warning", async () => {
  const w = twoMachines();
  w.offline.add("m5");
  await w.refresher.refresh();

  assert.deepEqual(w.last.titles, ["local"]);
  assert.deepEqual(w.last.warnings, [{ kind: "unreachable", machine: "m5", stale: false }]);
  assert.deepEqual(w.toasts, []);
});

test("a confirmed empty read replaces the last one", async () => {
  const w = twoMachines();
  w.pane("m5", "/srv/two"); w.repo("m5", "/srv/two"); w.write("m5", "/srv/two/.decisions/c.md", decision("two"));
  await w.refresher.refresh();
  assert.equal(w.last.badge, 3);

  w.write("m5", "/srv/.decisions/b.md", null);
  w.write("m5", "/srv/two/.decisions/c.md", null);
  w.write("m5", "/srv/two/.decisions/done/c.md", decision("two", "decided"));
  await w.refresher.refresh();

  assert.deepEqual(w.last.titles, ["local"]);
  assert.deepEqual(w.last.warnings, []);
  assert.equal(w.last.badge, 1);
});

test("each machine's first read is silent, offline keeps the badge, and a reconnect replays nothing", async () => {
  const w = twoMachines();
  await w.refresher.refresh();
  assert.deepEqual(w.toasts, []);
  assert.equal(w.last.badge, 2);

  w.offline.add("m5");
  await w.refresher.refresh();
  assert.equal(w.last.badge, 2);

  w.offline.delete("m5");
  await w.refresher.refresh();
  assert.deepEqual(w.toasts, []);

  w.write("m5", "/srv/.decisions/c.md", decision("new on m5"));
  await w.refresher.refresh();
  await w.refresher.refresh();
  assert.deepEqual(w.toasts, ["new on m5"]);
  assert.equal(w.last.badge, 3);
});

test("a machine whose every project failed to read has no baseline, and claims no last read", async () => {
  const w = new World();
  w.pane("m5", "/srv"); w.repo("m5", "/srv");
  let failing = true;
  w.rules.push((command) => (command === "find" && failing ? new Error("no such folder") : undefined));
  await w.refresher.refresh();

  w.offline.add("m5");
  await w.refresher.refresh();
  assert.deepEqual(w.last.warnings, [{ kind: "unreachable", machine: "m5", stale: false }]);

  w.offline.delete("m5"); failing = false;
  w.write("m5", "/srv/.decisions/a.md", decision("waiting"));
  await w.refresher.refresh();
  assert.deepEqual(w.last.titles, ["waiting"]);
  assert.deepEqual(w.toasts, []);
});

test("a machine first reached later joins silently, and its next decision notifies", async () => {
  const w = twoMachines();
  w.offline.add("m5");
  await w.refresher.refresh();
  w.offline.delete("m5");
  await w.refresher.refresh();
  assert.deepEqual(w.toasts, []);
  assert.deepEqual(w.last.titles, ["local", "remote"]);

  w.write("m5", "/srv/.decisions/c.md", decision("later"));
  await w.refresher.refresh();
  assert.deepEqual(w.toasts, ["later"]);
});

test("a machine whose panes are gone keeps its read while offline and drops it once ready", async () => {
  const w = twoMachines();
  await w.refresher.refresh();

  w.closePanes("m5");
  w.layouts.set("m5", "unavailable");
  await w.refresher.refresh();
  assert.deepEqual(w.last.titles, ["local", "remote"]);
  assert.deepEqual(w.last.warnings, [{ kind: "unreachable", machine: "m5", stale: true }]);

  w.layouts.set("m5", "ready");
  await w.refresher.refresh();
  assert.deepEqual(w.last.titles, ["local"]);
  assert.equal(w.last.badge, 1);
  assert.ok(!w.refresher.machines.has("m5"));
});

test("a git lookup that could not run is tried again, and cached once it answers", async () => {
  const w = new World();
  w.pane("m5", "/srv/app/sub"); w.repo("m5", "/srv/app", "/srv/app/sub"); w.write("m5", "/srv/app/.decisions/a.md", decision("at the root"));
  let refused = 1;
  w.rules.push((command) => (command === "git" && refused-- > 0 ? new Error("no such folder") : undefined));

  await w.refresher.refresh();
  assert.deepEqual(w.last.titles, []);
  await w.refresher.refresh();
  assert.deepEqual(w.last.titles, ["at the root"]);
  await w.refresher.refresh();
  assert.equal(w.callsOn("m5", "git").length, 2);
});

test("a folder git says is not a repository is its own root, and is not asked again", async () => {
  const w = new World();
  w.pane("m5", "/notes"); w.write("m5", "/notes/.decisions/n.md", decision("notes"));

  await w.refresher.refresh();
  await w.refresher.refresh();

  assert.deepEqual(w.last.titles, ["notes"]);
  assert.equal(w.callsOn("m5", "git").length, 1);
});

test("any other git error is not cached, and the next refresh finds the root", async () => {
  const w = new World();
  w.pane("m5", "/srv/app/sub"); w.repo("m5", "/srv/app", "/srv/app/sub"); w.write("m5", "/srv/app/.decisions/a.md", decision("at the root"));
  let failing = 1;
  w.rules.push((command) => (command === "git" && failing-- > 0 ? { code: 128, stdout: "", stderr: "fatal: detected dubious ownership in repository at '/srv/app'\n" } : undefined));

  await w.refresher.refresh();
  assert.deepEqual(w.last.titles, []);
  await w.refresher.refresh();

  assert.deepEqual(w.last.titles, ["at the root"]);
  assert.equal(w.refresher.roots.get("m5", "/srv/app/sub"), "/srv/app");
  assert.equal(w.callsOn("m5", "git").length, 2);
});

test("a read under an unconfirmed root never clears that project's cards", async () => {
  const w = new World();
  w.pane("m5", "/srv/x"); w.write("m5", "/srv/x/.decisions/x.md", decision("x1"));
  w.rules.push((command) => (command === "git" ? new Error("git timed out") : undefined));

  await w.refresher.refresh();
  assert.deepEqual(w.last.titles, ["x1"]);
  w.write("m5", "/srv/x/.decisions/x.md", null);
  await w.refresher.refresh();

  assert.deepEqual(w.last.titles, ["x1"]);
});

test("a read under an unconfirmed root only adds cards, so none drops out and comes back as new", async () => {
  const w = new World();
  w.pane("m5", "/srv"); w.repo("m5", "/srv");
  w.pane("m5", "/srv/x");
  w.rules.push((command, _args, options) => (command === "git" && options.cwd === "/srv/x" ? new Error("git timed out") : undefined));
  const badges = [];
  for (const files of [["a", "b"], ["b"], ["a", "b"]]) {
    for (const name of ["a", "b"]) w.write("m5", `/srv/x/.decisions/${name}.md`, files.includes(name) ? decision(name) : null);
    await w.refresher.refresh();
    badges.push(w.last.badge);
  }

  assert.deepEqual(badges, [2, 2, 2]);
  assert.deepEqual(w.last.titles, ["a", "b"]);
  assert.deepEqual(w.toasts, []);
});

test("fixed roots are read on this machine as they are, with no git and no other machine", async () => {
  const w = new World(["/fixed"]);
  w.pane("m5", "/srv"); w.write("m5", "/srv/.decisions/b.md", decision("remote"));
  w.write(null, "/fixed/.decisions/f.md", decision("fixed"));

  await w.refresher.refresh();

  assert.deepEqual(w.last.titles, ["fixed"]);
  assert.deepEqual(w.calls.map((c) => [c.command, c.options.on ?? null]), [["find", null], ["readTextFile", null]]);
});

test("fixed roots are not grouped into the space of a pane open on the same folder", async () => {
  const w = new World(["/fixed"]);
  w.pane(null, "/fixed");
  w.write(null, "/fixed/.decisions/f.md", "---\ntitle: fixed\nstatus: pending\nrequester: t9\n---\n");
  await w.refresher.refresh();

  const spaces = [{ id: "s1", name: "Space", tabs: [{ id: "tab", name: "tab", named: false }] }];
  const places = placesOf(spaces, w.panes, (on, folder) => w.refresher.rootOf(on, folder));
  const groups = bySpace(mergeSnapshots(w.refresher.machines).projects, places);

  assert.deepEqual(groups.map((g) => [g.id, g.items.map((i) => i.title)]), [["project:/fixed", ["fixed"]]]);
});
