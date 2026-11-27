// Where panes, projects and requesters are, across machines. Pure, so it runs under `node --test`.

import { PENDING } from "./decision-file.js";

/** The machine a remote pane, tab or terminal id names with its "machine/" prefix; null for this one. */
export const machineOf = (id) => (id?.includes("/") ? id.slice(0, id.indexOf("/")) : null);

/** A path's key across machines: "machine:path" on another machine, the bare path on this one. */
export const placeKey = (on, path) => (on ? `${on}:${path}` : path);

/** A requester as hc addresses it from here: remote sessions write their bare $HC_TERMINAL_ID. */
export const addressOf = (on, requester) => (on && requester && !requester.includes("/") ? `${on}/${requester}` : requester);

/**
 * Every machine's last read (a Refresher's `machines`) as one list of projects, in the machines'
 * order, and the warnings to show: `unreachable` for a machine that can't be reached (`stale` when
 * its last read is still shown), `projectFailed` for a project whose read failed on a machine that
 * answered, and `failed` for a machine whose read failed outright.
 */
export function mergeSnapshots(machines) {
  const projects = [], warnings = [];
  for (const [on, entry] of machines) {
    const unreachable = entry.state === "unreachable";
    if (entry.error) warnings.push({ kind: "failed", machine: on, why: entry.error });
    if (unreachable) warnings.push({ kind: "unreachable", machine: on, stale: entry.baselined });
    for (const project of entry.projects.values()) {
      if (project.error && !unreachable) warnings.push({ kind: "projectFailed", project: project.name, why: project.error });
      if (project.items) projects.push(project);
    }
  }
  return { projects, warnings };
}

/**
 * The pending decisions to announce. `announced` holds the keys already seen pending; a machine
 * in `quiet` was just read for the first time, so its decisions join without a notification.
 * Returns them as `fresh`, each with its `project` name, and `announced`, every key pending now.
 */
export function newlyPending(announced, projects, quiet) {
  const pending = projects.flatMap((p) => p.items.filter((i) => i.status === PENDING).map((i) => ({ ...i, project: p.name })));
  return {
    fresh: pending.filter((i) => !announced.has(i.key) && !quiet.has(i.on ?? null)),
    announced: new Set(pending.map((i) => i.key)),
  };
}
