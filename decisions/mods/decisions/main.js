// Decisions waiting for the person, across every project with an open pane.
// Each decision is one markdown file in <project>/.decisions/<id>.md, written by
// an agent session. Deciding here rewrites the file's frontmatter (the source of
// truth) and tells the requesting session with `hc send`.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextView, Scrollbar } from "gpui-base";
import { panes, focused, props, layout, exec, hc, readTextFile, writeTextFile, watchFolder, theme, settings, notify, setBadge, checking, run } from "herdr";

const DIR = ".decisions";
const REFRESH_MS = 15000;
const RAIL_PX = 44;
const OPEN_PX = 340;
const NARROW_BELOW = 120;
const MAIN_BLOCK = "main";
const READING_WIDTH = 860;
const APPROVED = "approved";
const REJECTED = "rejected";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const unquote = (value) => {
  if (/^".*"$/.test(value)) { try { return String(JSON.parse(value)); } catch { return value.slice(1, -1); } }
  return /^'.*'$/.test(value) ? value.slice(1, -1) : value;
};

function parse(text, path) {
  const match = FRONTMATTER.exec(text ?? "");
  if (!match) return null;
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const at = line.indexOf(":");
    if (at > 0) meta[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  let options = [];
  try { const list = JSON.parse(meta.options ?? "[]"); if (Array.isArray(list)) options = list.map(String); } catch { options = []; }
  const name = path.split("/").pop().replace(/\.md$/, "");
  return {
    path, id: name, title: unquote(meta.title ?? "") || name, status: unquote(meta.status ?? "pending") || "pending",
    requester: unquote(meta.requester ?? ""), created: unquote(meta.created ?? ""), options,
    decision: unquote(meta.decision ?? ""), note: unquote(meta.note ?? ""), body: match[2].trim(),
  };
}

// Returns the text with those frontmatter keys replaced or added; the body is untouched.
function withMeta(text, updates) {
  const match = FRONTMATTER.exec(text);
  if (!match) throw new Error("檔案沒有 frontmatter");
  const pending = { ...updates };
  const lines = match[1].split(/\r?\n/).map((line) => {
    const key = line.slice(0, Math.max(line.indexOf(":"), 0)).trim();
    if (!(key in pending)) return line;
    const value = pending[key];
    delete pending[key];
    return `${key}: ${value}`;
  });
  const added = Object.entries(pending).map(([key, value]) => `${key}: ${value}`);
  return `---\n${[...lines, ...added].join("\n")}\n---\n${match[2]}`;
}

function timestamp() {
  const d = new Date(), pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Splits a decision's body at its fenced code blocks, so each command gets a copy button.
function segments(body) {
  const out = [], fence = /```[^\n]*\n([\s\S]*?)\n?```/g;
  let at = 0, match;
  while ((match = fence.exec(body))) {
    const before = body.slice(at, match.index).trim();
    if (before) out.push({ text: before });
    if (match[1].trim()) out.push({ code: match[1] });
    at = match.index + match[0].length;
  }
  const rest = body.slice(at).trim();
  if (rest) out.push({ text: rest });
  return out;
}

const localFolders = () => [...new Set(panes().filter((p) => p.cwd && !p.pane.includes("/")).map((p) => p.cwd))];
const decisionLabel = (value) => value === APPROVED ? "核准" : value === REJECTED ? "駁回" : value;

export default class Decisions extends View {
  init(_props, cx) {
    this.projects = []; this.roots = new Map(); this.known = null; this.watching = new Set();
    this.toggled = new Set(); this.notes = new Map(); this.rejecting = new Set(); this.busy = new Set(); this.message = null; this.badge = null;
    if (checking()) return;
    this.refresh(cx);
    cx.timer.every(REFRESH_MS, (cx) => this.refresh(cx));
  }

  async rootOf(folder) {
    if (this.roots.has(folder)) return this.roots.get(folder);
    let root = folder;
    try {
      const r = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder });
      if (r.code === 0 && r.stdout.trim()) root = r.stdout.trim();
    } catch { root = folder; }
    this.roots.set(folder, root);
    return root;
  }

  async readProject(root) {
    const dir = `${root}/${DIR}`;
    const found = await exec("find", [dir, "-maxdepth", "1", "-type", "f", "-name", "*.md"]);
    if (found.code !== 0) return null;
    const items = [];
    for (const path of found.stdout.split("\n").filter(Boolean).sort()) {
      const item = parse(await readTextFile(path), path);
      if (item) items.push(item);
    }
    return { root, dir, name: root.split("/").pop(), items };
  }

  watch(dir, cx) {
    if (this.watching.has(dir)) return;
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
        const roots = new Set();
        for (const folder of localFolders()) roots.add(await this.rootOf(folder));
        const projects = [];
        for (const root of roots) {
          const project = await this.readProject(root);
          if (!project) continue;
          projects.push(project);
          this.watch(project.dir, cx);
        }
        this.announce(projects);
        this.projects = projects;
        this.message = null;
      } catch (e) { this.message = `讀取失敗：${e}`; }
      finally {
        this.loading = false;
        cx.notify();
        if (this.again) { this.again = false; this.refresh(cx); }
      }
    });
  }

  // Toasts for decisions that appeared since the last read, and the Dock badge.
  announce(projects) {
    const pending = projects.flatMap((p) => p.items.filter((i) => i.status === "pending").map((i) => ({ ...i, project: p.name })));
    const paths = new Set(pending.map((i) => i.path));
    if (this.known) {
      for (const item of pending) {
        if (!this.known.has(item.path)) notify({ title: `需要你決策 · ${item.project}`, body: item.title, level: "warning" });
      }
    }
    this.known = paths;
    const badge = pending.length ? String(pending.length) : null;
    if (badge !== this.badge) { this.badge = badge; setBadge(badge); }
  }

  // InputState can't be created while rendering, so the note field is added by a click.
  addNote(path, cx) {
    if (!this.notes.has(path)) this.notes.set(path, InputState.new({ placeholder: "備註，會一併送給 session" }));
    cx.notify();
  }

  // Rejecting asks for the reason first: the session needs it to know how to go on.
  startReject(item, cx) {
    const input = InputState.new({ placeholder: "駁回原因，Enter 送出", value: this.notes.get(item.path)?.value() ?? "" });
    input.on("submit", (_e, cx) => this.decide(item, REJECTED, cx));
    this.notes.set(item.path, input);
    this.rejecting.add(item.path);
    input.focus();
    cx.notify();
  }

  cancelReject(path, cx) {
    this.rejecting.delete(path);
    this.notes.delete(path);
    cx.notify();
  }

  async tell(item, decision, note) {
    if (!item.requester) return "已記錄（決策檔沒有 requester，未通知 session）";
    const outcome = decision === REJECTED
      ? `已駁回${note ? `。原因：${note}` : ""}。請不要照原提案進行，依駁回原因調整後續做法；需要再次決策就開新的決策檔`
      : `已決定：${decisionLabel(decision)}${note ? `。備註：${note}` : ""}`;
    const text = `[決策面板] 「${item.title}」${outcome}。決策檔：${item.path}（以檔案內容為準；處理完請把檔案移到 ${DIR}/done/）`;
    try {
      const r = await hc(["send", item.requester, text]);
      return r.code === 0 ? null : `已記錄，但通知 ${item.requester} 失敗：${(r.stderr || r.stdout).trim()}`;
    } catch (e) { return `已記錄，但通知 ${item.requester} 失敗：${e}`; }
  }

  decide(item, decision, cx) {
    if (this.busy.has(item.path)) return;
    this.busy.add(item.path);
    const note = (this.notes.get(item.path)?.value() ?? "").trim();
    cx.spawn(async (cx) => {
      try {
        const current = await readTextFile(item.path);
        if (current === null) throw new Error("決策檔已不存在");
        if (parse(current, item.path)?.status !== "pending") throw new Error("這項已經決定過了");
        const next = withMeta(current, { status: "decided", decision: JSON.stringify(decision), note: JSON.stringify(note), decided_at: timestamp() });
        try { await writeTextFile(item.path, next, current); }
        catch (e) {
          // writeTextFile may refuse a path outside the app's home: write through the shell instead.
          const r = await exec("sh", ["-c", 'printf %s "$1" > "$2"', "decisions", next, item.path]);
          if (r.code !== 0) throw new Error(`${e}; ${r.stderr.trim()}`);
        }
        this.message = await this.tell(item, decision, note);
        this.notes.delete(item.path); this.rejecting.delete(item.path);
      } catch (e) { this.message = `無法寫入決策：${e}`; }
      finally { this.busy.delete(item.path); this.refresh(cx); cx.notify(); }
    });
    cx.notify();
  }

  resend(item, cx) {
    cx.spawn(async (cx) => { this.message = (await this.tell(item, item.decision, item.note)) ?? `已再次通知 ${item.requester}`; cx.notify(); });
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

  button(id, label, t, primary, onClick) {
    return h_flex().id(id).min_h(28).px(10).py(4).items_center().rounded(7).border_1().cursor_pointer().text_size(12)
      .border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground)
      .hover((s) => s.opacity(0.85)).on_click(onClick).child(label);
  }

  body(item, key, t) {
    return segments(item.body).map((part, i) => {
      const id = `${key}-${i}`;
      if (part.text !== undefined) return div().w_full().text_size(12).text_color(t.foreground).child(TextView.markdown(`dec-body-${id}`, part.text).selectable(true));
      const copied = this.copied === `${item.path}#${i}`;
      return h_flex().w_full().gap(8).items_start().p(8).rounded(7).border_1().border_color(t.border).bg(t.raised)
        .child(div().flex_1().min_w(0).font_family(settings().font_family ?? "JetBrains Mono").text_size(11).text_color(t.foreground).child(part.code))
        .child(div().id(`dec-copy-${id}`).flex_none().px(8).py(3).rounded(6).border_1().border_color(copied ? t.done : t.input).text_size(11)
          .text_color(copied ? t.done : t.foreground).cursor_pointer().hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { cx.write_to_clipboard(part.code); this.copied = `${item.path}#${i}`; cx.notify(); })
          .child(copied ? "已複製" : "複製"));
    });
  }

  card(item, key, t) {
    const rejecting = this.rejecting.has(item.path);
    const pending = item.status === "pending", open = pending !== this.toggled.has(item.path), busy = this.busy.has(item.path);
    const choices = item.options.length ? item.options : [APPROVED];
    return v_flex().w_full().max_w(READING_WIDTH).flex_none().rounded(8).border_1().border_color(pending ? t.blocked : t.border).bg(t.surface)
      .child(h_flex().id(`dec-head-${key}`).w_full().px(10).py(8).gap(8).items_center().cursor_pointer()
        .on_click((_e, cx) => { if (this.toggled.has(item.path)) this.toggled.delete(item.path); else this.toggled.add(item.path); cx.notify(); })
        .child(div().w(8).h(8).flex_none().rounded(4).bg(pending ? t.blocked : t.done))
        .child(div().flex_1().min_w(0).font_semibold().when(!open, (e) => e.truncate()).child(item.title))
        .when(!pending, (e) => e.child(div().flex_none().max_w(120).truncate().text_size(11).text_color(t.muted).child(decisionLabel(item.decision)))))
      .when(open, (e) => e.child(v_flex().w_full().px(10).pb(10).gap(8)
        .child(div().text_size(11).text_color(t.dim).child([item.requester && `來自 ${item.requester}`, item.created].filter(Boolean).join(" · ") || item.id))
        .children(this.body(item, key, t))
        .when(pending, (e) => e
          .when(this.notes.has(item.path), (e) => e.child(div().id(`dec-note-${key}`).w_full().h(30).px(8).flex().items_center().rounded(7).border_1().border_color(t.border).cursor_text()
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.notes.get(item.path)).h_full().text_size(12).text_color(t.foreground))))
          .when(rejecting, (e) => e.child(h_flex().w_full().gap(6)
            .child(this.button(`dec-reject-send-${key}`, busy ? "處理中…" : "送出駁回", t, true, (_e, cx) => this.decide(item, REJECTED, cx)))
            .child(this.button(`dec-reject-cancel-${key}`, "取消", t, false, (_e, cx) => this.cancelReject(item.path, cx)))))
          .when(!rejecting, (e) => e.child(h_flex().w_full().flex_wrap().gap(6)
            .children(choices.map((choice, i) => this.button(`dec-yes-${key}-${i}`, busy ? "處理中…" : decisionLabel(choice), t, true, (_e, cx) => this.decide(item, choice, cx))))
            .child(this.button(`dec-no-${key}`, "駁回…", t, false, (_e, cx) => this.startReject(item, cx)))
            .when(!this.notes.has(item.path), (e) => e.child(this.button(`dec-addnote-${key}`, "＋備註", t, false, (_e, cx) => this.addNote(item.path, cx)))))))
        .when(!pending, (e) => e.child(div().text_size(11).text_color(t.muted).child(`已決定：${decisionLabel(item.decision)}${item.note ? `（${item.note}）` : ""}，等 session 處理後歸檔`)))
        .when(Boolean(item.requester), (e) => e.child(h_flex().gap(6)
          .child(this.button(`dec-go-${key}`, "前往 session", t, false, () => run("agent.focus", { terminal: item.requester })))
          .when(!pending, (e) => e.child(this.button(`dec-again-${key}`, "再通知一次", t, false, (_e, cx) => this.resend(item, cx))))))));
  }

  render() {
    const zoomed = this.zoomed();
    const t = theme(), current = this.roots.get(focused()?.cwd ?? "");
    const projects = [...this.projects].filter((p) => p.items.length).sort((a, b) => Number(b.root === current) - Number(a.root === current));
    const pending = projects.reduce((n, p) => n + p.items.filter((i) => i.status === "pending").length, 0);
    const root = v_flex().id("decisions").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(13).on_size_change((size, cx) => { this.narrow = size.width < NARROW_BELOW; cx.notify(); });
    if (this.narrow) {
      return root.cursor_pointer().items_center().pt(12).gap(8).on_click(() => this.resize(OPEN_PX))
        .child(div().w(22).h(22).flex().items_center().justify_center().rounded(11).text_size(11).font_semibold()
          .bg(pending ? t.blocked : t.raised).text_color(pending ? t.background : t.dim).child(String(pending)))
        .child(div().text_size(10).text_color(t.dim).child("決策"));
    }
    return root
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("待決策"))
        .child(div().px(6).py(1).rounded(4).text_size(10).font_semibold().bg(pending ? t.blocked : t.raised).text_color(pending ? t.background : t.muted).child(String(pending)))
        .child(div().flex_1())
        .child(div().id("dec-zoom").px(6).py(2).rounded(5).text_size(12).text_color(zoomed ? t.accent : t.muted).cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => this.toggleZoom()).child(zoomed ? "縮小" : "放大"))
        .child(div().id("dec-fold").px(6).py(2).rounded(5).text_size(12).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => this.resize(RAIL_PX)).child("»")))
      .child(div().flex_1().min_h(0).relative()
        .child(v_flex().id("dec-list").absolute().inset_0().overflow_y_scroll().p(10).gap(8).when(zoomed, (e) => e.items_center())
          .children(projects.flatMap((project, p) => [
            div().w_full().max_w(READING_WIDTH).flex_none().pt(2).text_size(11).font_semibold().text_color(project.root === current ? t.accent : t.muted).child(project.name),
            ...[...project.items].sort((a, b) => Number(a.status !== "pending") - Number(b.status !== "pending")).map((item, i) => this.card(item, `${p}-${i}`, t)),
          ]))
          .when(!projects.length, (e) => e.child(div().p(4).text_color(t.dim).child(this.loading && !this.known ? "讀取中…" : `目前沒有待決策事項。Session 需要你決定時，會在專案的 ${DIR}/ 建立決策檔。`))))
        .child(Scrollbar.vertical("dec-list").absolute().inset_0()))
      .when(Boolean(this.message), (e) => e.child(div().flex_none().px(12).py(8).border_t(1).border_color(t.border).text_size(11).text_color(t.blocked).child(this.message)));
  }
}
