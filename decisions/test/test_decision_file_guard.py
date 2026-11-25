"""Runs the Stop hook as Claude Code does: JSON on stdin, a verdict on stdout."""
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path

HOOK = Path(__file__).parent.parent / "hooks" / "decision-file-guard.py"
ASKING = "有兩個方向，請你決定要走哪個。"


class GuardTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.repo = Path(self.dir.name, "repo")
        self.repo.mkdir()
        subprocess.run(["git", "init", "-q", str(self.repo)], check=True)
        self.transcript = Path(self.dir.name, "transcript.jsonl")

    def tearDown(self):
        self.dir.cleanup()

    def say(self, reply, prompted_seconds_ago=0):
        at = datetime.fromtimestamp(time.time() - prompted_seconds_ago, timezone.utc).isoformat()
        lines = [
            {"type": "user", "timestamp": at, "message": {"content": "go"}},
            {"type": "assistant", "message": {"content": [{"type": "text", "text": reply}]}},
        ]
        self.transcript.write_text("\n".join(json.dumps(line) for line in lines))

    def decision(self, requester="t99", status="pending", age_seconds=0):
        path = self.repo / ".decisions" / "a.md"
        path.parent.mkdir(exist_ok=True)
        path.write_text(f"---\ntitle: x\nstatus: {status}\nrequester: {requester}\n---\nbody\n")
        then = time.time() - age_seconds
        os.utime(path, (then, then))

    def run_hook(self, terminal="t99", stdin=None, **event):
        event = {"transcript_path": str(self.transcript), "cwd": str(self.repo), **event}
        env = {**os.environ, "HC_TERMINAL_ID": terminal}
        done = subprocess.run(
            [sys.executable, str(HOOK)], input=stdin or json.dumps(event), capture_output=True, text=True, env=env
        )
        self.assertEqual(done.returncode, 0)
        return json.loads(done.stdout) if done.stdout.strip() else None

    def test_blocks_a_reply_that_asks_without_a_decision_file(self):
        self.say(ASKING)
        verdict = self.run_hook()
        self.assertEqual(verdict["decision"], "block")
        self.assertIn("決策檔", verdict["reason"])

    def test_answers_an_english_reply_in_english(self):
        self.say("Both work. It's your call which one ships.")
        self.assertIn("decision file", self.run_hook()["reason"])

    def test_blocks_when_the_only_file_belongs_to_another_terminal(self):
        self.say(ASKING, prompted_seconds_ago=60)
        self.decision(requester="t10")
        self.assertIsNotNone(self.run_hook())

    def test_blocks_a_new_question_when_only_an_older_file_is_pending(self):
        self.say(ASKING)
        self.decision(age_seconds=600)
        self.assertIsNotNone(self.run_hook())

    def test_blocks_when_the_file_written_this_turn_is_already_decided(self):
        self.say(ASKING, prompted_seconds_ago=60)
        self.decision(status="decided")
        self.assertIsNotNone(self.run_hook())

    def test_passes_when_a_pending_file_was_written_this_turn(self):
        self.say(ASKING, prompted_seconds_ago=60)
        self.decision()
        self.assertIsNone(self.run_hook())

    def test_passes_a_reply_that_points_at_a_decision_already_pending(self):
        self.say("決策檔已開，等你確認。")
        self.decision(age_seconds=600)
        self.assertIsNone(self.run_hook())

    def test_passes_a_reply_that_asks_nothing(self):
        self.say("已經修好並跑過測試。")
        self.assertIsNone(self.run_hook())

    def test_passes_replies_that_only_mention_deciding(self):
        for reply in [
            "現在沒有事要你決定。",
            "這輪不需要你確認，我直接做完了。",
            "你決定了 A，已經做完。",
            "這三種寫法不會再被當成在請你決定：",
            "測試句是「有兩個方向，請你決定要走哪個。」，被擋了一次。",
            "Nothing here is your call; I went with the default.",
            "The test reply was `it's your call`.",
        ]:
            with self.subTest(reply=reply):
                self.say(reply)
                self.assertIsNone(self.run_hook())

    def test_still_blocks_a_real_request_after_a_negated_one(self):
        self.say("A 不用你確認。B 有兩個做法，請你決定。")
        self.assertIsNotNone(self.run_hook())

    def test_passes_the_second_time_so_a_session_is_never_stuck(self):
        self.say(ASKING)
        self.assertIsNone(self.run_hook(stop_hook_active=True))

    def test_passes_outside_herdr(self):
        self.say(ASKING)
        self.assertIsNone(self.run_hook(terminal=""))

    def test_passes_outside_a_git_repository(self):
        self.say(ASKING)
        self.assertIsNone(self.run_hook(cwd=self.dir.name))

    def test_passes_when_the_input_cannot_be_read(self):
        self.assertIsNone(self.run_hook(stdin="{bad"))


if __name__ == "__main__":
    unittest.main()
