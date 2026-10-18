"""Bank import: parsing RuneLite exports and looking items up (app.parse_bank_export, Api.import_bank / bank_has).

Run from the repo root:  .venv\\Scripts\\python.exe -m unittest discover tests
"""
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import app  # noqa: E402

TAB, NL = "\t", "\r\n"
BANK_MEMORY = NL.join(TAB.join(r) for r in (
    ("Item id", "Item name", "Item quantity"), ("995", "Coins", "1000"), ("11905", "Trident of the seas (full)", "1"),
    ("12924", "Toxic blowpipe (empty)", "1"), ("27235", "Masori mask (f)", "1"), ("14", "Bank filler", "200"),
    ("995", "Coins", "5"))) + NL


class ParseBankExport(unittest.TestCase):
    def test_bank_memory_tsv(self):
        items = app.parse_bank_export(BANK_MEMORY)
        self.assertEqual(items["Coins"], 1005)                    # duplicate rows are added up
        self.assertNotIn("Bank filler", items)
        self.assertEqual(len(items), 4)

    def test_data_export_csv(self):
        csv = 'id,name,quantity,price\n4151,Abyssal whip,2,1500000\n11832,"Bandos chestplate",1,15000000\n'
        self.assertEqual(app.parse_bank_export(csv), {"Abyssal whip": 2, "Bandos chestplate": 1})

    def test_json(self):
        js = '[{"name": "Rune crossbow", "quantity": 1}, {"itemName": "Ranarr seed", "qty": 50}]'
        self.assertEqual(app.parse_bank_export(js), {"Rune crossbow": 1, "Ranarr seed": 50})

    def test_junk(self):
        self.assertEqual(app.parse_bank_export("hello world"), {})
        self.assertEqual(app.parse_bank_export(""), {})


class BankLookups(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self._saved = (app.CONFIG_DIR, app.BANK_FILE)
        app.CONFIG_DIR, app.BANK_FILE = self.tmp, os.path.join(self.tmp, "bank.json")
        self.api = app.Api(dict(app.DEFAULTS, me="Clyde Lives"))

    def tearDown(self):
        app.CONFIG_DIR, app.BANK_FILE = self._saved
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_no_bank(self):
        self.assertIsNone(self.api.bank_has(["Coins"]))
        self.assertFalse(self.api.bank_info()["imported"])

    def test_import_and_lookup(self):
        info = self.api.import_bank("Clyde Lives", BANK_MEMORY)
        self.assertEqual(info["different"], 4)
        have = self.api.bank_has(["Trident of the Seas (full)", "Toxic blowpipe", "Masori mask (f)", "Masori mask", "coins"])
        self.assertEqual(have["Trident of the Seas (full)"], 1)   # case doesn't matter
        self.assertEqual(have["Toxic blowpipe"], 1)               # nor charge states like (empty)
        self.assertEqual(have["Masori mask (f)"], 1)
        self.assertEqual(have["Masori mask"], 0)                  # but (f) is a different item
        self.assertEqual(have["coins"], 1005)

    def test_bad_import_keeps_old_bank(self):
        self.api.import_bank("Clyde Lives", BANK_MEMORY)
        self.assertIn("error", self.api.import_bank("Clyde Lives", "nonsense"))
        self.assertEqual(self.api.bank_info()["different"], 4)

    def test_saved_on_disk_and_clear(self):
        self.api.import_bank("Clyde Lives", BANK_MEMORY)
        fresh = app.Api(dict(app.DEFAULTS, me="Clyde Lives"))   # like restarting the app
        self.assertEqual(fresh.bank_has(["Coins"])["Coins"], 1005)
        fresh.clear_bank("Clyde Lives")
        self.assertIsNone(fresh.bank_has(["Coins"]))



class NoShadowedMethods(unittest.TestCase):
    """An attribute set in Api.__init__ must never hide a method of the same name (a 1.6.0 bug: a cache called
    `_items` replaced the `_items()` method, which broke Grand Exchange prices)."""

    def test_instance_attributes_dont_hide_methods(self):
        api = app.Api(dict(app.DEFAULTS))
        clashes = [name for name in vars(api) if callable(getattr(type(api), name, None))]
        self.assertEqual(clashes, [])


if __name__ == "__main__":
    unittest.main()
