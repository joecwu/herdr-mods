// Telling the requesting session what was decided. `hc` is passed in, so this runs under `node --test`.

/**
 * Sends `message` to the session at `address` with `hc send`. Resolves with null when it went
 * through, else the line for the person, naming the session by `label` and keeping hc's reason.
 */
export async function tellRequester(hc, { address, label, message }, text) {
  try {
    const r = await hc(["send", address, message]);
    return r.code === 0 ? null : text.notifyFailed(label, (r.stderr || r.stdout).trim());
  } catch (e) { return text.notifyFailed(label, e); }
}
