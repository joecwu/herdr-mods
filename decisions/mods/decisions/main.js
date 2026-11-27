// Decisions waiting for the person, across every project with an open pane.
// Each decision is one markdown file in <project>/.decisions/<id>.md, written by
// an agent session. Deciding here rewrites the file's frontmatter (the source of
// truth) and tells the requesting session with `hc send`. Decisions are grouped by the space
// that asked, with a tab per space to show one at a time.
//
// Block props, all optional:
//   lang   "en" (default) or "zh-TW"
//   block  this block's id in the layout, when it isn't "decisions"
//   roots  project folders to show instead of the open panes' projects; such a
//          copy is a plain view and leaves notifications and the Dock badge alone
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextView, Scrollbar } from "gpui-base";
import { parse, withMeta, decidedMeta, segments, PENDING, APPROVED, REJECTED } from "./decision-file.js";
import { strings } from "./strings.js";
import { bySpace } from "./groups.js";
import { machineOf, placeKey, addressOf } from "./places.js";
import { Roots } from "./refresh.js";
import { panes, spaces, focused, props, layout, exec, hc, readTextFile, writeTextFile, watchFolder, theme, settings, notify, setBadge, checking, run } from "herdr";

const DIR = ".decisions";
const REFRESH_MS = 15000;
const RAIL_PX = 44;
const OPEN_PX = 340;
const NARROW_BELOW = 120;
const MAIN_BLOCK = "main";
const READING_WIDTH = 860;

const paneFolders = () => {
  const seen = new Map();
  for (const p of panes()) if (p.cwd) seen.set(placeKey(machineOf(p.pane), p.cwd), { on: machineOf(p.pane), folder: p.cwd });
  return [...seen.values()];
};
const isPending = (item) => item.status === PENDING;

export default class Decisions extends View {
  init(_props, cx) {
    this.projects = []; this.roots = new Roots(exec); this.known = false; this.announced = null; this.watching = new Set();
    this.text = strings(props()?.lang); this.fixedRoots = Array.isArray(props()?.roots) ? props().roots : null;
    this.toggled = new Set(); this.notes = new Map(); this.rejecting = new Set(); this.busy = new Set(); this.message = null; this.badge = null; this.tab = null;
    if (checking()) return;
    this.refresh(cx);
    cx.timer.every(REFRESH_MS, (cx) => this.refresh(cx));
  }

  // `root` is the folder on machine `on`; the project's `root` field is that place's key.
  async readProject(root, on = null) {
    const dir = `${root}/${DIR}`;
    const found = await exec("find", [dir, "-maxdepth", "1", "-type", "f", "-name", "*.md"], { on });
    if (found.code !== 0) return null;
    const items = [];
    for (const path of found.stdout.split("\n").filter(Boolean).sort()) {
      const item = parse(await readTextFile(path, { on }), path);
      if (item) items.push({ ...item, on, key: placeKey(on, path), requester: addressOf(on, item.requester) });
    }
    return { root: placeKey(on, root), dir, on, name: root.split("/").pop() + (on ? ` @${on}` : ""), items };
  }

  // Only this machine's folders can be watched; remote ones are read on the refresh timer.
  watch(dir, on, cx) {
    if (on || this.watching.has(dir)) return;
    this.watching.add(dir);
    cx.spawn(async (cx) => {
      try { for (;;) { await watchFolder(dir); this.refresh(cx); } }
      catch { this.watching.delete(dir); }
    });
  }

  refresh(cx) {
    if (this.loading) { this.again = true; return; }
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const roots = new Map();
        if (this.fixedRoots) this.fixedRoots.forEach((root) => roots.set(root, { root, on: null }));
        else {
          for (const { folder, on } of paneFolders()) {
            const { root } = await this.roots.of(folder, on);
            roots.set(placeKey(on, root), { root, on });
          }
        }
        const projects = [];
        for (const { root, on } of roots.values()) {
          // An unreachable machine skips its projects instead of failing the whole panel.
          const project = await this.readProject(root, on).catch(() => null);
          if (!project) continue;
          projects.push(project);
          this.watch(project.dir, on, cx);
        }
        if (!this.fixedRoots) this.announce(projects);
        this.known = true;
        this.projects = projects;
        this.message = null;
      } catch (e) { this.message = this.text.readFailed(e); }
      finally {
        this.loading = false;
        cx.notify();
        if (this.again) { this.again = false; this.refresh(cx); }
      }
    });
  }

  // Toasts for decisions that appeared since the last read, and the Dock badge.
  announce(projects) {
    const pending = projects.flatMap((p) => p.items.filter(isPending).map((i) => ({ ...i, project: p.name })));
    if (this.announced) {
      for (const item of pending) {
        if (!this.announced.has(item.key)) notify({ title: this.text.toastTitle(item.project), body: item.title, level: "warning" });
      }
    }
    this.announced = new Set(pending.map((i) => i.key));
    const badge = pending.length ? String(pending.length) : null;
    if (badge !== this.badge) { this.badge = badge; setBadge(badge); }
  }

  // InputState can't be created while rendering, so the note field is added by a click.
  addNote(key, cx) {
    if (!this.notes.has(key)) this.notes.set(key, InputState.new({ placeholder: this.text.notePlaceholder }));
    cx.notify();
  }

  // Rejecting asks for the reason first: the session needs it to know how to go on.
  startReject(item, cx) {
    const input = InputState.new({ placeholder: this.text.reasonPlaceholder, value: this.notes.get(item.key)?.value() ?? "" });
    input.on("submit", (_e, cx) => this.decide(item, REJECTED, cx));
    this.notes.set(item.key, input);
    this.rejecting.add(item.key);
    input.focus();
    cx.notify();
  }

  cancelReject(key, cx) {
    this.rejecting.delete(key);
    this.notes.delete(key);
    cx.notify();
  }

  // Who asked, as the person knows it: the requester's tab title when the tab was named (by
  // hand or a tab-title mod), else its pane's name, else the terminal address.
  who(requester) {
    const pane = panes().find((p) => p.terminal === requester);
    if (!pane) return requester;
    const tab = spaces().flatMap((space) => space.tabs).find((tab) => tab.id === pane.tab);
    return (tab?.named && tab.name) || pane.name || requester;
  }

  label(decision) {
    return decision === APPROVED ? this.text.approve : decision === REJECTED ? this.text.rejected : decision;
  }

  // Tells the requesting session. Resolves with a message for the person, or null when all went well.
  async tell(item, decision, note) {
    if (!item.requester) return this.text.noRequester;
    const message = this.text.sessionMessage({ title: item.title, rejected: decision === REJECTED, label: this.label(decision), note, path: item.path, dir: DIR });
    try {
      const r = await hc(["send", item.requester, message]);
      return r.code === 0 ? null : this.text.notifyFailed(item.requester, (r.stderr || r.stdout).trim());
    } catch (e) { return this.text.notifyFailed(item.requester, e); }
  }

  decide(item, decision, cx) {
    if (this.busy.has(item.key)) return;
    this.busy.add(item.key);
    const note = (this.notes.get(item.key)?.value() ?? "").trim();
    const on = item.on ?? null;
    cx.spawn(async (cx) => {
      try {
        const current = await readTextFile(item.path, { on });
        if (current === null) throw new Error(this.text.fileGone);
        if (parse(current, item.path)?.status !== PENDING) throw new Error(this.text.alreadyDecided);
        const next = withMeta(current, decidedMeta(decision, note, new Date()));
        // writeTextFile only writes on this machine and may refuse a path outside the app's home:
        // otherwise write through the shell, on the file's machine.
        const shellWrite = async (why) => {
          const r = await exec("sh", ["-c", 'printf %s "$1" > "$2"', "decisions", next, item.path], { on });
          if (r.code !== 0) throw new Error(`${why ?? ""}${why ? "; " : ""}${r.stderr.trim()}`);
        };
        if (on) await shellWrite(null);
        else {
          try { await writeTextFile(item.path, next, current); }
          catch (e) { await shellWrite(String(e)); }
        }
        this.message = await this.tell(item, decision, note);
        this.notes.delete(item.key); this.rejecting.delete(item.key);
      } catch (e) { this.message = this.text.writeFailed(e.message ?? e); }
      finally { this.busy.delete(item.key); this.refresh(cx); cx.notify(); }
    });
    cx.notify();
  }

  resend(item, cx) {
    cx.spawn(async (cx) => { this.message = (await this.tell(item, item.decision, item.note)) ?? this.text.notified(this.who(item.requester)); cx.notify(); });
  }

  block() { return props()?.block ?? "decisions"; }

  // Zoomed means the tab area is hidden and this panel takes its room. It is read from the
  // layout, so it stays right after a reload. Pane zoom (pane.zoom) is separate and untouched.
  zoomed() {
    const find = (node) => node?.id === MAIN_BLOCK ? node : (node?.children ?? []).map(find).find(Boolean);
    return Boolean(find(layout())?.hidden);
  }

  resize(px) {
    if (this.zoomed()) run("layout.show", { id: MAIN_BLOCK });
    run("layout.resize", { id: this.block(), px });
  }

  toggleZoom() {
    if (this.zoomed()) return this.resize(OPEN_PX);
    run("layout.resize", { id: this.block(), weight: 1 });
    run("layout.hide", { id: MAIN_BLOCK });
  }

  // Where spaces, terminals and projects are right now, for bySpace.
  places() {
    const tabs = new Map(), terminals = new Map(), roots = new Map();
    const order = spaces().map((space) => {
      const place = { id: space.id, name: space.name };
      for (const tab of space.tabs) tabs.set(tab.id, place);
      return place;
    });
    for (const pane of panes()) {
      const place = tabs.get(pane.tab);
      if (!place) continue;
      if (pane.terminal) terminals.set(pane.terminal, place);
      const on = machineOf(pane.pane);
      const root = this.roots.get(on, pane.cwd) ?? pane.cwd;
      if (root && !roots.has(placeKey(on, root))) roots.set(placeKey(on, root), place);
    }
    return { order, terminals, roots };
  }

  tabChip(id, label, count, selected, here, t, onClick) {
    return h_flex().id(id).flex_none().max_w(160).h(22).px(7).gap(5).items_center().rounded(6).border_1().cursor_pointer().text_size(11)
      .border_color(selected ? t.accent : t.border).bg(selected ? t.raised : t.background).text_color(selected || here ? t.foreground : t.muted)
      .hover((s) => s.bg(t.hover)).on_click(onClick)
      .child(div().min_w(0).truncate().when(here, (e) => e.font_semibold()).child(label))
      .child(div().flex_none().px(4).rounded(4).text_size(10).font_semibold().bg(count ? t.blocked : t.raised).text_color(count ? t.background : t.dim).child(String(count)));
  }

  button(id, label, t, primary, onClick) {
    return h_flex().id(id).min_h(28).px(10).py(4).items_center().rounded(7).border_1().cursor_pointer().text_size(12)
      .border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground)
      .hover((s) => s.opacity(0.85)).on_click(onClick).child(label);
  }

  body(item, key, t) {
    return segments(item.body).map((part, i) => {
      const id = `${key}-${i}`;
      if (part.text !== undefined) return div().w_full().text_size(12).text_color(t.foreground).child(TextView.markdown(`dec-body-${id}`, part.text).selectable(true));
      const copied = this.copied === `${item.key}#${i}`;
      return h_flex().w_full().gap(8).items_start().p(8).rounded(7).border_1().border_color(t.border).bg(t.raised)
        .child(div().flex_1().min_w(0).font_family(settings().font_family ?? "JetBrains Mono").text_size(11).text_color(t.foreground).child(part.code))
        .child(div().id(`dec-copy-${id}`).flex_none().px(8).py(3).rounded(6).border_1().border_color(copied ? t.done : t.input).text_size(11)
          .text_color(copied ? t.done : t.foreground).cursor_pointer().hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { cx.write_to_clipboard(part.code); this.copied = `${item.key}#${i}`; cx.notify(); })
          .child(copied ? this.text.copied : this.text.copy));
    });
  }

  card(item, key, t) {
    const rejecting = this.rejecting.has(item.key);
    const text = this.text, pending = isPending(item), open = pending !== this.toggled.has(item.key), busy = this.busy.has(item.key);
    const choices = item.options.length ? item.options : [APPROVED];
    return v_flex().w_full().max_w(READING_WIDTH).flex_none().rounded(8).border_1().border_color(pending ? t.blocked : t.border).bg(t.surface)
      .child(h_flex().id(`dec-head-${key}`).w_full().px(10).py(8).gap(8).items_center().cursor_pointer()
        .on_click((_e, cx) => { if (this.toggled.has(item.key)) this.toggled.delete(item.key); else this.toggled.add(item.key); cx.notify(); })
        .child(div().w(8).h(8).flex_none().rounded(4).bg(pending ? t.blocked : t.done))
        .child(div().flex_1().min_w(0).font_semibold().when(!open, (e) => e.truncate()).child(item.title))
        .when(!pending, (e) => e.child(div().flex_none().max_w(120).truncate().text_size(11).text_color(t.muted).child(this.label(item.decision)))))
      .when(open, (e) => e.child(v_flex().w_full().px(10).pb(10).gap(8)
        .child(div().text_size(11).text_color(t.dim).child([item.project, item.requester && text.from(this.who(item.requester)), item.created].filter(Boolean).join(" · ") || item.id))
        .children(this.body(item, key, t))
        .when(pending, (e) => e
          .when(this.notes.has(item.key), (e) => e.child(div().id(`dec-note-${key}`).w_full().h(30).px(8).flex().items_center().rounded(7).border_1().border_color(t.border).cursor_text()
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.notes.get(item.key)).h_full().text_size(12).text_color(t.foreground))))
          .when(rejecting, (e) => e.child(h_flex().w_full().gap(6)
            .child(this.button(`dec-reject-send-${key}`, busy ? text.working : text.sendReject, t, true, (_e, cx) => this.decide(item, REJECTED, cx)))
            .child(this.button(`dec-reject-cancel-${key}`, text.cancel, t, false, (_e, cx) => this.cancelReject(item.key, cx)))))
          .when(!rejecting, (e) => e.child(h_flex().w_full().flex_wrap().gap(6)
            .children(choices.map((choice, i) => this.button(`dec-yes-${key}-${i}`, busy ? text.working : this.label(choice), t, true, (_e, cx) => this.decide(item, choice, cx))))
            .child(this.button(`dec-no-${key}`, text.reject, t, false, (_e, cx) => this.startReject(item, cx)))
            .when(!this.notes.has(item.key), (e) => e.child(this.button(`dec-addnote-${key}`, text.addNote, t, false, (_e, cx) => this.addNote(item.key, cx)))))))
        .when(!pending, (e) => e.child(div().text_size(11).text_color(t.muted).child(text.decidedLine(this.label(item.decision), item.note))))
        .when(Boolean(item.requester), (e) => e.child(h_flex().gap(6)
          .child(this.button(`dec-go-${key}`, text.goToSession, t, false, () => run("agent.focus", { terminal: item.requester })))
          .when(!pending, (e) => e.child(this.button(`dec-again-${key}`, text.notifyAgain, t, false, (_e, cx) => this.resend(item, cx))))))));
  }

  render() {
    const zoomed = this.zoomed(), text = this.text;
    const t = theme(), here = focused()?.space;
    const groups = bySpace(this.projects, this.places());
    const pending = groups.reduce((n, group) => n + group.pending, 0);
    const shown = groups.filter((group) => group.id === this.tab);
    const listed = shown.length ? shown : groups;
    const pick = (id) => (_e, cx) => { this.tab = id; cx.notify(); };
    const root = v_flex().id("decisions").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(13).on_size_change((size, cx) => { this.narrow = size.width < NARROW_BELOW; cx.notify(); });
    if (this.narrow) {
      return root.cursor_pointer().items_center().pt(12).gap(8).on_click(() => this.resize(OPEN_PX))
        .child(div().w(22).h(22).flex().items_center().justify_center().rounded(11).text_size(11).font_semibold()
          .bg(pending ? t.blocked : t.raised).text_color(pending ? t.background : t.dim).child(String(pending)))
        .child(div().text_size(10).text_color(t.dim).child(text.rail));
    }
    return root
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child(text.title))
        .child(div().px(6).py(1).rounded(4).text_size(10).font_semibold().bg(pending ? t.blocked : t.raised).text_color(pending ? t.background : t.muted).child(String(pending)))
        .child(div().flex_1())
        .child(div().id("dec-zoom").px(6).py(2).rounded(5).text_size(12).text_color(zoomed ? t.accent : t.muted).cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => this.toggleZoom()).child(zoomed ? text.restore : text.expand))
        .child(div().id("dec-fold").px(6).py(2).rounded(5).text_size(12).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => this.resize(RAIL_PX)).child("»")))
      .when(groups.length > 1, (e) => e.child(h_flex().flex_none().flex_wrap().px(10).py(8).gap(5).border_b(1).border_color(t.border)
        .child(this.tabChip("dec-tab-all", text.all, pending, !shown.length, false, t, pick(null)))
        .children(groups.map((group, g) => this.tabChip(`dec-tab-${g}`, group.name, group.pending, Boolean(shown.length) && group.id === this.tab, group.id === here, t, pick(group.id))))))
      .child(div().flex_1().min_h(0).relative()
        .child(v_flex().id("dec-list").absolute().inset_0().overflow_y_scroll().p(10).gap(8).when(zoomed, (e) => e.items_center())
          .children(listed.flatMap((group) => [
            div().w_full().max_w(READING_WIDTH).flex_none().pt(2).text_size(11).font_semibold().text_color(group.id === here ? t.accent : t.muted).child(group.name),
            ...group.items.map((item) => this.card(item, item.key.replace(/[^A-Za-z0-9]/g, "-"), t)),
          ]))
          .when(!groups.length, (e) => e.child(div().p(4).text_color(t.dim).child(this.loading && !this.known ? text.loading : text.empty(DIR)))))
        .child(Scrollbar.vertical("dec-list").absolute().inset_0()))
      .when(Boolean(this.message), (e) => e.child(div().flex_none().px(12).py(8).border_t(1).border_color(t.border).text_size(11).text_color(t.blocked).child(this.message)));
  }
}
