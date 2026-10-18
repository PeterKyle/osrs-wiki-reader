"""Best setup from your bank against a monster: Old School RuneScape damage-per-second maths.

Follows the standard formulas (Bitterkoekje's spreadsheet, as the wiki's DPS calculator does) for melee, ranged and
magic, plus the special effects that most often change which gear is best: slayer helmet / black mask, salve amulet,
void, dragon hunter lance and crossbow, arclight, keris, obsidian, inquisitor, crystal armour, twisted bow, scythe,
Osmumten's fang, powered staves, Tumeken's shadow, tome of fire and elemental weaknesses.
Not modelled: special attacks, enchanted bolt effects, raid scaling, wield requirements, and degrading/charges.

Pure functions only (no network): app.py feeds in the wiki's equipment and monster tables, your levels and your bank."""
import re

TICK = 0.6
SLOTS = ("weapon", "ammo", "head", "cape", "neck", "body", "shield", "legs", "hands", "feet", "ring")
MELEE_TYPES = ("stab", "slash", "crush")
EQUIP_FIELDS = ("page_name", "equipment_slot", "stab_attack_bonus", "slash_attack_bonus", "crush_attack_bonus",
                "range_attack_bonus", "magic_attack_bonus", "strength_bonus", "ranged_strength_bonus",
                "magic_damage_bonus", "weapon_attack_speed", "combat_style")
MONSTER_FIELDS = ("page_name", "name", "version_anchor", "default_version", "hitpoints", "size", "attribute",
                  "defence_level", "magic_level", "magic_attack_bonus", "stab_defence_bonus", "slash_defence_bonus",
                  "crush_defence_bonus", "magic_defence_bonus", "range_defence_bonus", "light_range_defence_bonus",
                  "standard_range_defence_bonus", "heavy_range_defence_bonus", "elemental_weakness",
                  "elemental_weakness_percent", "slayer_level", "assigned_by", "image", "combat_level",
                  "attack_style", "max_hit")

_SUFFIX = re.compile(r"\s*\((?:empty|uncharged|charged|full|inactive|broken|used|deg|degraded|\d+|p\+*|kp)\)\s*$", re.I)


def key(name):
    """How bank names and wiki names are matched: case-insensitive, ignoring charges, poison and Barrows wear."""
    s = _SUFFIX.sub("", re.sub(r"\s+", " ", str(name or "")).strip())
    return re.sub(r"\s+(?:100|75|50|25|0)$", "", s).lower()   # "Dharok's helm 75"


def _n(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def compact_equipment(rows):
    """{key: item} from the wiki's infobox_bonuses rows. Of an item's versions (charged, uncharged...), the one with
    the best offensive stats is kept."""
    out = {}
    for r in rows or []:
        name, slot = r.get("page_name"), str(r.get("equipment_slot") or "").lower()
        if not name or (slot not in SLOTS and slot != "2h"):
            continue
        it = {"n": name, "s": "weapon" if slot == "2h" else slot, "2h": slot == "2h",
              "a": [int(_n(r.get(f"{t}_attack_bonus"))) for t in ("stab", "slash", "crush", "range", "magic")],
              "st": int(_n(r.get("strength_bonus"))), "rs": int(_n(r.get("ranged_strength_bonus"))),
              "md": _n(r.get("magic_damage_bonus")), "sp": int(_n(r.get("weapon_attack_speed"))),
              "c": str(r.get("combat_style") or "").strip().lower()}
        score = sum(max(0, x) for x in it["a"]) + it["st"] + it["rs"] + it["md"]
        k = key(name)
        if k not in out or score > out[k][0]:
            out[k] = (score, it)
    return {k: v[1] for k, v in out.items()}


def parse_monsters(rows):
    """The monster's versions (e.g. Vorkath before/after the quest) with what the maths needs; the default first,
    and versions with identical stats merged."""
    out, seen = [], set()
    rows = sorted(rows or [], key=lambda r: "default_version" not in r)
    for r in rows:
        if not _n(r.get("hitpoints")) or r.get("defence_level") is None:
            continue
        attrs = r.get("attribute") or []
        attrs = [attrs] if isinstance(attrs, str) else attrs
        rng = int(_n(r.get("range_defence_bonus")))
        rd = lambda f: int(_n(r[f])) if r.get(f) is not None else rng
        m = {"page": r.get("page_name") or "", "name": r.get("name") or r.get("page_name"), "version": r.get("version_anchor") or "",
             "hp": int(_n(r.get("hitpoints"))), "size": max(1, int(_n(r.get("size")) or 1)),
             "attrs": sorted({str(a).lower() for a in attrs}), "def": int(_n(r.get("defence_level"))),
             "mlvl": int(_n(r.get("magic_level"))), "matk": int(_n(r.get("magic_attack_bonus"))),
             "stab": int(_n(r.get("stab_defence_bonus"))), "slash": int(_n(r.get("slash_defence_bonus"))),
             "crush": int(_n(r.get("crush_defence_bonus"))), "magic": int(_n(r.get("magic_defence_bonus"))),
             "light": rd("light_range_defence_bonus"), "standard": rd("standard_range_defence_bonus"),
             "heavy": rd("heavy_range_defence_bonus"),
             "weak": str(r.get("elemental_weakness") or "").strip().lower() or None,
             "weakpct": int(_n(r.get("elemental_weakness_percent"))),
             "slayer": bool(_n(r.get("slayer_level")) > 1 or r.get("assigned_by"))}
        sig = tuple(tuple(v) if isinstance(v, list) else v for k, v in m.items() if k not in ("version", "name", "page"))
        # for the card's header (not part of the maths, so versions that differ only in these still merge)
        img = r.get("image") or []
        img = img[0] if isinstance(img, list) and img else img if isinstance(img, str) else ""
        hits = [int(x) for h in (r.get("max_hit") or []) for x in re.findall(r"^\s*(\d+)", str(h))]
        styles = r.get("attack_style") or []
        m.update({"image": re.sub(r"^File:", "", img).strip(), "combat": int(_n(r.get("combat_level"))),
                  "attacks": [re.sub(r"\s*\(.*\)", "", str(s)).strip() for s in ([styles] if isinstance(styles, str) else styles)][:5],
                  "maxhit": max(hits) if hits else None})
        if sig not in seen:
            seen.add(sig)
            out.append(m)
    return out[:8]


def owned_items(bank_names, equipment):
    """Equipment you own: {slot: [items]} (each item once)."""
    found = {}
    for name in bank_names or []:
        it = equipment.get(key(name))
        if it:
            found[it["n"]] = it
    return list(found.values())


# ---------------------------------------------------------------- your levels, potions and prayers

def _pct(level, pct):
    return level * pct // 100


def make_context(levels, quests, owned, opts):
    """Boosted levels and prayer multipliers. levels: {"Attack": 99, ...}; quests: {name: 2 when done} or None
    (unknown: assumed done); opts: task, potions, prayers, rigour (Rigour & Augury unlocked)."""
    o = {"task": False, "potions": True, "prayers": True, "rigour": False}
    o.update({k: bool(v) for k, v in (opts or {}).items() if k in o})
    lv = lambda n: max(1, int(levels.get(n) or 1))
    done = lambda q: quests is None or quests.get(q) == 2
    att, stg, dfc, rng, mag, pray = (lv(n) for n in ("Attack", "Strength", "Defence", "Ranged", "Magic", "Prayer"))
    names = {it["n"].lower() for it in owned}
    potions = {}
    if o["potions"]:
        att, stg = att + 5 + _pct(att, 15), stg + 5 + _pct(stg, 15)
        rng = rng + 4 + _pct(rng, 10)
        if "saturated heart" in names:
            mag, potions["magic"] = mag + 4 + _pct(mag, 10), "Saturated heart"
        elif "imbued heart" in names and 1 + _pct(mag, 10) > 4:
            mag, potions["magic"] = mag + 1 + _pct(mag, 10), "Imbued heart"
        else:
            mag, potions["magic"] = mag + 4, "Magic potion"
        potions["melee"], potions["ranged"] = "Super combat", "Ranging potion"
    pr = {"melee": (100, 100, None), "ranged": (100, 100, None), "magic": (100, 100, None)}
    if o["prayers"]:
        p, d = lv("Prayer"), lv("Defence")
        if p >= 70 and d >= 70 and done("King's Ransom"):
            pr["melee"] = (120, 123, "Piety")
        elif p >= 60 and d >= 65 and done("King's Ransom"):
            pr["melee"] = (115, 118, "Chivalry")
        else:
            a = 115 if p >= 34 else 110 if p >= 16 else 105 if p >= 7 else 100
            s = 115 if p >= 31 else 110 if p >= 13 else 105 if p >= 4 else 100
            pr["melee"] = (a, s, "Ultimate Strength + Incredible Reflexes" if p >= 34 else "Strength and Attack prayers" if p >= 4 else None)
        if o["rigour"] and p >= 74 and d >= 70:
            pr["ranged"] = (120, 123, "Rigour")
        else:
            x = 115 if p >= 44 else 110 if p >= 26 else 105 if p >= 8 else 100
            pr["ranged"] = (x, x, "Eagle Eye" if p >= 44 else "Hawk Eye" if p >= 26 else "Sharp Eye" if p >= 8 else None)
        if o["rigour"] and p >= 77 and d >= 70:
            pr["magic"] = (125, 100, "Augury")
        else:
            x = 115 if p >= 45 else 110 if p >= 27 else 105 if p >= 9 else 100
            pr["magic"] = (x, 100, "Mystic Might" if p >= 45 else "Mystic Lore" if p >= 27 else "Mystic Will" if p >= 9 else None)
    darts = [it for it in owned if it["c"] == "thrown" and re.search(r"\bdart\b", it["n"].lower()) and "blowpipe" not in it["n"].lower()]
    return {"A": att, "S": stg, "R": rng, "M": mag, "pray": pr, "task": o["task"], "opts": o, "potions": potions,
            "ancients": done("Desert Treasure I"), "dart": max(darts, key=lambda it: it["rs"]) if darts else None}


# ---------------------------------------------------------------- gear effects

def _names(L):
    return {s: (L[s]["n"].lower() if L.get(s) else "") for s in SLOTS}


def _salve(neck):
    n = neck.replace(" ", "")
    if not n.startswith("salveamulet"):
        return None
    return "ei" if "(ei)" in n else "e" if "(e)" in n else "i" if "(i)" in n else "plain"


def _slayer(head):
    if "slayer helmet" in head or head.startswith("black mask"):
        return "i" if "(i)" in head else "plain"
    return None


def _void(nm):
    top, robe = nm["body"], nm["legs"]
    if not (("void knight top" in top or "elite void top" in top) and ("void knight robe" in robe or "elite void robe" in robe)
            and "void knight gloves" in nm["hands"]):
        return None, False
    elite = "elite void top" in top and "elite void robe" in robe
    for kind in ("melee", "ranger", "mage"):
        if f"void {kind} helm" in nm["head"]:
            return kind, elite
    return None, False


OBSIDIAN_WEAPONS = ("toktz-xil-ek", "toktz-xil-ak", "tzhaar-ket-em", "tzhaar-ket-om", "toktz-mej-tal")


def _hit_chance(a, d):
    return 1 - (d + 2) / (2 * (a + 1)) if a > d else a / (2 * (d + 1))


def _apply(x, mults):
    for num, den in mults:
        x = x * num // den
    return x


# ---------------------------------------------------------------- melee

STANCES = {   # weapon type -> the (attack type, stance) choices that can be best for damage
    "slash sword": [("slash", "accurate"), ("slash", "aggressive"), ("stab", "controlled")],
    "stab sword": [("stab", "accurate"), ("stab", "aggressive"), ("slash", "aggressive")],
    "2h sword": [("slash", "accurate"), ("slash", "aggressive"), ("crush", "aggressive")],
    "axe": [("slash", "accurate"), ("slash", "aggressive"), ("crush", "aggressive")],
    "blunt": [("crush", "accurate"), ("crush", "aggressive")],
    "bludgeon": [("crush", "aggressive")],
    "bulwark": [("crush", "accurate")],
    "claw": [("slash", "accurate"), ("slash", "aggressive"), ("stab", "controlled")],
    "partisan": [("stab", "accurate"), ("stab", "aggressive"), ("crush", "aggressive")],
    "pickaxe": [("stab", "accurate"), ("stab", "aggressive"), ("crush", "aggressive")],
    "polearm": [("stab", "controlled"), ("slash", "aggressive")],
    "polestaff": [("crush", "accurate"), ("crush", "aggressive")],
    "scythe": [("slash", "accurate"), ("slash", "aggressive"), ("crush", "aggressive")],
    "spear": [("stab", "controlled"), ("slash", "controlled"), ("crush", "controlled")],
    "spiked": [("crush", "accurate"), ("crush", "aggressive"), ("stab", "controlled")],
    "whip": [("slash", "accurate"), ("slash", "controlled")],
    "unarmed": [("crush", "accurate"), ("crush", "aggressive")],
}


def melee_dps(L, m, ctx, detail=False):
    w = L.get("weapon")
    choices = STANCES.get(w["c"] if w else "unarmed")
    if not choices:
        return None
    nm, wn = _names(L), (w["n"].lower() if w else "")
    items = [it for it in L.values() if it]
    ab = [sum(it["a"][i] for it in items) for i in range(3)]
    sb = sum(it["st"] for it in items)
    pa, ps, prayer = ctx["pray"]["melee"]
    void, _ = _void(nm)
    attrs = m["attrs"]
    acc, dmg, notes = [], [], []
    salve, slay = _salve(nm["neck"]), _slayer(nm["head"])
    if salve and "undead" in attrs:
        f = (6, 5) if salve in ("e", "ei") else (7, 6)
        acc.append(f), dmg.append(f), notes.append(f"Salve amulet: +{'20' if f == (6, 5) else '16.7'}% against undead")
    elif slay and ctx["task"]:
        acc.append((7, 6)), dmg.append((7, 6)), notes.append("Slayer helmet: +16.7% on task")
    if "dragon" in attrs and "dragon hunter lance" in wn:
        acc.append((6, 5)), dmg.append((6, 5)), notes.append("Dragon hunter lance: +20% against dragons")
    if "demon" in attrs and ("arclight" in wn or "emberlight" in wn):
        acc.append((17, 10)), dmg.append((17, 10)), notes.append(f"{w['n']}: +70% against demons")
    if "kalphite" in attrs and "keris" in wn:
        dmg.append((133, 100)), notes.append("Keris: +33% against kalphites")
    if any(x in wn for x in OBSIDIAN_WEAPONS):
        if "obsidian helmet" in nm["head"] and "obsidian platebody" in nm["body"] and "obsidian platelegs" in nm["legs"]:
            acc.append((11, 10)), dmg.append((11, 10)), notes.append("Obsidian armour: +10% with an obsidian weapon")
        if "berserker necklace" in nm["neck"]:
            dmg.append((6, 5)), notes.append("Berserker necklace: +20% with an obsidian weapon")
    inq = sum(1 for s, x in (("head", "inquisitor's great helm"), ("body", "inquisitor's hauberk"), ("legs", "inquisitor's plateskirt")) if x in nm[s])
    speed = (w["sp"] if w and w["sp"] > 0 else 4)
    hits = [1, 2, 3][min(3, m["size"]) - 1] if "scythe of vitur" in wn else 1
    best = None
    for t, stance in choices:
        ea = _pct(ctx["A"], pa) + (3 if stance == "accurate" else 1 if stance == "controlled" else 0) + 8
        es = _pct(ctx["S"], ps) + (3 if stance == "aggressive" else 1 if stance == "controlled" else 0) + 8
        if void == "melee":
            ea, es = ea * 11 // 10, es * 11 // 10
        roll = _apply(ea * (ab[MELEE_TYPES.index(t)] + 64), acc)
        mx = _apply((es * (sb + 64) + 320) // 640, dmg)
        if t == "crush" and inq:
            f = (1000 + 5 * inq + (10 if inq == 3 else 0), 1000)
            roll, mx = roll * f[0] // f[1], mx * f[0] // f[1]
        dr = (m["def"] + 9) * (m[t] + 64)
        if "osmumten's fang" in wn and t == "stab":   # rolls accuracy twice
            hc = 1 - (dr + 2) * (2 * dr + 3) / (6 * (roll + 1) ** 2) if roll > dr else roll * (4 * roll + 5) / (6 * (roll + 1) * (dr + 1))
        else:
            hc = _hit_chance(roll, dr)
        per_attack = sum(hc * (mx >> i) / 2 for i in range(hits))   # scythe: full, half and quarter hits on big monsters
        v = per_attack / (speed * TICK)
        if best is None or v > best[0]:
            best = (v, t, stance, mx, hc)
    if not detail:
        return best[0]
    v, t, stance, mx, hc = best
    if void == "melee":
        notes.append("Void: +10% accuracy and strength")
    if inq and t == "crush":
        notes.append(f"Inquisitor's: +{0.5 * inq + (1 if inq == 3 else 0):g}% crush")
    if hits > 1:
        notes.append(f"Scythe: {hits} hits per swing on a monster this size")
    return {"dps": v, "max": mx, "hits": hits, "acc": hc, "speed": speed * TICK, "how": f"{t.title()}, {stance}",
            "prayer": prayer, "potion": ctx["potions"].get("melee"), "notes": notes}


# ---------------------------------------------------------------- ranged

ARROW_TIERS = ("bronze", "iron", "steel", "mithril", "adamant", "rune", "amethyst", "dragon")


def _ammo_kind(w):
    wn, c = w["n"].lower(), w["c"]
    if c == "crossbow":
        return "javelin" if "ballista" in wn else "rack" if "karil" in wn else "bolt"
    if c == "bow":
        if "atlatl" in wn:
            return "skip"
        if any(x in wn for x in ("crystal bow", "bow of faerdhinen", "craw's bow", "webweaver bow")):
            return None
        return "arrow"
    if c == "thrown":
        return "dart" if "blowpipe" in wn else None
    return "skip"


def _ammo_fits(kind, wn, an):
    if not an:
        return False
    if kind == "arrow":
        if "arrow" not in an or "bolt" in an or "ogre" in an:
            return False
        cap = (7 if any(x in wn for x in ("twisted bow", "dark bow", "3rd age bow")) else 6 if "magic" in wn else
               5 if "yew" in wn else 4 if "maple" in wn else 3 if "willow" in wn else 2 if "oak" in wn else
               1 if wn in ("shortbow", "longbow") else 7)
        tier = next((i for i, t in enumerate(ARROW_TIERS) if an.startswith(t)), None)
        return tier is None or tier <= cap
    if kind == "bolt":
        if "bolts" not in an or "rack" in an:
            return False
        return not an.startswith("dragon") or any(x in wn for x in ("rune crossbow", "dragon crossbow", "armadyl crossbow",
                                                                         "zaryte crossbow", "dragon hunter crossbow"))
    if kind == "rack":
        return "bolt rack" in an
    if kind == "javelin":
        return "javelin" in an
    return False


def _tbow(m):
    x = min(250, max(m["mlvl"], m["matk"]))
    acc = min(140, 140 + (3 * x - 10) // 100 - (3 * x // 10 - 100) ** 2 // 100)
    dmg = min(250, 250 + (3 * x - 14) // 100 - (3 * x // 10 - 140) ** 2 // 100)
    return max(0, acc), max(0, dmg)


def ranged_dps(L, m, ctx, detail=False):
    w = L.get("weapon")
    if not w or w["c"] not in ("bow", "crossbow", "thrown"):
        return None
    kind = _ammo_kind(w)
    if kind == "skip":
        return None
    nm, wn = _names(L), w["n"].lower()
    uses_ammo = kind in ("arrow", "bolt", "rack", "javelin")
    if uses_ammo and not _ammo_fits(kind, wn, nm["ammo"]):
        return 0.0 if not detail else None
    if kind == "dart" and not ctx["dart"]:
        return None
    ra = sum(it["a"][3] for it in L.values() if it)
    rs = sum(it["rs"] for s, it in L.items() if it and (s != "ammo" or uses_ammo))
    if kind == "dart":
        rs += ctx["dart"]["rs"]
    dtype = "standard" if kind in ("arrow", None) and w["c"] == "bow" else "heavy" if kind in ("bolt", "rack", "javelin") else "light"
    pa, ps, prayer = ctx["pray"]["ranged"]
    void, elite = _void(nm)
    attrs = m["attrs"]
    acc, dmg, notes = [], [], []
    salve, slay = _salve(nm["neck"]), _slayer(nm["head"])
    if salve in ("i", "ei") and "undead" in attrs:
        f = (6, 5) if salve == "ei" else (7, 6)
        acc.append(f), dmg.append(f), notes.append(f"Salve amulet: +{'20' if salve == 'ei' else '16.7'}% against undead")
    elif slay == "i" and ctx["task"]:
        acc.append((23, 20)), dmg.append((23, 20)), notes.append("Slayer helmet (i): +15% on task")
    if "dragon" in attrs and "dragon hunter crossbow" in wn:
        acc.append((13, 10)), dmg.append((5, 4)), notes.append("Dragon hunter crossbow: +30% accuracy, +25% damage against dragons")
    if "twisted bow" in wn:
        ta, td = _tbow(m)
        acc.append((ta, 100)), dmg.append((td, 100)), notes.append(f"Twisted bow: {ta}% accuracy, {td}% damage against this monster")
    if "crystal bow" in wn or "bow of faerdhinen" in wn:
        ca = (50 if "crystal helm" in nm["head"] else 0) + (150 if "crystal body" in nm["body"] else 0) + (100 if "crystal legs" in nm["legs"] else 0)
        if ca:
            acc.append((1000 + ca, 1000)), dmg.append((1000 + ca // 2, 1000))
            notes.append(f"Crystal armour: +{ca / 10:g}% accuracy, +{ca / 20:g}% damage")
    speed = w["sp"] if w["sp"] > 0 else 5
    best = None
    for stance, bonus, sp in (("accurate", 3, speed), ("rapid", 0, speed - 1)):
        ea = _pct(ctx["R"], pa) + bonus + 8
        es = _pct(ctx["R"], ps) + bonus + 8
        if void == "ranger":
            ea, es = ea * 11 // 10, es * (1125 if elite else 1100) // 1000
        roll = _apply(ea * (ra + 64), acc)
        mx = _apply((es * (rs + 64) + 320) // 640, dmg)
        hc = _hit_chance(roll, (m["def"] + 9) * (m[dtype] + 64))
        v = hc * mx / 2 / (max(1, sp) * TICK)
        if best is None or v > best[0]:
            best = (v, stance, mx, hc, sp)
    if not detail:
        return best[0]
    v, stance, mx, hc, sp = best
    if void == "ranger":
        notes.append(f"{'Elite v' if elite else 'V'}oid: +10% accuracy, +{12.5 if elite else 10:g}% damage")
    if kind == "dart":
        notes.append(f"Loaded with {ctx['dart']['n']}")
    return {"dps": v, "max": mx, "hits": 1, "acc": hc, "speed": max(1, sp) * TICK, "how": stance.title(),
            "prayer": prayer, "potion": ctx["potions"].get("ranged"), "notes": notes}


# ---------------------------------------------------------------- magic

POWERED = (   # built-in spell max hit from your (boosted) Magic level
    ("tumeken's shadow", lambda x: x // 3 + 1), ("sanguinesti staff", lambda x: x // 3 - 1),
    ("trident of the swamp", lambda x: x // 3 - 2), ("trident of the seas", lambda x: x // 3 - 5),
    ("warped sceptre", lambda x: (8 * x + 96) // 37), ("accursed sceptre", lambda x: x // 3 - 6),
    ("thammaron's sceptre", lambda x: x // 3 - 8), ("eye of ayak", lambda x: x // 3 - 6),
)
SPELLS = (   # name, level, base max hit, element ('' = none), ancient
    ("Fire Surge", 95, 24, "fire", False), ("Earth Surge", 90, 23, "earth", False), ("Water Surge", 85, 22, "water", False),
    ("Wind Surge", 81, 21, "air", False), ("Fire Wave", 75, 20, "fire", False), ("Earth Wave", 70, 19, "earth", False),
    ("Water Wave", 65, 18, "water", False), ("Wind Wave", 62, 17, "air", False), ("Fire Blast", 59, 16, "fire", False),
    ("Earth Blast", 53, 15, "earth", False), ("Water Blast", 47, 14, "water", False), ("Wind Blast", 41, 13, "air", False),
    ("Fire Bolt", 35, 12, "fire", False), ("Fire Strike", 13, 8, "fire", False), ("Wind Strike", 1, 2, "air", False),
    ("Ice Barrage", 94, 30, "", True), ("Blood Barrage", 92, 29, "", True), ("Ice Blitz", 82, 26, "", True),
    ("Ice Burst", 70, 22, "", True), ("Ice Rush", 58, 18, "", True),
)


def magic_dps(L, m, ctx, detail=False):
    w = L.get("weapon")
    if not w or w["c"] not in ("staff", "bladed staff", "powered staff", "powered wand"):
        return None
    nm, wn = _names(L), w["n"].lower()
    powered = w["c"].startswith("powered")
    if powered:
        f = next((f for n, f in POWERED if n in wn), None)
        if not f:
            return None
        options = [(w["n"], max(1, f(ctx["M"])), "", w["sp"] if w["sp"] > 0 else 4)]
    else:
        options = [(n, base, el, 5) for n, lvl, base, el, anc in SPELLS if ctx["M"] >= lvl and (not anc or ctx["ancients"])]
    items = [it for it in L.values() if it]
    mab = sum(it["a"][4] for it in items)
    md = sum(it["md"] for it in items)
    if "tumeken's shadow" in wn:
        mab, md = mab * 3, md * 3
    pa, _, prayer = ctx["pray"]["magic"]
    void, elite = _void(nm)
    attrs = m["attrs"]
    acc, dmg, notes = [], [], []
    salve, slay = _salve(nm["neck"]), _slayer(nm["head"])
    if salve in ("i", "ei") and "undead" in attrs:
        acc.append((6, 5) if salve == "ei" else (23, 20))
        md += 20 if salve == "ei" else 15
        notes.append(f"Salve amulet: +{20 if salve == 'ei' else 15}% against undead")
    elif slay == "i" and ctx["task"]:
        acc.append((23, 20)), dmg.append((23, 20)), notes.append("Slayer helmet (i): +15% on task")
    if void == "mage":
        if elite:
            md += 2.5
        notes.append(f"{'Elite v' if elite else 'V'}oid: +45% accuracy" + (", +2.5% damage" if elite else ""))
    eff = _pct(ctx["M"], pa) + 9 + (2 if powered else 0)   # powered staves on accurate
    if void == "mage":
        eff = eff * 145 // 100
    roll = _apply(eff * (mab + 64), acc)
    hc = _hit_chance(roll, (m["mlvl"] + 9) * (m["magic"] + 64))
    best = None
    for name, base, el, sp in options:
        bonus = md + (10 if el == "fire" and "tome of fire" in nm["shield"] else 0)
        mx = _apply(base * int(1000 + bonus * 10) // 1000, dmg)
        if el and m["weak"] == el and m["weakpct"]:
            mx += base * m["weakpct"] // 100
        v = hc * mx / 2 / (sp * TICK)
        if best is None or v > best[0]:
            best = (v, name, el, mx, sp, bonus)
    if not detail:
        return best[0] if best else None
    if not best:
        return None
    v, name, el, mx, sp, bonus = best
    if el == "fire" and "tome of fire" in nm["shield"]:
        notes.append("Tome of fire: +10% fire spell damage")
    if el and m["weak"] == el and m["weakpct"]:
        notes.append(f"Weak to {el}: +{m['weakpct']}% of the spell's base damage")
    if "tumeken's shadow" in wn:
        notes.append("Tumeken's shadow: triples your magic accuracy and damage bonuses")
    return {"dps": v, "max": mx, "hits": 1, "acc": hc, "speed": sp * TICK, "how": name if not powered else "Built-in spell",
            "prayer": prayer, "potion": ctx["potions"].get("magic"), "notes": notes}


# ---------------------------------------------------------------- the search

STYLE_FN = {"melee": melee_dps, "ranged": ranged_dps, "magic": magic_dps}
EFFECT_WORDS = ("slayer helmet", "black mask", "salve amulet", "void", "obsidian", "inquisitor's", "berserker necklace",
                "crystal helm", "crystal body", "crystal legs", "tome of fire")


def _is_effect(it):
    n = it["n"].lower()
    return any(w in n for w in EFFECT_WORDS)


def _vec(it, style):
    a = it["a"]
    return (a[0], a[1], a[2], it["st"]) if style == "melee" else (a[3], it["rs"]) if style == "ranged" else (a[4], it["md"])


def _candidates(owned, style, slot):
    items = [it for it in owned if it["s"] == slot and (_is_effect(it) or any(x > 0 for x in _vec(it, style)))]
    if style == "ranged" and slot == "ammo":
        return items   # which ammo fits depends on the bow
    keep, seen = [], set()
    for it in items:   # drop items another item beats or equals in every stat that matters here
        v = _vec(it, style)
        if not _is_effect(it):
            if v in seen or any(o is not it and not _is_effect(o) and _vec(o, style) != v
                                and all(x >= y for x, y in zip(_vec(o, style), v)) for o in items):
                continue
            seen.add(v)
        keep.append(it)
    return keep


def _weapons(owned, style):
    if style == "melee":
        return [None] + [it for it in owned if it["s"] == "weapon" and it["c"] in STANCES]
    if style == "ranged":
        return [it for it in owned if it["s"] == "weapon" and it["c"] in ("bow", "crossbow", "thrown")
                and _ammo_kind(it) != "skip"]
    return [it for it in owned if it["s"] == "weapon" and it["c"] in ("staff", "bladed staff", "powered staff", "powered wand")]


def _set_seeds(owned, style):
    """Starting loadouts for set bonuses, which one-slot-at-a-time improvement can't find on its own."""
    by = lambda *subs: next((it for it in owned if any(s in it["n"].lower() for s in subs)), None)
    seeds = [{}]
    helm = by({"melee": "void melee helm", "ranged": "void ranger helm", "magic": "void mage helm"}[style])
    top, robe, gloves = by("elite void top") or by("void knight top"), by("elite void robe") or by("void knight robe"), by("void knight gloves")
    if helm and top and robe and gloves:
        seeds.append({"head": helm, "body": top, "legs": robe, "hands": gloves})
    if style == "melee":
        o = {"head": by("obsidian helmet"), "body": by("obsidian platebody"), "legs": by("obsidian platelegs")}
        if all(o.values()):
            seeds.append(o)
        q = {"head": by("inquisitor's great helm"), "body": by("inquisitor's hauberk"), "legs": by("inquisitor's plateskirt")}
        if all(q.values()):
            seeds.append(q)
    if style == "ranged":
        c = {"head": by("crystal helm"), "body": by("crystal body"), "legs": by("crystal legs")}
        c = {k: v for k, v in c.items() if v}
        if c:
            seeds.append(c)
    return seeds


def best_setup(owned, m, ctx, style):
    """The highest-DPS loadout you own for one combat style, or None if you own nothing for it."""
    fn = STYLE_FN[style]
    cands = {s: _candidates(owned, style, s) for s in SLOTS if s != "weapon"}
    order = ["ammo"] + [s for s in SLOTS if s not in ("weapon", "ammo")]

    def score(L):
        return fn(L, m, ctx) or 0.0

    def climb(L):
        cur = score(L)
        for _ in range(4):
            better = False
            for s in order:
                if s == "shield" and L["weapon"] and L["weapon"]["2h"]:
                    continue
                for c in cands[s]:
                    if c is L[s]:
                        continue
                    old, L[s] = L[s], c
                    v = score(L)
                    if v > cur + 1e-9:
                        cur, better = v, True
                    else:
                        L[s] = old
            if not better:
                break
        return cur

    def start(w, seed):
        L = dict.fromkeys(SLOTS)
        L.update(seed)
        L["weapon"] = w
        if w and w["2h"]:
            L["shield"] = None
        return L

    tried = []
    for w in _weapons(owned, style):
        L = start(w, {})
        tried.append((climb(L), id(w), L, w))
    tried.sort(key=lambda x: -x[0])
    best = tried[0] if tried and tried[0][0] > 0 else None
    seeds = _set_seeds(owned, style)[1:]
    for v, _, L, w in tried[:4]:   # the strongest weapons again, starting from each set you own
        for seed in seeds:
            L2 = start(w, seed)
            v2 = climb(L2)
            if v2 > (best[0] if best else 0) + 1e-9:
                best = (v2, id(w), L2, w)
    if not best:
        return None
    L = best[2]
    d = fn(L, m, ctx, detail=True)
    if not d:
        return None
    d["slots"] = {s: (L[s]["n"] if L[s] else None) for s in SLOTS}
    d["twoHanded"] = bool(L["weapon"] and L["weapon"]["2h"])
    d["ttk"] = m["hp"] / d["dps"] if d["dps"] > 0 else None
    d["style"] = style
    return d


# out of melee reach (in water, flying...): the wiki's tables don't say so, so these are listed by hand
NO_MELEE = {"kraken", "cave kraken", "whirlpool", "zulrah", "kree'arra", "wingman skree", "flockleader geerin",
            "flight kilisa", "aviansie", "spinolyp", "enormous tentacle"}


def best_setups(owned, m, ctx):
    out = []
    no_melee = m.get("page", "").lower() in NO_MELEE or str(m.get("name") or "").lower() in NO_MELEE
    for style in ("ranged", "magic") if no_melee else ("melee", "ranged", "magic"):
        try:
            r = best_setup(owned, m, ctx, style)
        except (KeyError, TypeError, ValueError, ZeroDivisionError):
            r = None
        if r:
            out.append(r)
    return out
