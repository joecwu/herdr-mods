// Reading the decisions of every project with an open pane, on this machine and others. Herdr's
// I/O is passed in, so this runs under `node --test`.

import { parse } from "./decision-file.js";
import { machineOf, placeKey, addressOf, mergeSnapshots } from "./places.js";

export const DIR = ".decisions";
// exec waits 30 s by default; a slow machine should not keep its cards that stale.
const REMOTE_TIMEOUT_MS = 5000;

const reason = (e) => String(e?.message ?? e);
// Reads on another machine give up after REMOTE_TIMEOUT_MS. Calls on this one keep exec's default.
const readOptions = (on, options = {}) => (on ? { ...options, on, timeout: REMOTE_TIMEOUT_MS } : { ...options, on });

/**
 * Git roots of pane folders. Only a confirmed answer is kept: a lookup that could not run, or that
 * git answered with an error other than "not a git repository", is asked again next time.
 */
export class Roots {
  constructor(exec) { this.exec = exec; this.known = new Map(); }

  /** The root already confirmed for a folder, or undefined. */
  get(on, folder) { return this.known.get(placeKey(on, folder)); }

  /** Resolves with `{ root, confirmed }`. An unconfirmed root is the folder itself, for this read only. */
  async of(folder, on = null) {
    const key = placeKey(on, folder);
    if (this.known.has(key)) return { root: this.known.get(key), confirmed: true };
    let r;
    try { r = await this.exec("git", ["rev-parse", "--show-toplevel"], readOptions(on, { cwd: folder })); }
    catch { return { root: folder, confirmed: false }; }
    const root = r.code === 0 ? r.stdout.trim() : /not a git repository/i.test(r.stderr) ? folder : "";
    if (!root) return { root: folder, confirmed: false };
    this.known.set(key, root);
    return { root, confirmed: true };
  }
}

/**
 * Keeps the last read of every machine in `machines`: machine name (null for this one) to
 * `{ projects, state, baselined, reading, again, error }`. `projects` maps a project's key to
 * `{ root, dir, on, name, items, found, error, folder }`, where `items` is the last confirmed read
 * (null before one), `error` why this round's read failed, and `folder` the key of its first pane
 * folder. `state` is "ok" or "unreachable" after a read, `baselined` true once a project under a
 * confirmed root read without error.
 *
 * Each machine reads on its own and publishes when it is done, so a slow one holds up no other.
 * A machine counts as unreachable only on evidence: Herdr lists it unavailable, or this round's
 * probe was refused. Then every project keeps its last read. Once the probe answered, a failed
 * command only fails its project, which keeps its last read too.
 */
export class Refresher {
  /**
   * `io`: Herdr's `exec`, `readTextFile`, `panes` and `machines`, and `onPublish({ on, first })`,
   * called each time machine `on` lands a read (`first`: read before the machine had a baseline,
   * which it gets from its first read of a project under a confirmed root).
   * `fixedRoots`: folders on this machine to read instead of the panes' projects.
   */
  constructor(io, fixedRoots = null) {
    this.io = io; this.fixedRoots = fixedRoots;
    this.roots = new Roots(io.exec);
    this.machines = new Map();
    this.starting = null;
  }

  /** The project a pane's folder belongs to, for grouping. With fixed roots no pane maps to one. */
  rootOf(on, folder) { return this.fixedRoots ? null : this.roots.get(on, folder) ?? folder; }

  /** Every machine's last read as mergeSnapshots gives it, each project placed by its first pane. */
  snapshot() {
    const merged = mergeSnapshots(this.machines);
    if (this.fixedRoots) return merged;
    const order = this.io.panes().filter((p) => p.cwd).map((p) => placeKey(machineOf(p.pane), p.cwd));
    const rank = (project) => { const i = order.indexOf(project.folder); return i < 0 ? order.length : i; };
    merged.projects.sort((a, b) => rank(a) - rank(b));
    return merged;
  }

  /** True once every machine of the first refresh has finished a read, whether or not it worked. */
  get loaded() { return this.starting?.size === 0; }

  /** Reads every machine; one still reading reads again when it is done. Resolves when the reads it started land. */
  refresh() {
    const targets = this.targets();
    this.starting ??= new Set(targets);
    return Promise.all(targets.map((on) => {
      const entry = this.entry(on);
      if (entry.reading) { entry.again = true; return null; }
      return this.run(on, entry);
    }));
  }

  entry(on) {
    if (!this.machines.has(on)) this.machines.set(on, { projects: new Map(), state: null, baselined: false, reading: false, again: false, error: null });
    return this.machines.get(on);
  }

  // This machine, every machine with a pane, and every machine with a snapshot. A snapshot is
  // dropped once its machine has no pane and Herdr has its layout ready, so it is not just offline.
  targets() {
    if (this.fixedRoots) return [null];
    const targets = new Set([null, ...this.io.panes().filter((p) => p.cwd).map((p) => machineOf(p.pane))]);
    const ready = new Set(this.io.machines().filter((m) => m.layout === "ready").map((m) => m.name));
    for (const [on, entry] of this.machines) {
      if (targets.has(on)) continue;
      if (ready.has(on) && !entry.reading) this.machines.delete(on);
      else targets.add(on);
    }
    return [...targets];
  }

  folders(on) {
    if (this.fixedRoots) return this.fixedRoots;
    return [...new Set(this.io.panes().filter((p) => p.cwd && machineOf(p.pane) === on).map((p) => p.cwd))];
  }

  async run(on, entry) {
    do {
      entry.again = false; entry.reading = true;
      let first = false;
      try { first = await this.read(on, entry); entry.error = null; }
      catch (e) { entry.error = reason(e); }
      finally { entry.reading = false; this.starting.delete(on); }
      this.io.onPublish({ on, first });
    } while (entry.again);
  }

  /** Reads one machine into its entry. Resolves true while the machine has no baseline yet. */
  async read(on, entry) {
    const folders = this.folders(on);
    if (on) {
      const unavailable = this.io.machines().some((m) => m.name === on && m.layout === "unavailable");
      if (unavailable || !(await this.probe(on))) { entry.state = "unreachable"; return false; }
    }
    entry.state = "ok";
    // A machine whose panes are gone while its layout loads keeps what it showed.
    if (on && !folders.length) return false;
    const first = !entry.baselined;
    const projects = new Map();
    let confirmedRead = !folders.length;
    for (const folder of folders) {
      const { root, confirmed } = this.fixedRoots ? { root: folder, confirmed: true } : await this.roots.of(folder, on);
      const key = placeKey(on, root);
      if (projects.has(key)) continue;
      const project = { ...(await this.project(root, on, confirmed, entry.projects.get(key))), folder: placeKey(on, folder) };
      projects.set(key, project);
      if (confirmed && !project.error) confirmedRead = true;
    }
    entry.projects = projects;
    if (confirmedRead) entry.baselined = true;
    return first;
  }

  // `true` exits 0, so any other answer means it did not run to the end, as when it timed out.
  probe(on) {
    return this.io.exec("true", [], readOptions(on)).then((r) => r.code === 0, () => false);
  }

  // A read under a root git did not confirm only adds to the last read: a card it misses stays.
  async project(root, on, confirmed, last) {
    const dir = `${root}/${DIR}`;
    const project = { root: placeKey(on, root), dir, on, name: root.split("/").pop() + (on ? ` @${on}` : "") };
    try {
      const read = await this.readDir(dir, on);
      if (!confirmed && last?.items) {
        const merged = new Map([...last.items, ...read.items].map((i) => [i.key, i]));
        read.items = [...merged.values()].sort((x, y) => (x.path < y.path ? -1 : 1));
      }
      return { ...project, ...read, error: null };
    } catch (e) {
      return { ...project, items: last?.items ?? null, found: false, error: reason(e) };
    }
  }

  // No .decisions folder is a confirmed empty read; any other failure throws.
  async readDir(dir, on) {
    const found = await this.io.exec("find", [dir, "-maxdepth", "1", "-type", "f", "-name", "*.md"], readOptions(on));
    if (found.code !== 0) {
      if (/No such file or directory/.test(found.stderr)) return { items: [], found: false };
      throw new Error((found.stderr || found.stdout).trim() || `find exited with ${found.code}`);
    }
    const items = [];
    for (const path of found.stdout.split("\n").filter(Boolean).sort()) {
      const item = parse(await this.io.readTextFile(path, { on }), path);
      if (item) items.push({ ...item, on, key: placeKey(on, path), requester: addressOf(on, item.requester) });
    }
    return { items, found: true };
  }
}
