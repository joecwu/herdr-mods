# Decisions

A side panel that lists the decisions agent sessions are waiting on, across every project with an
open pane. Each decision is a markdown file the session wrote in its project. The person reads the
context in the panel, clicks a choice or rejects with a reason, and the panel writes the result back
to the file and tells the session.

## What you see

- A block on the right of the work area, 340 px wide, drawn as a card (10 px radius, 1 px border,
  theme `background`).
- Header, 42 px: "待決策", a count pill (`blocked` color when above zero), "放大" / "縮小", and "»".
- A scrolling list grouped by project (the git root's folder name; the focused pane's project first,
  its name in `accent`). Pending decisions come before decided ones.
- A decision card: status dot, title, "來自 <terminal> · <created>", the body as rendered markdown,
  then buttons. Pending cards have a `blocked`-colored border and start open; decided ones start
  folded and show the decision beside the title.
- Each fenced code block in the body is drawn as its own box in the terminal font with a "複製"
  button.
- Folded to a 44 px rail: only the count in a circle and "決策".
- A one-line message strip at the bottom when a write or a notification failed.

## How it behaves

- Reads `<git root>/.decisions/*.md` (not subfolders) for every local pane's folder. It refreshes
  when a `.decisions` folder changes and every 15 seconds.
- A decision that appears after the first read posts a notification. The Dock badge shows the
  pending count.
- Buttons: one per entry in the file's `options`, or "核准" when there are none; "駁回…"; "＋備註";
  "前往 session" (`agent.focus` on the requester).
- "駁回…" swaps the buttons for a focused reason field with "送出駁回" and "取消"; Enter submits.
- Deciding rewrites the frontmatter: `status: decided`, `decision` (the option text, `approved` or
  `rejected`), `note`, `decided_at`. It then runs `hc send <requester> <text>`; a rejection's text
  carries the reason and tells the session not to proceed as proposed.
- A decided card offers "再通知一次". It leaves the panel when the session moves the file to
  `.decisions/done/`.
- "放大" hides the tab block and gives the panel its room (content centered, 860 px wide at most);
  "縮小" restores it. Pane zoom (`pane.zoom`) is separate.
- "»" resizes the block to the rail; clicking the rail opens it to 340 px.

## Built from

- Layout: one block appended to the row that holds the tab block (`work-body` in Herdr's `main`):
  `{ "id": "decisions", "type": "block", "content": { "mod": "decisions" }, "size": { "px": 340 }, "min": 44 }`.
  The tab block's id must be `main`. Pass `props: { "block": "<id>" }` if the block has another id.
  Shipped layouts are read-only: `layout.clone` first.
- `mods/decisions/main.js`, `mod.json` (`{ "place": "none" }`).
- `herdr`: `panes`, `focused`, `layout`, `props`, `theme`, `settings`, `exec` (`git rev-parse`,
  `find`, a shell fallback for writing), `hc` (`send`), `readTextFile`, `writeTextFile`,
  `watchFolder`, `notify`, `setBadge`, `checking`, `run` (`layout.resize`, `layout.show`,
  `layout.hide`, `agent.focus`).
- `gpui-base`: `InputState`, `Input`, `TextView.markdown`, `Scrollbar`. Copying uses
  `cx.write_to_clipboard`.
- The agents' side is a convention, not code: `agent-rule.md` tells a session when and how to write
  a decision file. Put it where the agent reads its rules (for Claude Code,
  `.claude/rules/decisions.md` in a project or `~/.claude/rules/`).

## Watch out

- `InputState.new` cannot run during render. The note and reason fields are created in click
  handlers.
- Herdr does not hot-reload a mod folder that is a symlink. Keep a real folder in `mods/`.
- The frontmatter parser reads one `key: value` per line. `options` must be a JSON array on one
  line; multi-line YAML values are not read.
- The result reaches the session as an `hc send` message, which agents treat as a notice rather
  than the person's instruction. The file is the source of truth; the rule tells sessions to
  re-read it.
- Local projects only: `watchFolder` and `writeTextFile` do not reach other machines, and remote
  panes are skipped.
- `setBadge` is shared by all mods; the last caller wins.
- Zoom state is read from the layout (`main` hidden), so a layout without a `main` block cannot
  zoom.
- The interface text is Traditional Chinese.

## Done when

- `herdr-app check mods/decisions` passes and `herdr-app status` lists no errors.
- A file in `<project>/.decisions/` with `status: pending` shows up within a few seconds, with a
  notification and a Dock badge.
- Clicking an option writes `status: decided` and the choice to the file, and the requester
  terminal receives the message.
- Rejecting with a reason writes `decision: "rejected"` and the reason in `note`, and the message
  carries the reason.
- A code block's "複製" puts exactly that block on the clipboard.
- "放大" and "縮小" swap the panel and the tab area; "»" and the rail fold and unfold it.
- Moving the file to `.decisions/done/` removes the card.
