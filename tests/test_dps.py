"""Checks for dps.py (best setup from your bank): the formulas against hand-worked values, and the gear search.

    .venv\\Scripts\\python.exe -m unittest tests.test_dps
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import dps  # noqa: E402


def item(name, slot, a=(0, 0, 0, 0, 0), st=0, rs=0, md=0, sp=0, c="", two=False):
    return {"n": name, "s": slot, "2h": two, "a": list(a), "st": st, "rs": rs, "md": md, "sp": sp, "c": c}


def monster(**kw):
    m = {"page": "Test", "name": "Test", "version": "", "hp": 100, "size": 1, "attrs": [], "def": 1, "mlvl": 1, "matk": 0,
         "stab": 0, "slash": 0, "crush": 0, "magic": 0, "light": 0, "standard": 0, "heavy": 0, "weak": None,
         "weakpct": 0, "slayer": False}
    m.update(kw)
    return m


LEVELS = {"Attack": 99, "Strength": 99, "Defence": 99, "Ranged": 99, "Magic": 99, "Prayer": 99}
PLAIN = {"potions": False, "prayers": False}


def loadout(**slots):
    L = dict.fromkeys(dps.SLOTS)
    L.update(slots)
    return L


class Formulas(unittest.TestCase):
    def test_unarmed_max_hit(self):
        # 99 Strength, aggressive (+3), +8, no bonus: floor((110 * 64 + 320) / 640) = 11
        ctx = dps.make_context(LEVELS, None, [], PLAIN)
        d = dps.melee_dps(loadout(), monster(), ctx, detail=True)
        self.assertEqual(d["max"], 11)

    def test_boosts_and_piety(self):
        ctx = dps.make_context(LEVELS, {"King's Ransom": 2}, [], {})
        self.assertEqual(ctx["S"], 99 + 5 + 14)          # super combat: +5 +15%
        self.assertEqual(ctx["pray"]["melee"][2], "Piety")
        ctx = dps.make_context(LEVELS, {"King's Ransom": 1}, [], {})
        self.assertNotIn(ctx["pray"]["melee"][2], ("Piety", "Chivalry"))   # quest not done: no Piety

    def test_hit_chance(self):
        self.assertAlmostEqual(dps._hit_chance(1000, 500), 1 - 502 / 2002)
        self.assertAlmostEqual(dps._hit_chance(500, 1000), 500 / 2002)

    def test_twisted_bow(self):
        self.assertEqual(dps._tbow(monster(mlvl=250)), (140, 215))
        self.assertEqual(dps._tbow(monster(mlvl=150)), (114, 164))   # Vorkath

    def test_magic_weakness_and_powered_staff(self):
        ctx = dps.make_context(LEVELS, None, [], PLAIN)
        trident = item("Trident of the seas", "weapon", a=(0, 0, 0, 0, 15), sp=4, c="powered staff")
        self.assertEqual(dps.magic_dps(loadout(weapon=trident), monster(), ctx, detail=True)["max"], 99 // 3 - 5)
        staff = item("Staff of fire", "weapon", a=(0, 0, 0, 0, 10), c="staff")
        d = dps.magic_dps(loadout(weapon=staff), monster(weak="fire", weakpct=50), ctx, detail=True)
        self.assertEqual((d["how"], d["max"]), ("Fire Surge", 24 + 12))

    def test_names(self):
        self.assertEqual(dps.key("Dragon arrow(p++)"), "dragon arrow")
        self.assertEqual(dps.key("Dharok's helm 75"), "dharok's helm")
        self.assertEqual(dps.key("Black mask (10)"), "black mask")
        self.assertEqual(dps.key("Salve amulet(ei)"), "salve amulet(ei)")

    def test_charged_version_kept(self):
        rows = [{"page_name": "Bow of Faerdhinen", "equipment_slot": "2h", "range_attack_bonus": 0, "ranged_strength_bonus": 0,
                 "combat_style": "Bow"},
                {"page_name": "Bow of Faerdhinen", "equipment_slot": "2h", "range_attack_bonus": 128, "ranged_strength_bonus": 106,
                 "combat_style": "Bow"}]
        it = dps.compact_equipment(rows)["bow of faerdhinen"]
        self.assertEqual((it["a"][3], it["rs"], it["2h"], it["s"]), (128, 106, True, "weapon"))


class Search(unittest.TestCase):
    def test_bow_needs_arrows_and_blowpipe_needs_darts(self):
        bow = item("Magic shortbow", "weapon", a=(0, 0, 0, 69, 0), sp=4, c="bow", two=True)
        pipe = item("Toxic blowpipe", "weapon", a=(0, 0, 0, 30, 0), rs=20, sp=3, c="thrown", two=True)
        ctx = dps.make_context(LEVELS, None, [bow, pipe], PLAIN)
        self.assertIsNone(dps.best_setup([bow, pipe], monster(), ctx, "ranged"))
        rune = item("Rune arrow", "ammo", rs=49)
        dragon = item("Dragon arrow", "ammo", rs=60)    # too strong for a magic shortbow
        r = dps.best_setup([bow, rune, dragon], monster(), ctx, "ranged")
        self.assertEqual(r["slots"]["ammo"], "Rune arrow")
        dart = item("Adamant dart", "weapon", rs=10, sp=3, c="thrown")
        ctx = dps.make_context(LEVELS, None, [pipe, dart], PLAIN)
        r = dps.best_setup([pipe, dart], monster(), ctx, "ranged")
        self.assertEqual(r["slots"]["weapon"], "Toxic blowpipe")

    def test_finds_void_set(self):
        whip = item("Abyssal whip", "weapon", a=(0, 82, 0, 0, 0), st=82, sp=4, c="whip")
        void = [item("Void melee helm", "head"), item("Void knight top", "body"), item("Void knight robe", "legs"),
                item("Void knight gloves", "hands")]
        small = [item("Bronze med helm", "head", a=(0, 1, 0, 0, 0)), item("Leather body", "body", a=(0, 1, 0, 0, 0)),
                 item("Leather chaps", "legs", a=(0, 1, 0, 0, 0)), item("Leather gloves", "hands", a=(0, 1, 0, 0, 0))]
        owned = [whip] + void + small
        ctx = dps.make_context(LEVELS, None, owned, PLAIN)
        r = dps.best_setup(owned, monster(), ctx, "melee")
        self.assertEqual(r["slots"]["head"], "Void melee helm")
        self.assertIn("Void: +10% accuracy and strength", r["notes"])

    def test_salve_on_undead(self):
        whip = item("Abyssal whip", "weapon", a=(0, 82, 0, 0, 0), st=82, sp=4, c="whip")
        owned = [whip, item("Salve amulet (e)", "neck"), item("Amulet of fury", "neck", a=(10, 10, 10, 10, 10), st=8),
                 item("Slayer helmet", "head")]
        undead = monster(attrs=["undead"], slash=100, **{"def": 200})
        ctx = dps.make_context(LEVELS, None, owned, PLAIN)
        r = dps.best_setup(owned, undead, ctx, "melee")
        self.assertEqual(r["slots"]["neck"], "Salve amulet (e)")   # +20% beats the fury's stats
        self.assertTrue(any(n.startswith("Salve amulet") for n in r["notes"]))
        # on task the salve replaces the helmet's +16.7% instead of adding to it, so the fury's stats win
        ctx = dps.make_context(LEVELS, None, owned, dict(PLAIN, task=True))
        self.assertEqual(dps.best_setup(owned, undead, ctx, "melee")["slots"]["neck"], "Amulet of fury")

    def test_no_melee_for_kraken(self):
        whip = item("Abyssal whip", "weapon", a=(0, 82, 0, 0, 0), st=82, sp=4, c="whip")
        ctx = dps.make_context(LEVELS, None, [whip], PLAIN)
        self.assertEqual(dps.best_setups([whip], monster(page="Kraken", name="Kraken"), ctx), [])
        self.assertEqual([s["style"] for s in dps.best_setups([whip], monster(), ctx)], ["melee"])


if __name__ == "__main__":
    unittest.main()
