// Where panes, projects and requesters are, across machines. Pure, so it runs under `node --test`.

/** The machine a remote pane, tab or terminal id names with its "machine/" prefix; null for this one. */
export const machineOf = (id) => (id?.includes("/") ? id.slice(0, id.indexOf("/")) : null);

/** A path's key across machines: "machine:path" on another machine, the bare path on this one. */
export const placeKey = (on, path) => (on ? `${on}:${path}` : path);

/** A requester as hc addresses it from here: remote sessions write their bare $HC_TERMINAL_ID. */
export const addressOf = (on, requester) => (on && requester && !requester.includes("/") ? `${on}/${requester}` : requester);
