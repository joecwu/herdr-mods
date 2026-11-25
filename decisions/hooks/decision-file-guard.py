#!/usr/bin/env python3
"""Stop hook: a reply that asks the user to decide must come with a decision file.

Blocks once when the last reply asks for a decision and this terminal has no pending file in
<git root>/.decisions/ to show for it. The convention is in ~/.claude/rules/decisions.md.
Any problem reading the input lets the reply through: a guard must not trap a session.
"""
import json
import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

ASKS = {
    "zh": re.compile(
        "你決定|由你決定|你來決定|你同意的話|你同意後|要你核准|等你核准|需要你核准|請你核准"
        "|等你放行|你放行後|你確認後|等你確認|需要你確認|需要你的決定|等你的決定"
    ),
    "en": re.compile(
        r"your call|up to you|you decide|for you to decide|need your (decision|approval|go-ahead|sign-off)"
        r"|(waiting|wait) (for|on) your (decision|approval|go-ahead|confirmation)"
        r"|once you (approve|confirm|sign off)|if you (approve|agree)",
        re.I,
    ),
}
# What makes a matched phrase something other than a request: a negation just before it in the
# same clause ("沒有事要你決定"), or a past marker just after it ("你決定了 A").
NEGATED = {
    "zh": re.compile(r"(沒有|沒|不用|不需要|不必|無需|無須|無)[^，。；：！？,;:!?\n]{0,8}$|不$"),
    "en": re.compile(r"\b(no|not|nothing|never|without|don't|doesn't|didn't|isn't|needn't)\b[^.,;:!?\n]{0,30}$", re.I),
}
PAST = {"zh": re.compile(r"^(了|過|的|好)"), "en": re.compile(r"^d\b")}
# Quoted text and code are talked about, not said.
QUOTED = re.compile(r"「[^」]*」|『[^』]*』|“[^”]*”|\"[^\"\n]*\"|```.*?```|`[^`\n]*`", re.S)
MENTIONS_FILE = re.compile(r"\.decisions|決策檔|決策面板|待決策|decision file|decisions panel", re.I)
REASONS = {
    "zh": (
        "回覆在請使用者決定，但沒有決策檔：照 ~/.claude/rules/decisions.md 寫 "
        ".decisions/<日期>-<代號>.md；如果其實不需要決定，回一句說明即可"
    ),
    "en": (
        "The reply asks the user to decide, but there is no decision file: write "
        ".decisions/<date>-<slug>.md as ~/.claude/rules/decisions.md describes. "
        "If no decision is needed after all, say so in one sentence."
    ),
}


def entries(transcript_path):
    with open(transcript_path, encoding="utf-8") as lines:
        for line in lines:
            try:
                yield json.loads(line)
            except ValueError:
                continue


def text_of(entry):
    content = (entry.get("message") or {}).get("content")
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    return "\n".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text")


def turn(transcript_path):
    """The last reply's text and when the prompt it answers was sent (epoch seconds)."""
    reply, started = "", 0.0
    for entry in entries(transcript_path):
        kind = entry.get("type")
        if kind == "user" and not entry.get("isMeta") and text_of(entry).strip():
            reply = ""
            try:
                started = datetime.fromisoformat(entry["timestamp"].replace("Z", "+00:00")).timestamp()
            except (KeyError, ValueError):
                pass
        elif kind == "assistant" and text_of(entry).strip():
            reply = text_of(entry)
    return reply, started


def asking_language(reply):
    """The language of the first phrase that really asks for a decision, or None."""
    said = QUOTED.sub(" ", reply)
    for lang, asks in ASKS.items():
        for match in asks.finditer(said):
            if not NEGATED[lang].search(said[: match.start()]) and not PAST[lang].match(said[match.end() :]):
                return lang
    return None


def git_root(cwd):
    found = subprocess.run(["git", "-C", cwd, "rev-parse", "--show-toplevel"], capture_output=True, text=True)
    return found.stdout.strip() if found.returncode == 0 else ""


def pending_files(root, terminal):
    """mtimes of this terminal's pending decision files."""
    mtimes = []
    for path in Path(root, ".decisions").glob("*.md"):
        head = path.read_text(encoding="utf-8", errors="replace").split("\n---", 1)[0]
        meta = dict(re.findall(r"^(\w+):\s*(.*?)\s*$", head, re.M))
        if meta.get("requester", "").strip("\"'") != terminal:
            continue
        if meta.get("status", "pending").strip("\"'") == "pending":
            mtimes.append(path.stat().st_mtime)
    return mtimes


def block_reason(event, terminal):
    """Why this reply must not end the turn yet, or None to let it through."""
    if event.get("stop_hook_active") or not terminal:
        return None
    root = git_root(event.get("cwd") or os.getcwd())
    if not root:
        return None
    reply, started = turn(event["transcript_path"])
    reply = event.get("last_assistant_message") or reply
    lang = asking_language(reply)
    if not lang:
        return None
    mtimes = pending_files(root, terminal)
    if any(mtime >= started for mtime in mtimes):
        return None
    # Pointing the user at a decision that is already on the panel needs no new file.
    if mtimes and MENTIONS_FILE.search(reply):
        return None
    return REASONS[lang]


def main():
    try:
        reason = block_reason(json.load(sys.stdin), os.environ.get("HC_TERMINAL_ID", ""))
    except Exception as error:  # never trap a session on a guard failure
        print(f"decision-file-guard: {error}", file=sys.stderr)
        return
    if reason:
        print(json.dumps({"decision": "block", "reason": reason}, ensure_ascii=False))


if __name__ == "__main__":
    main()
