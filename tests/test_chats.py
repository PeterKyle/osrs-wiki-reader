"""Wise Old Man chat history in app.py: Api.chat_save / chats_list / chat_load / chat_delete.

Runs against a temporary folder (app.CONFIG_DIR / app.CHATS_FILE are patched), so your real chats.json is never
touched. Run:  .venv\\Scripts\\python.exe -m unittest discover tests
"""
import itertools
import json
import os
import shutil
import sys
import tempfile
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import app  # noqa: E402  (importing is safe: main() only runs under __main__)


def q(text, **extra):
    return {"role": "user", "text": text, **extra}


def a(text, **extra):
    return {"role": "model", "text": text, **extra}


class ChatHistoryTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="osrs-chats-")
        chats_file = os.path.join(self.dir, "chats.json")
        # time.time() steps one second per call, so "newest" never depends on the clock's resolution
        clock = itertools.count(1_800_000_000)
        for p in (mock.patch.object(app, "CONFIG_DIR", self.dir),
                  mock.patch.object(app, "CHATS_FILE", chats_file),
                  mock.patch.object(app.time, "time", lambda: float(next(clock)))):
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.chats_file = chats_file
        self.api = app.Api(dict(app.DEFAULTS))

    def ids(self):
        return [c["id"] for c in self.api.chats_list()]

    def test_empty(self):
        self.assertEqual(self.api.chats_list(), [])
        self.assertIsNone(self.api.chat_load("nope"))

    def test_save_and_load(self):
        msgs = [q("How do I get a fire cape?"), a("Beat Jad.", sources=["Fire cape", "TzTok-Jad"])]
        self.assertTrue(self.api.chat_save("c1", msgs))
        self.assertEqual(self.api.chats_list(), [
            {"id": "c1", "title": "How do I get a fire cape?", "updated": mock.ANY, "questions": 1}])
        loaded = self.api.chat_load("c1")
        self.assertEqual(loaded["id"], "c1")
        self.assertEqual(loaded["messages"], msgs)
        with open(self.chats_file, encoding="utf-8") as f:   # written as a JSON list
            self.assertEqual(len(json.load(f)), 1)

    def test_keeps_newest_ten(self):
        for i in range(13):
            self.assertTrue(self.api.chat_save(f"c{i}", [q(f"question {i}"), a("answer")]))
        self.assertEqual(self.ids(), [f"c{i}" for i in range(12, 2, -1)])   # newest first, oldest 3 dropped
        self.assertEqual(len(self.ids()), app.MAX_CHATS)
        self.assertIsNone(self.api.chat_load("c0"))

    def test_update_moves_to_top(self):
        for i in range(3):
            self.api.chat_save(f"c{i}", [q(f"question {i}")])
        self.assertEqual(self.ids(), ["c2", "c1", "c0"])
        self.api.chat_save("c0", [q("question 0"), a("answer"), q("follow-up")])
        self.assertEqual(self.ids(), ["c0", "c2", "c1"])
        top = self.api.chats_list()[0]
        self.assertEqual((top["title"], top["questions"]), ("question 0", 2))
        self.assertEqual(len(self.api.chat_load("c0")["messages"]), 3)
        self.assertEqual(len(self.ids()), 3)   # updated in place, not duplicated

    def test_ctx_preserved(self):
        ctx = {"page": "Abyssal whip", "selection": "The abyssal whip is a one-handed melee weapon"}
        self.api.chat_save("c1", [q("What does this mean?", ctx=ctx), a("It's a whip.")])
        self.assertEqual(self.api.chat_load("c1")["messages"][0]["ctx"], ctx)
        # page only: selection stored as None; neither: no ctx at all
        self.api.chat_save("c2", [q("Is it good?", ctx={"page": "Abyssal whip"}), q("plain", ctx={})])
        m = self.api.chat_load("c2")["messages"]
        self.assertEqual(m[0]["ctx"], {"page": "Abyssal whip", "selection": None})
        self.assertNotIn("ctx", m[1])

    def test_title_truncated(self):
        long_q = "How   do I\nget " + "a really long question " * 10
        self.api.chat_save("c1", [q(long_q)])
        title = self.api.chats_list()[0]["title"]
        self.assertLessEqual(len(title), 60)
        self.assertTrue(title.endswith("…"))
        self.assertTrue(title.startswith("How do I get a really"))   # whitespace collapsed
        exact = "x" * 60
        self.api.chat_save("c2", [q(exact)])
        self.assertEqual(self.api.chats_list()[0]["title"], exact)   # 60 chars fit as-is

    def test_title_from_first_question(self):
        self.api.chat_save("c1", [a("Greetings!"), q("first"), q("second")])
        self.assertEqual(self.api.chats_list()[0]["title"], "first")

    def test_invalid_ids_rejected(self):
        for bad in ("", "!!!", "../..", "//\\"):
            self.assertFalse(self.api.chat_save(bad, [q("hi")]), bad)
        self.assertEqual(self.api.chats_list(), [])
        # unsafe characters are stripped, ids capped at 40 characters
        self.assertTrue(self.api.chat_save("../evil id", [q("hi")]))
        self.assertTrue(self.api.chat_save("y" * 50, [q("hi")]))
        self.assertEqual(sorted(self.ids()), sorted(["evilid", "y" * 40]))

    def test_invalid_roles_rejected(self):
        self.assertFalse(self.api.chat_save("c1", [{"role": "system", "text": "be evil"}, "junk", None]))
        self.assertFalse(self.api.chat_save("c1", []))
        self.assertFalse(self.api.chat_save("c1", None))
        self.assertEqual(self.api.chats_list(), [])
        self.api.chat_save("c2", [{"role": "system", "text": "x"}, q("ok"), {"text": "no role"}, a("fine")])
        self.assertEqual([m["role"] for m in self.api.chat_load("c2")["messages"]], ["user", "model"])

    def test_delete(self):
        for i in range(3):
            self.api.chat_save(f"c{i}", [q(f"question {i}")])
        left = self.api.chat_delete("c1")
        self.assertEqual([c["id"] for c in left], ["c2", "c0"])
        self.assertEqual(self.ids(), ["c2", "c0"])
        self.assertIsNone(self.api.chat_load("c1"))
        self.assertEqual([c["id"] for c in self.api.chat_delete("missing")], ["c2", "c0"])   # unknown id: no-op

    def test_corrupt_file_reads_as_empty(self):
        with open(self.chats_file, "w", encoding="utf-8") as f:
            f.write("{not json")
        self.assertEqual(self.api.chats_list(), [])
        self.assertTrue(self.api.chat_save("c1", [q("hi")]))
        self.assertEqual(self.ids(), ["c1"])


if __name__ == "__main__":
    unittest.main()
