"""UI checks for OSRS Wiki Reader without the real app.

Builds tests/ui/harness.html from the real ui/index.html (asset paths pointed at ../../ui/, and the fixture and
fake-API scripts from tests/ui/ injected before the app's own scripts), then opens it in headless Microsoft Edge
once per scenario: a screenshot goes to tests/out/<name>.png and the JSON summary that tests/ui/scenarios.js
writes into document.title is checked against the scenario's expected values.

    .venv\\Scripts\\python.exe tests\\run_ui.py              run every scenario
    .venv\\Scripts\\python.exe tests\\run_ui.py dock table   run only these (names or prefixes)
    .venv\\Scripts\\python.exe tests\\run_ui.py --list       list the scenarios
    .venv\\Scripts\\python.exe tests\\run_ui.py --build      only (re)build the harness page, to open by hand

Exit code 0 when every check passed. Stdlib only. Set EDGE_PATH to use a different Edge/Chrome binary.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from html import unescape
from pathlib import Path
from urllib.parse import urlencode

TESTS = Path(__file__).resolve().parent
ROOT = TESTS.parent
UI = ROOT / "ui"
HARNESS_DIR = TESTS / "ui"
HARNESS = HARNESS_DIR / "harness.html"
OUT = TESTS / "out"
UI_PREFIX = "../../ui/"   # from tests/ui/harness.html to the real ui folder

# Scenarios: mode (a function in tests/ui/scenarios.js), window size, extra query params, and expected values in
# the reported JSON. Expected values: a plain value must be equal; a callable gets the actual value and returns
# True when it's fine. Every scenario also expects errors == [] (no uncaught JS errors) unless it says otherwise.
starts = lambda prefix: (lambda v: isinstance(v, str) and v.startswith(prefix))
at_least = lambda n: (lambda v: isinstance(v, (int, float)) and v >= n)

SCENARIOS = [
    dict(name="home", mode="home", size=(1100, 900),
         expect={"view": "home", "quick": 10, "bookmarks": True, "askOpen": False}),
    dict(name="home_light", mode="home", size=(1100, 900), params={"theme": "light"}, expect={"view": "home"}),
    dict(name="article", mode="article", size=(1100, 900),
         expect={"view": "article", "page": "Abyssal whip", "heading": "Abyssal whip", "infobox": True, "tables": at_least(1)}),
    dict(name="settings", mode="settings", size=(1100, 900),
         expect={"settingsOpen": True, "hkRow": True, "hkAskRow": True, "hk": "Ctrl + Alt + W", "hkAsk": "Ctrl + Alt + Q"}),
    dict(name="hotkey", mode="hotkey", size=(1100, 900), expect={"hk": "Ctrl + Alt + K"}),
    # 1500px wide: room for the page (>= 480px) and the chat side by side, so the chat docks on the right
    dict(name="dock_wide", mode="dock", size=(1500, 1000),
         expect={"view": "article", "askOpen": True, "docked": True, "msgs": 2,
                 "pageRight": lambda v, r: abs(v - r["askLeft"]) <= 1}),
    # 640px: too narrow to share, so the chat floats over the page
    dict(name="dock_narrow", mode="dock", size=(640, 1000), expect={"askOpen": True, "docked": False}),
    # 640px: the Ask bar at the bottom; asking opens the chat as a sheet from the bottom; tapping the page folds it
    dict(name="askbar", mode="askbar", size=(640, 900),
         expect={"before": {"bar": True, "pop": False, "narrow": True},
                 "open": {"bar": False, "pop": True, "msgs": 2, "atBottom": True, "emptied": True}}),
    dict(name="askbar_fold", mode="askbar", size=(640, 900), params={"fold": 1},
         expect={"folded": {"bar": True, "pop": False}}),
    dict(name="askbar_wide", mode="askbar", size=(1300, 900), expect={"before": {"bar": False, "pop": False, "narrow": False}}),
    # quest guide table beside the docked chat: the page column is < 820px, so tables use the compact style
    dict(name="table", mode="table", size=(1118, 1000),
         expect={"view": "article", "page": "Optimal quest guide", "docked": True, "compact": True}),
    dict(name="table_wide", mode="table", size=(1500, 1000), params={"nochat": 1},
         expect={"docked": False, "compact": False}),
    # chat history: two questions, Ctrl+N (fresh chat with the greeting), a third question, then the history menu
    dict(name="hist_menu", mode="hist", size=(1500, 1000), params={"menu": 1},
         expect={"afterNew": starts("Greetings"), "items": 2, "menuOpen": True,
                 "titles": ["Best money making at my levels?", "How do I get a fire cape?"]}),
    # ...and opening the older chat brings back its 4 messages (2 questions + 2 answers)
    dict(name="hist_load", mode="hist", size=(1500, 1000), params={"load": 1},
         expect={"afterNew": starts("Greetings"), "items": 2, "msgs": 4}),
    dict(name="ask", mode="ask", size=(1100, 900), expect={"askOpen": True, "msgs": 2}),
    dict(name="typing", mode="typing", size=(1100, 900),
         expect={"backspace": "ok", "slash": "ok", "focusInChat": True, "navUnchanged": True}),
    dict(name="char", mode="char", size=(1100, 900), expect={"view": "char"}),
    dict(name="compare", mode="compare", size=(1100, 900), expect={"view": "char"}),
    # Woodcutting: the trees table drops below the floated music players and uses the full column, pictures intact
    dict(name="wood", mode="wood", size=(1100, 900),
         expect={"rowH": lambda v: v is not None and v < 600, "wrapW": lambda v, r: v >= r["article"] - 80,
                 "imgs": lambda v: len(v) == 3 and all(i[2] > 0 for i in v)}),
    dict(name="quest", mode="quest", size=(1100, 900), expect={"page": "Dragon Slayer II", "banner": True}),
    dict(name="diary", mode="diary", size=(1100, 900), expect={"page": "Ardougne Diary", "diaryNotes": at_least(1)}),
    dict(name="methods", mode="methods", size=(1100, 900), expect={"page": "Agility", "methods": at_least(1)}),
    dict(name="hotkey_bad", mode="hotkey-bad", size=(1100, 900), expect={"note": starts("Hold Ctrl, Alt or Win")}),
    dict(name="setup", mode="setup", size=(1100, 900), expect={"askOpen": True, "setupShown": True}),
    dict(name="menu", mode="menu", size=(1100, 900), expect={"modeLabel": "Ultimate"}),
    dict(name="ctxsel", mode="ctxsel", size=(1100, 900), expect={"selBtn": True, "hasSel": True}),
    dict(name="ctxsend", mode="ctxsend", size=(1100, 900),
         expect={"sentCtx": lambda v: v["page"] == "Abyssal whip" and v["selection"].startswith("The abyssal whip is")}),
    dict(name="profile", mode="profile", size=(1100, 1000), budget=9000,
         expect={"goals": True, "closest99s": 2, "milestones": 8, "records": 4, "chartLine": True, "groupMembers": 5,
                 "groupMeHighlighted": True, "shareButton": True}),
    dict(name="profilegoals", mode="profilegoals", size=(1100, 900), budget=9000, expect={"goals": True}),
    dict(name="profilegroup", mode="profilegroup", size=(1100, 900), budget=9000, expect={"groupMembers": 5}),
    dict(name="profilechart", mode="profilechart", size=(1100, 900), budget=9000, expect={"chartLine": True}),
    dict(name="share", mode="share", size=(1100, 900), budget=9000, expect={"modal": True, "image": True}),
    dict(name="kc", mode="kc", size=(1100, 800), budget=8000, expect={"banner": True}),
    dict(name="homeupdate", mode="homeupdate", size=(1100, 900),
         expect={"update": "More Gathering Efficiencies", "fact": True, "anotherFactIsDifferent": True}),
    dict(name="cando", mode="cando", size=(1100, 800), budget=9000,
         expect={"slayer": "Slayer 85: you have 92 | Assigned by Chaeldar, Duradel, Konar, Krystilia, Mortimer, Nieve, Vannaka",
                 "magic": "Needs 94 Magic (Ancient spellbook): you have 93 (1 to go)"}),
    dict(name="homegoal", mode="homegoal", size=(1100, 1000), budget=9000, expect={"pinnedOn": True, "goal": "99 Magic", "recap": "+5.6MXP11level-ups0boss kills"}),
    dict(name="ca", mode="ca", size=(1100, 900), budget=9000,
         expect={"since": "78 tasks · 173 points", "unlocked": "Medium", "next": "263 points to Hard rewards", "tiers": 6}),
    dict(name="bank", mode="bank", size=(1100, 900), budget=25000,
         expect={"importPromptFirst": True, "card": True, "inbank": "In your bank: 1", "gearTabs": 2,
                 "value": "Worth about 52.5M on the Grand Exchange",
                 "cheapest": "Cheapest upgrade: Karil's leathertop for your Body, about 857k",
                 "questItems": {"ticked": ["pickaxe", "axe"], "some": ["3/8"]},
                 "owned": "You own 2 of the 12 best picks for this setup.",
                 "ownedLinks": ["Masori mask (f)", "Dragon hunter crossbow"],
                 "guideTicks": ["Masori mask (f)", "Dragon hunter crossbow"]}),
    dict(name="bankmore", mode="bankmore", size=(1100, 900), budget=15000,
         expect={"hits": ["Dragon axe", "Rune pickaxe"], "makeXp": ["Yew longbow (u)", "Yew shield"], "makeProfit": ["Oak plank"],
                 "where": "Karil's leathertop: drops from Chest (Barrows) (1/2,448)"}),
    dict(name="bestset", mode="bestset", size=(1100, 900), budget=15000,
         expect={"shown": True, "aboveWiki": True, "wikiFolded": True, "tabs": ["Melee 4.12", "Ranged 6.31 best", "Magic 2.05"],
                 "first": "Ranged 6.31 best", "magicHow": starts("Fire Surge"), "twoHanded": True,
                 "keptTab": starts("Magic 2.39"), "taskSaved": True, "versions": 2, "single": 1, "art": True,
                 "hero": lambda v: all(x in v for x in ("Vorkath", "732 combat", "750 hitpoints", "7×7 size", "hits up to 121",
                                                         "Attacks with Slash, Magic, Ranged, Dragonfire", "Undead", "Weak to fire +40%"))}),
    dict(name="bestset_light", mode="bestset", size=(1100, 900), budget=15000, params={"theme": "light"}, expect={"shown": True, "art": True}),
    dict(name="setprog", mode="setprog", size=(1100, 900), budget=12000,
         expect={"set": "Karil's armour set: 3/4 pieces in your bank, missing Karil's coif",
                 "stale": "Your bank was imported 10 days ago. Re-import it so the ticks stay right."}),
    dict(name="clog", mode="clog", size=(1100, 900), budget=15000,
         expect={"card": True, "ownedChip": "You have: Pet Kraken lucky", "oddsHasKraken": False,
                 "petLine": "Pet Kraken you have it · 1/3,000 · only 19% of players would have it by 630 kills lucky",
                 "tentacle": "Kraken tentacle logged", "itemChips": ["In your collection log"]}),
    dict(name="pets", mode="pets", size=(1100, 900), budget=9000,
         expect={"top3": ["Pet chaos elemental 21%", "Pet Kraken 19%", "Bran 10%"]}),
    dict(name="switcherview", mode="switcherview", size=(1100, 700), budget=9000, expect={"rows": 4}),
    dict(name="switcher", mode="switcher", size=(1100, 800), budget=9000,
         expect={"first": "Agility", "second": "Abyssal whip", "opened": "Abyssal whip", "closed": True}),
    dict(name="petluck", mode="petluck", size=(1100, 800), budget=8000,
         expect={"pet": "Pet Kraken 1/3,000 · after 630 kills, 19% of players would have it by now on rate",
                 "loot": ["Kraken tentacle logged | 1/400 | 1.6 expected | 79% would have one on rate",
                          "Trident of the Seas logged | 1/512 | 1.2 expected | 71% would have one on rate",
                          "Jar of Dirt | 1/1,000 | 0.6 expected | 47% would have one on rate"]}),
    dict(name="guide", mode="guide", size=(1100, 900), expect={"tourOpen": True, "tourTitle": "Welcome to OSRS Wiki Reader"}),
    dict(name="guidecard", mode="guidecard", size=(1100, 900), expect={"guideOpen": True}),
    # new player: the tour moves on by itself after each action, the spotlight sits on the target, Esc ends it
    dict(name="tour", mode="tour", size=(1100, 760), params={"nokey": 1}, budget=20000,
         expect={"steps": 14, "ringOnPersonIcon": True, "afterPersonIcon": "Look yourself up",
                 "afterLookup": "Tell the app it’s you", "afterWiseOldMan": "Get a free key (1 minute)",
                 "afterGear": "Hotkeys that work in-game", "ringOnHotkeys": True, "closedByEsc": True, "guideSeen": True}),
    dict(name="mini", mode="mini", size=(520, 700), expect={}),
    dict(name="update", mode="update", size=(1100, 900), budget=9000, expect={"updateModal": True}),
]


def find_edge():
    candidates = [os.environ.get("EDGE_PATH")]
    for base in (os.environ.get("ProgramFiles(x86)"), os.environ.get("ProgramFiles"), os.environ.get("LOCALAPPDATA")):
        if base:
            candidates.append(os.path.join(base, "Microsoft", "Edge", "Application", "msedge.exe"))
    candidates.append(shutil.which("msedge"))
    for c in candidates:
        if c and os.path.isfile(c):
            return c
    sys.exit("Microsoft Edge (msedge.exe) not found; set EDGE_PATH to its full path.")


def _ui_url(value):
    """Point a relative asset path from ui/index.html at the real ui folder; leave links, #ids, URLs alone."""
    if not value or value.startswith(("#", "/", "data:", "about:", "javascript:")) or re.match(r"^[a-z][a-z0-9+.-]*:", value, re.I):
        return value
    return UI_PREFIX + value


def build_harness():
    html = (UI / "index.html").read_text(encoding="utf-8")
    html = re.sub(r'\b(src|href)="([^"]*)"', lambda m: f'{m.group(1)}="{_ui_url(m.group(2))}"', html)
    html = re.sub(r'\bsrcset="([^"]*)"', lambda m: 'srcset="' + ", ".join(
        " ".join([_ui_url(p.split()[0])] + p.split()[1:]) for p in m.group(1).split(",") if p.strip()) + '"', html)
    fixtures = sorted(p.name for p in (HARNESS_DIR / "fixtures").glob("*.js"))
    inject = [f"fixtures/{f}" for f in fixtures] + ["mock_api.js", "scenarios.js"]
    tags = "".join(f'<script src="{s}"></script>' for s in inject)
    first = re.search(r"<script\b", html)
    if not first:
        sys.exit("ui/index.html has no <script> tag to inject the harness before.")
    html = (html[:first.start()] + "<!-- tests/run_ui.py: fixtures + fake API -->\n" + tags + "\n" + html[first.start():])
    html = "<!-- GENERATED by tests/run_ui.py from ui/index.html; don't edit -->\n" + html
    HARNESS.write_text(html, encoding="utf-8", newline="\n")
    return HARNESS


def run_edge(edge, url, size, budget, screenshot=None):
    """One headless Edge run in a throwaway profile; returns the dumped DOM (and writes the screenshot)."""
    profile = tempfile.mkdtemp(prefix="osrs-ui-")
    args = [edge, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
            "--no-default-browser-check", "--disable-extensions", "--mute-audio",
            f"--user-data-dir={profile}", f"--window-size={size[0]},{size[1]}",
            f"--virtual-time-budget={budget}", "--dump-dom"]
    if screenshot:
        args.append(f"--screenshot={screenshot}")
    args.append(url)
    try:
        r = subprocess.run(args, capture_output=True, timeout=120)
        return r.stdout.decode("utf-8", "replace")
    finally:
        shutil.rmtree(profile, ignore_errors=True)


def check(expect, report):
    problems = []
    if "errors" not in expect:
        expect = {**expect, "errors": []}
    for k, want in expect.items():
        got = report.get(k, "<missing>")
        if callable(want):
            try:
                ok = want(got, report) if want.__code__.co_argcount == 2 else want(got)
            except Exception:
                ok = False
            if not ok:
                problems.append(f"{k}: unexpected {got!r}")
        elif got != want:
            problems.append(f"{k}: expected {want!r}, got {got!r}")
    return problems


def run_scenario(edge, sc):
    params = {"mode": sc["mode"], **sc.get("params", {})}
    url = HARNESS.as_uri() + "?" + urlencode(params)
    png = OUT / f"{sc['name']}.png"
    if png.exists():
        png.unlink()
    t0 = time.time()
    dom = run_edge(edge, url, sc["size"], sc.get("budget", 6000), screenshot=str(png))
    m = re.search(r"<title>(.*?)</title>", dom, re.S)
    title = unescape(m.group(1)) if m else ""
    try:
        report = json.loads(title)
    except ValueError:
        report = None
    problems = []
    if not png.exists():
        problems.append("no screenshot was written")
    if report is None:
        problems.append(f"no JSON report in document.title (got {title[:120]!r})")
    else:
        problems += check(sc.get("expect", {}), report)
    return sc, report, problems, time.time() - t0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("names", nargs="*", help="scenario names or prefixes (default: all)")
    ap.add_argument("--list", action="store_true", help="list scenarios and exit")
    ap.add_argument("--build", action="store_true", help="only build tests/ui/harness.html and print its URL")
    ap.add_argument("-j", "--jobs", type=int, default=4, help="Edge instances to run at once (default 4)")
    ap.add_argument("-v", "--verbose", action="store_true", help="print each scenario's full JSON report")
    a = ap.parse_args()

    if a.list:
        for sc in SCENARIOS:
            print(f"{sc['name']:<12} mode={sc['mode']:<9} {sc['size'][0]}x{sc['size'][1]} {sc.get('params', '')}")
        return 0
    build_harness()
    if a.build:
        print(HARNESS.as_uri() + "?mode=home")
        return 0
    chosen = [sc for sc in SCENARIOS if not a.names or any(sc["name"].startswith(n) for n in a.names)]
    if not chosen:
        sys.exit("No scenario matches " + " ".join(a.names) + " (see --list).")
    OUT.mkdir(exist_ok=True)
    edge = find_edge()
    failed = 0
    with ThreadPoolExecutor(max_workers=max(1, a.jobs)) as pool:
        for sc, report, problems, secs in pool.map(lambda s: run_scenario(edge, s), chosen):
            status = "FAIL" if problems else "PASS"
            failed += bool(problems)
            print(f"{status}  {sc['name']:<12} {secs:4.1f}s  out/{sc['name']}.png")
            for p in problems:
                print(f"        - {p}")
            if a.verbose or (problems and report):
                print("        report: " + json.dumps(report, ensure_ascii=False)[:1500])
    print(f"\n{len(chosen) - failed}/{len(chosen)} passed. Screenshots in {OUT}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
