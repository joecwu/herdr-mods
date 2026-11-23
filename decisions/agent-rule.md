# When you need the user's decision: write a decision file

The user's Herdr window has a Decisions panel. It lists the decision files in each project's
`.decisions/` folder, and the user decides there with a click. When you need their decision and
have other work you can do meanwhile, write a decision file instead of asking in the chat and
stopping.

## When to write one

- There are several workable directions and the choice is theirs to make: scope, trade-offs,
  spending money, publishing, anything hard to undo.
- You finished a piece of work and need approval for the next step, such as pushing after a commit.

Don't write one when the answer follows from the code, the docs or a sensible default, or when you
are fully blocked with nothing else to do. Then ask in the chat.

## How to write it

Create `.decisions/<date>-<short-slug>.md` in the project's git root:

````markdown
---
title: One line that says what is being decided
status: pending
requester: <your $HC_TERMINAL_ID, for example t7>
created: 2026-11-20 14:10
options: ["A: first approach", "B: second approach"]
---
## Background
Why a decision is needed now, in two or three sentences.

## What to weigh
What each option changes, costs and risks, and which one you recommend and why.
````

- Get `requester` from `echo $HC_TERMINAL_ID`. The panel sends the result there.
- `options` is a JSON array on one line; each entry becomes a button, and the panel always adds
  Reject. Omit `options` when a plain approve or reject is enough.
- One line per frontmatter field. Multi-line values are not read.
- Write the body so the user can decide without going back to the chat: full sentences, with the
  numbers, file paths and links that matter.
- Put a command the user must run themselves in a fenced code block. The panel shows a Copy button
  beside each block and copies the whole block. One block holds one set of commands to paste
  together; keep explanations outside it and leave out comments and prompt symbols (`$`).
- After writing the file, say in one sentence which decision you opened, then carry on with work
  that does not depend on it.

## After the user decides

The panel sets `status: decided`, adds `decision`, `note` and `decided_at`, and notifies you with
`hc send`.

- The file is the source of truth. When notified, read the file again and act on `decision` and
  `note`. `decision` is the text of the option they clicked, or `approved` or `rejected`.
- On a rejection (`decision: "rejected"`), `note` is their reason. Do not proceed as proposed;
  adjust to the reason. If the adjusted plan needs their decision too, write a new decision file.
- Check even without a notification: read your open decision files after each piece of work and
  before you touch anything a decision covers.
- When you have handled it, move the file to `.decisions/done/`. The panel stops showing it.
- If the decision is no longer needed, move the file to `.decisions/done/` as well.
