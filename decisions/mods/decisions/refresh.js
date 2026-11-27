// Reading the decisions of every project with an open pane. Herdr's I/O is passed in, so this runs
// under `node --test`.

import { placeKey } from "./places.js";

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
    try { r = await this.exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on }); }
    catch { return { root: folder, confirmed: false }; }
    const root = r.code === 0 ? r.stdout.trim() : /not a git repository/i.test(r.stderr) ? folder : "";
    if (!root) return { root: folder, confirmed: false };
    this.known.set(key, root);
    return { root, confirmed: true };
  }
}
