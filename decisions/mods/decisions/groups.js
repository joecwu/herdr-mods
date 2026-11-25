// Which space a decision belongs to. Pure, so it runs under `node --test`.

import { PENDING } from "./decision-file.js";

const pendingFirst = (a, b) => Number(a.status !== PENDING) - Number(b.status !== PENDING);

/**
 * Groups every project's decisions by space, in the spaces' own order.
 *
 * `places` says where things are now: `order` lists the spaces as `{ id, name }`, `terminals`
 * maps a terminal address to its space, `roots` maps a project root to the first space with a
 * pane in it. A decision goes to its requester's space; when that terminal is gone, to a space
 * open on its project; otherwise the project is its own group, after the spaces.
 * Each item gains `project`, its project's name. Groups without decisions are left out.
 */
export function bySpace(projects, places) {
  const groups = new Map(places.order.map((space) => [space.id, { ...space, items: [] }]));
  for (const project of projects) {
    for (const item of project.items) {
      const place = places.terminals.get(item.requester) ?? places.roots.get(project.root) ?? { id: `project:${project.root}`, name: project.name };
      if (!groups.has(place.id)) groups.set(place.id, { ...place, items: [] });
      groups.get(place.id).items.push({ ...item, project: project.name });
    }
  }
  return [...groups.values()].filter((group) => group.items.length).map((group) => {
    const items = [...group.items].sort(pendingFirst);
    return { ...group, items, pending: items.filter((item) => item.status === PENDING).length };
  });
}
