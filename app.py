"""OSRS Wiki Reader - a lightweight desktop reader for the Old School RuneScape Wiki.

Unofficial fan project. Article content comes from https://oldschool.runescape.wiki
(CC BY-NC-SA 3.0) via the public MediaWiki API.
"""

import base64
import ctypes
import ctypes.wintypes as wt
import gzip
import hashlib
import json
import os
import re
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor

import webview

from notifier import Notifier

APP_NAME = "OSRS Wiki Reader"
VERSION = "1.3.0"
# Who the wiki admins should contact if this app ever misbehaves.
CONTACT = "Discord: relay"
USER_AGENT = f"OSRSWikiReader/{VERSION} (unofficial desktop reader; {CONTACT})"

WIKI = "https://oldschool.runescape.wiki"
API = WIKI + "/api.php"
HISCORES = "https://secure.runescape.com/m=hiscore_oldschool/index_lite.json?player={}"
WOM = "https://api.wiseoldman.net/v2/players/{}"
WIKISYNC = "https://sync.runescape.wiki/runelite/player/{}/STANDARD"
PLAYER_CACHE_SECONDS = 300
PRICES = "https://prices.runescape.wiki/api/v1/osrs"
UPDATE_REPO = "PeterKyle/osrs-wiki-reader"  # GitHub releases are checked for newer versions
GEMINI = "https://generativelanguage.googleapis.com/v1beta"
GEMINI_SYSTEM = (
    "You are the assistant inside OSRS Wiki Reader, a desktop app for Old School RuneScape (OSRS) players. "
    "Only help with OSRS; if asked about something else, say briefly that you can only help with OSRS. "
    "Base your answer on the OSRS Wiki pages included with the question, which are current. If they don't cover it, "
    "say so and answer from general OSRS knowledge, noting it may be out of date. Never mix up OSRS with RuneScape 3. "
    "Be concise and practical: short paragraphs or bullet lists, with specific levels, items, locations and numbers. "
    "When you mention a wiki page, write its title in double square brackets, like [[Fire cape]]. "
    "If the player's stats are given, use them to tailor the answer (e.g. what they can do now and what they still need). "
    "The app can open wiki pages for the player. When they ask you to open, show, pull up or take them to a page or a "
    "section of one, reply with one short sentence and then put this on its own final line: "
    "OPEN: Exact page title#Section heading (leave out #Section if they didn't ask for a part of the page). "
    "Use real OSRS Wiki page titles, e.g. OPEN: Dragon Slayer II#Walkthrough. Never add an OPEN line otherwise."
)
ACCOUNT_RULES = {
    "ironman": (
        "The player is an IRONMAN. Ironmen cannot use the Grand Exchange, cannot trade other players, and cannot take "
        "other players' drops or loot; they must obtain every item themselves. Never suggest buying from the Grand "
        "Exchange or other players. Instead explain how to get items themselves (monster drops, skilling, NPC shops, "
        "minigames, quests), and prefer self-sufficient methods. For money making, focus on what is useful to an "
        "ironman (gathering their own supplies, NPC shop runs, high alchemy) rather than GP from selling. Mention "
        "ironman-specific notes from the wiki when relevant."),
    "hardcore": (
        "The player is a HARDCORE IRONMAN: all Ironman restrictions apply (no Grand Exchange, no trading, obtain "
        "everything themselves), and they lose hardcore status if they die in a dangerous area. Point out risky "
        "content, prefer safer methods and setups, and suggest precautions (escape items, safe spots)."),
    "ultimate": (
        "The player is an ULTIMATE IRONMAN: all Ironman restrictions apply (no Grand Exchange, no trading, obtain "
        "everything themselves), and they also cannot use a bank at all and keep no items on death. Suggest methods "
        "and setups that work from the inventory, looting bag and other storage they can use, and avoid plans that "
        "need banking."),
}
ACCOUNT_RULES["group"] = (
    "The player is a GROUP IRONMAN. They cannot use the Grand Exchange or trade with anyone outside their group, "
    "but they CAN trade with group members and share items through group storage. Never suggest buying from the "
    "Grand Exchange or from players outside the group. Suggest getting items themselves (drops, skilling, NPC "
    "shops, minigames, quests) or from their group, and where useful suggest splitting the work across the group "
    "(e.g. one member gathers, another processes).")
ACCOUNT_RULES["hcgim"] = ACCOUNT_RULES["group"] + (
    " They are a HARDCORE group: the group shares a limited number of lives, so point out risky content and "
    "prefer safer methods.")
ACCOUNT_LABELS = {"regular": "main account", "ironman": "Ironman", "hardcore": "Hardcore Ironman",
                  "ultimate": "Ultimate Ironman", "group": "Group Ironman", "hcgim": "Hardcore Group Ironman"}

STOPWORDS = set(
    "a an the is are was were be been do does did i im i'm me my mine you your we our to of in on at for from with by "
    "and or but how what whats what's where when which who why can could should would will get got go going best good "
    "way ways need needed it its it's this that these those there here any some much many more most than then so if "
    "into about as up out lvl please tell explain ok okay thanks thank next instead also else then just really "
    "now there's".split())
def nice_model(name):
    """'models/gemini-3.5-flash-lite' -> '3.5 Flash-Lite'"""
    m = re.search(r"gemini-([\d.]+)-flash(-lite)?", name)
    return f"{m.group(1)} Flash{'-Lite' if m.group(2) else ''}" if m else name.split("/")[-1]


FOLLOW_UP = re.compile(r"^\s*(and|but|so|also|ok|okay|then|what about|how about|what if|same)\b"
                       r"|\b(instead|it|that|them|this one|those)\b", re.I)
SKILLS = ["Attack", "Hitpoints", "Mining", "Strength", "Agility", "Smithing", "Defence", "Herblore", "Fishing",
          "Ranged", "Thieving", "Cooking", "Prayer", "Crafting", "Firemaking", "Magic", "Fletching", "Woodcutting",
          "Runecraft", "Slayer", "Farming", "Construction", "Hunter", "Sailing"]

# WikiSync reports some quests under different names than their wiki pages (from the wiki's own gadget).
QUEST_NAME_FIXES = {
    "Desert Treasure II - The Fallen Empire": "Desert Treasure II",
    "Recipe for Disaster - Another Cook's Quest": "Recipe for Disaster/Another Cook's Quest",
    "Recipe for Disaster - Culinaromancer": "Recipe for Disaster/Defeating the Culinaromancer",
    "Recipe for Disaster - Mountain Dwarf": "Recipe for Disaster/Freeing the Mountain Dwarf",
    "Recipe for Disaster - Wartface & Bentnoze": "Recipe for Disaster/Freeing the Goblin generals",
    "Recipe for Disaster - Pirate Pete": "Recipe for Disaster/Freeing Pirate Pete",
    "Recipe for Disaster - Lumbridge Guide": "Recipe for Disaster/Freeing the Lumbridge Guide",
    "Recipe for Disaster - Evil Dave": "Recipe for Disaster/Freeing Evil Dave",
    "Recipe for Disaster - King Awowogei": "Recipe for Disaster/Freeing King Awowogei",
    "Recipe for Disaster - Sir Amik Varze": "Recipe for Disaster/Freeing Sir Amik Varze",
    "Recipe for Disaster - Skrach Uglogwee": "Recipe for Disaster/Freeing Skrach Uglogwee",
}

CONFIG_DIR = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), APP_NAME)
CONFIG_FILE = os.path.join(CONFIG_DIR, "settings.json")

# Presets from older versions' settings: label -> (modifiers, virtual key). New hotkeys store "hotkey_spec".
HOTKEYS = {
    "Ctrl+Alt+W": (0x0001 | 0x0002, 0x57),
    "Ctrl+Shift+Space": (0x0002 | 0x0004, 0x20),
    "Alt+`": (0x0001, 0xC0),
    "Off": None,
}

DEFAULTS = {
    "rect": None,  # [left, top, right, bottom] in physical pixels
    "pinned": False,
    "theme": "dark",
    "zoom": 100,
    "hotkey": "Ctrl+Alt+W",  # display label, or "Off"
    "hotkey_spec": None,     # [modifiers, virtual key]; None = look the label up in HOTKEYS
    "recent": [],
    "accounts": [],  # saved RSNs
    "me": None,      # the RSN used for quest requirement checks
    "bookmarks": [],  # page titles
    "alerts": [],     # [{"id", "name", "dir": "above"|"below", "price"}]
    "gemini_key": None,  # Gemini API key, encrypted with Windows DPAPI (base64)
    "gemini_auth": None,  # how Google accepted the key: "header" | "query" | "bearer"
    "ask_limit": 300,     # max questions per day sent to Gemini (0 = no limit); a safety net on top of Google's free tier
    "gemini_skip": {},    # model -> epoch time its free quota frees up again
    "ask_used": [None, 0],  # [date, questions asked that day]
    "ask_mode": "auto",     # answer as: auto (from "my account") | regular | ironman | hardcore | ultimate | group | hcgim
}

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32
user32.FindWindowW.restype = wt.HWND
user32.MonitorFromRect.restype = wt.HANDLE


def resource_path(*parts):
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, *parts)


def load_config():
    cfg = dict(DEFAULTS)
    try:
        with open(CONFIG_FILE, encoding="utf-8") as f:
            cfg.update({k: v for k, v in json.load(f).items() if k in DEFAULTS})
    except (OSError, ValueError):
        pass
    return cfg


def save_config(cfg):
    try:
        os.makedirs(CONFIG_DIR, exist_ok=True)
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2)
    except OSError:
        pass


def http_json(url, method="GET", body=None, headers=None, timeout=15):
    """Returns (status, parsed JSON or None). Network failures raise."""
    h = {"User-Agent": USER_AGENT, "Accept-Encoding": "gzip"}
    if body is not None:
        body = json.dumps(body).encode()
        h["Content-Type"] = "application/json"
    h.update(headers or {})
    req = urllib.request.Request(url, data=body, method=method, headers=h)
    try:
        resp = urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.HTTPError as e:
        resp = e
    with resp:
        body = resp.read()
        if resp.headers.get("Content-Encoding") == "gzip":
            body = gzip.decompress(body)
        try:
            return resp.status, json.loads(body)
        except ValueError:
            return resp.status, None


def api_get(**params):
    params.update(format="json", formatversion="2")
    status, data = http_json(API + "?" + urllib.parse.urlencode(params))
    if data is None:
        raise IOError(f"wiki returned HTTP {status}")
    return data


# ---- Windows DPAPI: encrypts the Gemini key so only this Windows user can read it ----
class _Blob(ctypes.Structure):
    _fields_ = [("cbData", wt.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]


def _dpapi(data, protect):
    crypt32 = ctypes.windll.crypt32
    buf = ctypes.create_string_buffer(data, len(data))
    blob_in = _Blob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))
    blob_out = _Blob()
    fn = crypt32.CryptProtectData if protect else crypt32.CryptUnprotectData
    if not fn(ctypes.byref(blob_in), None, None, None, None, 0x1, ctypes.byref(blob_out)):  # UI_FORBIDDEN
        raise OSError("DPAPI failed")
    try:
        return ctypes.string_at(blob_out.pbData, blob_out.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(blob_out.pbData)


def protect_secret(text):
    return base64.b64encode(_dpapi(text.encode(), True)).decode()


def unprotect_secret(stored):
    return _dpapi(base64.b64decode(stored), False).decode()


def rsn_url(name):
    return urllib.parse.quote(name.strip().replace("_", " "))


def fetch_hiscores(name):
    status, data = http_json(HISCORES.format(rsn_url(name)))
    if status == 404:
        return None
    if status != 200 or not data:
        raise IOError(f"hiscores returned HTTP {status}")
    return {"name": data.get("name", name), "skills": data["skills"], "activities": data["activities"]}


def fetch_wom(name):
    status, data = http_json(WOM.format(rsn_url(name)))
    if status != 200 or not data:
        return None
    _, gained = http_json(WOM.format(rsn_url(name)) + "/gained?period=week")
    gains = None
    if gained and "data" in gained:
        gains = {
            "startsAt": gained.get("startsAt"),
            "skills": {k: v["experience"]["gained"] for k, v in gained["data"]["skills"].items()},
            "bosses": {k: v["kills"]["gained"] for k, v in gained["data"]["bosses"].items()},
        }
    return {
        "displayName": data.get("displayName"),
        "type": data.get("type"),
        "build": data.get("build"),
        "ehp": data.get("ehp"),
        "ehb": data.get("ehb"),
        "updatedAt": data.get("updatedAt"),
        "gains": gains,
    }


def fetch_account_type(name):
    """'ultimate' | 'hardcore' | 'ironman' | 'regular', from which official hiscores list the player.
    (An ultimate is also on the ironman board, so check the most specific first.)"""
    for board, kind in (("hiscore_oldschool_ultimate", "ultimate"), ("hiscore_oldschool_hardcore_ironman", "hardcore"),
                        ("hiscore_oldschool_ironman", "ironman")):
        status, _ = http_json(f"https://secure.runescape.com/m={board}/index_lite.json?player={rsn_url(name)}")
        if status == 200:
            return kind
    return "regular"


def fetch_wikisync(name):
    status, data = http_json(WIKISYNC.format(rsn_url(name)))
    if status != 200 or not data or "quests" not in data:
        return None
    quests = {}
    for q, v in data["quests"].items():
        quests[QUEST_NAME_FIXES.get(q, q)] = v
    diaries = {}
    for area, tiers in (data.get("achievement_diaries") or {}).items():
        diaries[area] = {tier: {"complete": bool(info.get("complete")), "tasks": info.get("tasks") or []}
                         for tier, info in tiers.items() if isinstance(info, dict)}
    return {"quests": quests, "levels": data.get("levels") or {}, "diaries": diaries,
            "timestamp": data.get("timestamp")}


class Api:
    """Methods exposed to the page as window.pywebview.api.*"""

    def __init__(self, cfg):
        self._cfg = cfg
        self._window = None
        self._hwnd = None
        self._cache = OrderedDict()
        self._players = {}  # lowercase rsn -> (fetched_at, data)
        self._mapping = None  # GE items: lowercase name -> item, plus "_by_id"
        self._timed = {}      # url -> (fetched_at, data) for short-lived price data
        self._lock = threading.Lock()
        self._notifier = None
        self._mini = False
        self._full_rect = None
        self._pool = ThreadPoolExecutor(max_workers=3)
        self._hotkey_thread_id = None
        self._hotkey_ok = False
        self._hk_done = threading.Event()

    # ---- wiki ----
    def search(self, query):
        query = (query or "").strip()
        if not query:
            return []
        try:
            data = api_get(action="opensearch", search=query, limit=8, namespace=0, redirects="resolve")
            return data[1]
        except Exception:
            return []

    def page(self, title):
        key = title.replace("_", " ").strip()
        if key in self._cache:
            self._cache.move_to_end(key)
            return self._cache[key]
        try:
            data = api_get(action="parse", page=key, prop="text|displaytitle", redirects=1,
                           disableeditsection=1, disabletoc=1)
        except Exception as e:
            return {"error": f"Couldn't reach the wiki ({e.__class__.__name__}). Check your connection."}
        if "error" in data:
            return {"error": data["error"].get("info", "Page not found.")}
        result = {"title": data["parse"]["title"], "html": data["parse"]["text"]}
        self._cache[key] = result
        if len(self._cache) > 60:
            self._cache.popitem(last=False)
        self._remember(result["title"])
        return result

    def random(self):
        try:
            return api_get(action="query", list="random", rnnamespace=0, rnlimit=1)["query"]["random"][0]["title"]
        except Exception:
            return None

    def open_external(self, url):
        if isinstance(url, str) and url.startswith(("https://", "http://")):
            webbrowser.open(url)

    # ---- player lookups ----
    def player(self, name, refresh=False):
        name = (name or "").strip().replace("_", " ")
        if not name or len(name) > 12:
            return {"error": "Enter a valid RuneScape name (up to 12 characters)."}
        key = name.lower()
        cached = self._players.get(key)
        if cached and not refresh and time.time() - cached[0] < PLAYER_CACHE_SECONDS:
            return cached[1]

        hs = self._pool.submit(fetch_hiscores, name)
        wom = self._pool.submit(fetch_wom, name)
        sync = self._pool.submit(fetch_wikisync, name)
        try:
            hiscores = hs.result()
        except Exception as e:
            return {"error": f"Couldn't reach the OSRS hiscores ({e.__class__.__name__}). Try again in a moment."}
        try:
            wom_data = wom.result()
        except Exception:
            wom_data = None
        try:
            sync_data = sync.result()
        except Exception:
            sync_data = None
        if hiscores is None:
            return {"error": f"“{name}” isn't on the OSRS hiscores. Check the spelling, or the account may be too new to be ranked."}

        account_type = (wom_data or {}).get("type")
        if account_type not in ("regular", "ironman", "hardcore", "ultimate"):
            try:
                account_type = fetch_account_type(name)
            except Exception:
                account_type = None
        result = {
            "accountType": account_type,
            "name": (wom_data or {}).get("displayName") or hiscores["name"] or name,
            "skills": hiscores["skills"],
            "activities": hiscores["activities"],
            "wom": wom_data,
            "sync": sync_data,
            "fetchedAt": int(time.time()),
        }
        self._players[key] = (time.time(), result)
        return result

    def wom_update(self, name):
        """Ask Wise Old Man to re-check this player (also starts tracking an untracked player)."""
        name = (name or "").strip()
        try:
            status, data = http_json(WOM.format(rsn_url(name)), method="POST")
        except Exception as e:
            return {"error": f"Couldn't reach Wise Old Man ({e.__class__.__name__})."}
        if status == 429:
            return {"error": "Wise Old Man only allows an update every so often. Try again in a minute."}
        if status not in (200, 201):
            msg = (data or {}).get("message") if isinstance(data, dict) else None
            return {"error": msg or f"Wise Old Man couldn't update this player (HTTP {status})."}
        return self.player(name, refresh=True)

    def save_account(self, name):
        name = (name or "").strip()
        if name and name.lower() not in [a.lower() for a in self._cfg["accounts"]]:
            self._cfg["accounts"] = (self._cfg["accounts"] + [name])[-8:]
            save_config(self._cfg)
        return self.get_state()

    def remove_account(self, name):
        self._cfg["accounts"] = [a for a in self._cfg["accounts"] if a.lower() != (name or "").lower()]
        if self._cfg["me"] and self._cfg["me"].lower() == (name or "").lower():
            self._cfg["me"] = self._cfg["accounts"][0] if self._cfg["accounts"] else None
        save_config(self._cfg)
        return self.get_state()

    def set_me(self, name):
        self._cfg["me"] = name or None
        if name:
            return self.save_account(name)
        save_config(self._cfg)
        return self.get_state()

    # ---- Grand Exchange prices (prices.runescape.wiki) ----
    def _get_timed(self, url, max_age):
        hit = self._timed.get(url)
        if hit and time.time() - hit[0] < max_age:
            return hit[1]
        status, data = http_json(url)
        if status != 200 or data is None:
            raise IOError(f"prices API returned HTTP {status}")
        self._timed[url] = (time.time(), data)
        return data

    def _items(self):
        with self._lock:
            if self._mapping is None:
                path = os.path.join(CONFIG_DIR, "ge-items.json")
                items = None
                try:
                    if time.time() - os.path.getmtime(path) < 86400:
                        with open(path, encoding="utf-8") as f:
                            items = json.load(f)
                except (OSError, ValueError):
                    pass
                if items is None:
                    status, items = http_json(PRICES + "/mapping")
                    if status != 200 or not isinstance(items, list):
                        raise IOError("couldn't load the GE item list")
                    try:
                        os.makedirs(CONFIG_DIR, exist_ok=True)
                        with open(path, "w", encoding="utf-8") as f:
                            json.dump(items, f)
                    except OSError:
                        pass
                self._mapping = {i["name"].lower(): i for i in items}
                self._mapping["_by_id"] = {i["id"]: i for i in items}
            return self._mapping

    def _item_summary(self, item, latest, day):
        p = latest.get(str(item["id"])) or {}
        d = day.get(str(item["id"])) or {}
        return {
            "id": item["id"], "name": item["name"], "icon": item.get("icon"),
            "members": item.get("members"), "limit": item.get("limit"),
            "highalch": item.get("highalch"), "value": item.get("value"),
            "high": p.get("high"), "low": p.get("low"),
            "highTime": p.get("highTime"), "lowTime": p.get("lowTime"),
            "avgHigh24": d.get("avgHighPrice"), "avgLow24": d.get("avgLowPrice"),
            "volume24": (d.get("highPriceVolume") or 0) + (d.get("lowPriceVolume") or 0),
        }

    def item_price(self, title):
        """GE price info if `title` is a tradeable item, else None."""
        try:
            item = self._items().get((title or "").lower())
            if not item:
                return None
            latest = self._get_timed(f"{PRICES}/latest?id={item['id']}", 60)["data"]
            day = self._get_timed(f"{PRICES}/24h", 300)["data"]
            return self._item_summary(item, latest, day)
        except Exception as e:
            return {"error": f"Couldn't load GE prices ({e.__class__.__name__})."}

    def price_history(self, item_id, timestep):
        if timestep not in ("5m", "1h", "6h", "24h"):
            return []
        try:
            data = self._get_timed(f"{PRICES}/timeseries?timestep={timestep}&id={int(item_id)}", 600)["data"]
        except Exception:
            return []
        return [[d["timestamp"], d.get("avgHighPrice"), d.get("avgLowPrice")] for d in data]

    # ---- training methods for the XP calculator (wiki Bucket data) ----
    def _bucket(self, query):
        status, data = http_json(API + "?" + urllib.parse.urlencode({"action": "bucket", "format": "json", "query": query}))
        if status != 200 or not data or "bucket" not in data:
            raise IOError(f"bucket query failed (HTTP {status})")
        return data["bucket"]

    def training_methods(self, skill):
        if skill not in SKILLS:
            return []
        path = os.path.join(CONFIG_DIR, "methods", skill + ".json")
        try:
            if time.time() - os.path.getmtime(path) < 7 * 86400:
                with open(path, encoding="utf-8") as f:
                    return json.load(f)
        except (OSError, ValueError):
            pass
        try:
            methods = self._fetch_methods(skill)
        except Exception:
            return []
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                json.dump(methods, f)
        except OSError:
            pass
        return methods

    def _fetch_methods(self, skill):
        def num(v):
            try:
                return float(str(v).replace(",", "").strip())
            except (TypeError, ValueError):
                return None

        out, seen = [], set()

        def add(name, level, xp, image=None, page=None, note=""):
            key = (name, level, xp)
            if xp and xp > 0 and key not in seen:
                seen.add(key)
                out.append({"name": name, "level": int(level or 1), "xp": round(xp, 2),
                            "image": image, "page": page or name, "note": note})

        if skill in ("Attack", "Strength", "Defence", "Ranged", "Hitpoints", "Slayer"):
            field = "slayer_experience" if skill == "Slayer" else "hitpoints"
            rows = self._bucket(f"bucket('infobox_monster').select('page_name','name','hitpoints','combat_level',"
                                f"'experience_bonus','slayer_experience','slayer_level').where('{field}','>',0).limit(5000).run()")
            for r in rows:
                bonus = 1 + (num(r.get("experience_bonus")) or 0) / 100
                level = num(r.get("slayer_level")) if skill == "Slayer" else 1
                if skill == "Slayer":
                    xp = num(r.get("slayer_experience"))
                else:
                    hp = num(r.get("hitpoints")) or 0
                    xp = hp * (1.33 if skill == "Hitpoints" else 4) * bonus
                note = f"level {int(num(r.get('combat_level')) or 0)} · per kill"
                add(r.get("name") or r["page_name"], level, xp, None, r["page_name"], note)
            out.sort(key=lambda m: (m["xp"], m["name"]))
        if skill not in ("Attack", "Strength", "Defence", "Ranged", "Hitpoints"):
            rows = self._bucket(f"bucket('recipe').select('page_name','production_json').where('uses_skill','{skill}').limit(5000).run()")
            for r in rows:
                try:
                    p = json.loads(r["production_json"])
                except (TypeError, ValueError):
                    continue
                output = p.get("output") if isinstance(p.get("output"), dict) else {}
                name = p.get("name") or output.get("name") or r["page_name"]
                materials = ", ".join(m.get("name", "") for m in (p.get("materials") or []) if isinstance(m, dict))[:60]
                # e.g. Agility obstacles: "Gap" alone is useless, the page ("Gap (Ape Atoll)") says where it is
                note = materials or (r["page_name"] if r["page_name"] != name else "")
                for s in p.get("skills") or []:
                    if s.get("name") == skill:
                        add(name, num(s.get("level")) or 1, num(s.get("experience")), output.get("image"),
                            r["page_name"], note)
            out.sort(key=lambda m: (m["level"], m["xp"], m["name"]))
        return out

    # ---- price alerts ----
    def set_alert(self, item_id, direction, price):
        item_id, price = int(item_id), int(price)
        if direction not in ("above", "below") or price <= 0:
            return self.get_state()
        item = self._items()["_by_id"].get(item_id)
        if not item:
            return self.get_state()
        alerts = [a for a in self._cfg["alerts"] if not (a["id"] == item_id and a["dir"] == direction)]
        alerts.append({"id": item_id, "name": item["name"], "dir": direction, "price": price})
        self._cfg["alerts"] = alerts
        save_config(self._cfg)
        self._sync_tray()
        return self.get_state()

    def remove_alert(self, item_id, direction):
        self._cfg["alerts"] = [a for a in self._cfg["alerts"] if not (a["id"] == int(item_id) and a["dir"] == direction)]
        save_config(self._cfg)
        self._sync_tray()
        return self.get_state()

    def _sync_tray(self):
        if not self._notifier:
            return
        n = len(self._cfg["alerts"])
        if n:
            self._notifier.show(f"{APP_NAME}: {n} price alert{'s' if n != 1 else ''}")
        else:
            self._notifier.hide()

    def _check_alerts(self):
        """Checks price alerts (every 5 minutes, on the notifier's timer)."""
        alerts = list(self._cfg["alerts"])
        if not alerts:
            return
        try:
            latest = self._get_timed(f"{PRICES}/latest", 60)["data"]
        except Exception:
            return
        fired = []
        for a in alerts:
            p = latest.get(str(a["id"])) or {}
            price = p.get("high") or p.get("low")
            if price and ((a["dir"] == "above" and price >= a["price"]) or (a["dir"] == "below" and price <= a["price"])):
                fired.append((a, price))
        if not fired:
            return
        done = {(a["id"], a["dir"]) for a, _ in fired}
        self._cfg["alerts"] = [a for a in self._cfg["alerts"] if (a["id"], a["dir"]) not in done]
        save_config(self._cfg)
        for a, price in fired:
            word = "risen above" if a["dir"] == "above" else "dropped below"
            self._notifier.notify(f"{a['name']} has {word} {a['price']:,} gp",
                                  f"Now {price:,} gp on the Grand Exchange. Click to open the item.", a["name"])
        # Leave the tray icon up even if no alerts remain: removing it would also delete the notification.
        if self._cfg["alerts"]:
            self._sync_tray()
        try:
            self._window.evaluate_js(f"window.onAlertsFired && onAlertsFired({json.dumps([a for a, _ in fired])})")
        except Exception:
            pass

    def _on_tray_click(self, title):
        self._window.show()
        if self._hwnd:
            if user32.IsIconic(self._hwnd):
                self._window.restore()
            user32.SetForegroundWindow(self._hwnd)
        if title:
            self._window.evaluate_js(f"openPage({json.dumps(title)})")

    # ---- quest requirement data (for "quests you can do now") ----
    def quest_requirements(self):
        path = os.path.join(CONFIG_DIR, "quests.json")
        try:
            if time.time() - os.path.getmtime(path) < 7 * 86400:
                with open(path, encoding="utf-8") as f:
                    return json.load(f)
        except (OSError, ValueError):
            pass
        try:
            rows = self._bucket("bucket('quest').select('page_name','official_difficulty','official_length',"
                                "'requirements').limit(1000).run()")
        except Exception:
            return []
        names = {r["page_name"] for r in rows}
        quests = []
        for r in rows:
            req = r.get("requirements") or ""
            skills = [[s, int(l)] for s, l in re.findall(r'data-skill="([^"]+)" data-level="(\d+)"', req)]
            links = re.findall(r"\[\[([^\]|#]+)", req)
            prereqs = sorted({l.strip() for l in links if l.strip() in names and l.strip() != r["page_name"]})
            quests.append({"name": r["page_name"], "difficulty": r.get("official_difficulty") or "",
                           "length": r.get("official_length") or "", "skills": skills, "quests": prereqs})
        try:
            os.makedirs(CONFIG_DIR, exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                json.dump(quests, f)
        except OSError:
            pass
        return quests

    # ---- auto-update from GitHub releases ----
    def check_update(self):
        try:
            status, rel = http_json(f"https://api.github.com/repos/{UPDATE_REPO}/releases/latest")
        except Exception:
            return {"available": False}
        if status != 200 or not isinstance(rel, dict):
            return {"available": False}
        tag = (rel.get("tag_name") or "").lstrip("vV")
        asset = next((a for a in rel.get("assets", []) if a.get("name", "").lower().endswith(".exe")), None)

        def ver(s):
            try:
                return tuple(int(x) for x in s.split("."))
            except ValueError:
                return (0,)

        if not asset or ver(tag) <= ver(VERSION):
            return {"available": False, "latest": tag}
        self._update = {"version": tag, "url": asset["browser_download_url"], "size": asset.get("size"),
                        "digest": asset.get("digest")}
        return {"available": True, "version": tag, "notes": (rel.get("body") or "")[:600],
                "canInstall": bool(getattr(sys, "frozen", False)), "page": rel.get("html_url")}

    def install_update(self):
        """Download the new exe next to this one, then swap it in with a tiny script once we've exited."""
        up = getattr(self, "_update", None)
        if not up or not getattr(sys, "frozen", False):
            return {"error": "Updates can only be installed from the packaged app."}
        exe = sys.executable
        new = exe + ".new"
        try:
            req = urllib.request.Request(up["url"], headers={"User-Agent": USER_AGENT})
            h = hashlib.sha256()
            with urllib.request.urlopen(req, timeout=60) as resp, open(new, "wb") as f:
                while chunk := resp.read(1 << 16):
                    f.write(chunk)
                    h.update(chunk)
            if up.get("size") and os.path.getsize(new) != up["size"]:
                raise IOError("download was incomplete")
            if up.get("digest", "").startswith("sha256:") and h.hexdigest() != up["digest"][7:]:
                raise IOError("download didn't match its checksum")
        except Exception as e:
            try:
                os.remove(new)
            except OSError:
                pass
            return {"error": f"Update failed: {e}"}

        # A one-file PyInstaller exe runs as two processes (bootloader + app); both lock the file, so wait
        # for both to exit, then swap the files and restart. `ping` is the sleep: `timeout` needs a console.
        temp = os.environ.get("TEMP", CONFIG_DIR)
        script = os.path.join(temp, "osrs-wiki-reader-update.cmd")
        log = os.path.join(temp, "osrs-wiki-reader-update.log")
        sleep = "ping -n 2 127.0.0.1 >nul"
        lines = ["@echo off", f'echo %date% %time% updating to {up["version"]}> "{log}"', "set tries=0"]
        for i, pid in enumerate([os.getpid(), os.getppid()]):
            lines += [f":wait{i}", f'tasklist /NH /FI "PID eq {pid}" 2>nul | find " {pid} " >nul || goto waited{i}',
                      "set /a tries+=1", f"if %tries% lss 60 ({sleep} & goto wait{i})", f":waited{i}"]
        lines += [f'echo %time% app closed>> "{log}"', "set tries=0", ":move",
                  f'move /y "{new}" "{exe}" >nul 2>&1 && goto moved', "set /a tries+=1",
                  f'if %tries% lss 30 ({sleep} & goto move)', f'echo %time% could not replace the exe>> "{log}"', "goto start",
                  ":moved", f'echo %time% replaced>> "{log}"', ":start", f'start "" "{exe}"', f'echo %time% restarted>> "{log}"',
                  'del "%~f0"']
        with open(script, "w", encoding="mbcs") as f:
            f.write("\r\n".join(lines) + "\r\n")
        # Don't leak this process's PyInstaller variables into the restarted exe, or it will think it's our
        # child process and look for its files in our (by then deleted) temp folder.
        env = {k: v for k, v in os.environ.items() if not k.upper().startswith(("_PYI_", "_MEIPASS"))}
        env["PYINSTALLER_RESET_ENVIRONMENT"] = "1"
        subprocess.Popen(["cmd", "/c", script], creationflags=0x08000000 | 0x00000008, close_fds=True,  # no window, detached
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)
        threading.Timer(0.5, self._window.destroy).start()
        return {"ok": True}

    # ---- "Ask" chat: Gemini (free tier) answering from OSRS Wiki pages ----
    def _gemini_key(self):
        try:
            return unprotect_secret(self._cfg["gemini_key"]) if self._cfg.get("gemini_key") else None
        except Exception:
            return None

    @staticmethod
    def _gemini_call(path, key, auth, body=None, timeout=15):
        """Gemini REST call. Newer AI Studio keys ("AQ.") aren't accepted the same way everywhere, so the key
        can go in the documented x-goog-api-key header, the ?key= parameter, or as a Bearer token."""
        url, headers = GEMINI + path, {}
        if auth == "query":
            url += ("&" if "?" in url else "?") + "key=" + urllib.parse.quote(key)
        elif auth == "bearer":
            headers["Authorization"] = "Bearer " + key
        else:
            headers["x-goog-api-key"] = key
        return http_json(url, method="POST" if body is not None else "GET", body=body, headers=headers, timeout=timeout)

    def _gemini_models(self, key, auth=None):
        """Stable Gemini Flash models this key can use, best first (names change often, so ask Google)."""
        status, data = self._gemini_call("/models?pageSize=200", key, auth or self._cfg.get("gemini_auth"))
        if status != 200 or not isinstance(data, dict):
            msg = ((data or {}).get("error") or {}).get("message", "") if isinstance(data, dict) else ""
            raise PermissionError(msg or f"HTTP {status}")
        found = []
        for m in data.get("models", []):
            hit = re.fullmatch(r"models/gemini-(\d+(?:\.\d+)?)-flash(-lite)?", m.get("name", ""))
            if hit and "generateContent" in m.get("supportedGenerationMethods", []):
                found.append((float(hit.group(1)), not hit.group(2), m["name"]))
        found.sort(reverse=True)                       # newest first; Flash before Flash-Lite
        names = [n for v, full, n in found if full] + [n for v, full, n in found if not full]
        if any(m.get("name") == "models/gemini-flash-latest" for m in data.get("models", [])):
            names.append("models/gemini-flash-latest")
        return names

    def gemini_status(self):
        day, used = self._cfg.get("ask_used") or [None, 0]
        return {"hasKey": bool(self._cfg.get("gemini_key")), "model": getattr(self, "_gemini_model", None),
                "limit": self._cfg.get("ask_limit"), "usedToday": used if day == time.strftime("%Y-%m-%d") else 0}

    def set_ask_limit(self, n):
        self._cfg["ask_limit"] = max(0, min(1000, int(n)))
        save_config(self._cfg)
        return self.gemini_status()

    def gemini_set_key(self, key):
        key = (key or "").strip()
        if not re.fullmatch(r"[A-Za-z0-9_.\-]{20,300}", key):
            return {"error": "That doesn't look like a Gemini API key. Copy the whole key from AI Studio (it starts with \"AQ.\" or \"AIza\")."}
        first_error = None
        for auth in ("header", "query", "bearer"):
            try:
                models = self._gemini_models(key, auth)
            except PermissionError as e:
                first_error = first_error or str(e)
                continue
            except Exception as e:
                return {"error": f"Couldn't reach Google ({e.__class__.__name__}). Check your connection."}
            if not models:
                return {"error": "That key works, but no Gemini Flash models are available to it."}
            self._gemini_list = models
            self._cfg["gemini_key"] = protect_secret(key)
            self._cfg["gemini_auth"] = auth
            save_config(self._cfg)
            return {"ok": True}
        return {"error": f"Google didn't accept that key: {first_error}"}

    def gemini_clear_key(self):
        self._cfg["gemini_key"] = None
        self._gemini_list = None
        save_config(self._cfg)
        return {"ok": True}

    def _find_pages(self, question):
        """Wiki pages relevant to a question: real page titles found in its phrases, then full-text search."""
        toks = re.findall(r"[a-z0-9'()\-]+", question.lower())
        phrases = []
        for n in (4, 3, 2, 1):
            for i in range(len(toks) - n + 1):
                w = toks[i:i + n]
                if w[0] in STOPWORDS or w[-1] in STOPWORDS or (n == 1 and len(w[0]) < 3):
                    continue
                p = " ".join(w)
                if p not in phrases:
                    phrases.append(p)
        multi, single = [], []
        # "how do I level sailing" -> the wiki's "Sailing training" guide is the page that answers it
        if re.search(r"\b(level|levels|leveling|levelling|train|training|xp|exp|experience|99)\b", question, re.I):
            for skill in SKILLS:
                if re.search(rf"\b{skill}\b", question, re.I):
                    phrases.insert(0, f"{skill.lower()} training")
        titles = [p[0].upper() + p[1:] for p in phrases][:50]
        if titles:
            q = api_get(action="query", titles="|".join(titles), redirects=1)["query"]
            norm = {r["from"]: r["to"] for r in q.get("normalized", [])}
            redir = {r["from"]: r["to"] for r in q.get("redirects", [])}
            exists = {p["title"] for p in q.get("pages", []) if "missing" not in p and "invalid" not in p}
            for t in titles:
                t2 = norm.get(t, t)
                t2 = redir.get(t2, t2)
                if t2 in exists and t2 not in multi + single and "disambiguation" not in t2:
                    (multi if " " in t.strip() else single).append(t2)
        pages = multi[:3] if multi else single[:2]   # one-word pages ("Fire", "Cape") only if nothing better matched
        words = [t for t in toks if t not in STOPWORDS]
        if words and len(pages) < 3:
            league = "league" in question.lower()
            found = [r["title"] for r in api_get(action="query", list="search", srsearch=" ".join(words), srlimit=6,
                                                   srprop="")["query"]["search"]
                     if r["title"] not in pages and (league or "League" not in r["title"])]
            # keep search hits whose title shares a real word with the question ("Cooking" for a Sailing question is noise)
            related = [t for t in found if any(len(w) >= 4 and w.rstrip("s") in t.lower() for w in words)]
            pages += related or (found[:2] if not pages else [])
        return pages[:3]

    def _page_text(self, title):
        key = "x:" + title
        if key not in self._cache:
            q = api_get(action="query", prop="extracts", explaintext=1, exsectionformat="plain", titles=title, redirects=1)
            p = (q.get("query", {}).get("pages") or [{}])[0]
            self._cache[key] = {"title": p.get("title", title), "text": (p.get("extract") or "")[:6000]}
        return self._cache[key]

    def ask(self, question, history=None):
        question = (question or "").strip()[:1000]
        key = self._gemini_key()
        if not key:
            return {"error": "Add your free Gemini key first.", "needKey": True}
        if not question:
            return {"error": "Type a question first."}
        today = time.strftime("%Y-%m-%d")
        day, used = self._cfg.get("ask_used") or [None, 0]
        used = used if day == today else 0
        limit = int(self._cfg.get("ask_limit") or 0)
        if limit and used >= limit:
            return {"error": f"You've used today's {limit} questions (your daily limit in Settings). It resets tomorrow."}

        # Follow-ups ("what about with melee instead?") rarely name the page, so keep the main page from the last answer.
        topic = next(((t.get("sources") or [None])[0] for t in reversed(history or [])
                      if t.get("role") == "model" and t.get("sources")), None)
        try:
            titles = self._find_pages(question)
            if topic and (len(titles) < 2 or FOLLOW_UP.search(question)):
                titles = [topic] + [t for t in titles if t != topic]
            pages = [p for p in (self._page_text(t) for t in titles[:3]) if p["text"]]
        except Exception:
            pages = []
        context = "\n\n".join(f"=== OSRS Wiki page: {p['title']} ===\n{p['text']}" for p in pages)
        player = self._player_summary()
        mode = self._answer_mode()
        system = GEMINI_SYSTEM + (f"\n\nThe player asking: {player}" if player else "")
        if mode in ACCOUNT_RULES:
            system += "\n\n" + ACCOUNT_RULES[mode]
        if (self._cfg.get("ask_mode") or "auto") != "auto":
            system += ("\n\nThe player chose to get advice as a " + ACCOUNT_LABELS.get(mode, mode) +
                       ", so answer for that account type even if the stats above say otherwise."
                       + (" Normal advice is fine, including the Grand Exchange." if mode == "regular" else ""))

        # Only the last 2 exchanges, with older answers shortened: enough for follow-ups, without resending the
        # whole chat every time. (Free quota counts requests, not size, but smaller requests answer faster.)
        contents = []
        for turn in (history or [])[-4:]:
            if turn.get("role") in ("user", "model") and turn.get("text"):
                limit = 1500 if turn["role"] == "model" else 500
                contents.append({"role": turn["role"], "parts": [{"text": str(turn["text"])[:limit]}]})
        prompt = (f"Wiki pages for this question:\n\n{context}\n\n---\n\nQuestion: {question}" if context
                  else f"(No matching wiki pages were found.)\n\nQuestion: {question}")
        contents.append({"role": "user", "parts": [{"text": prompt}]})
        body = {"systemInstruction": {"parts": [{"text": system}]}, "contents": contents,
                "generationConfig": {"temperature": 0.4, "maxOutputTokens": 4096}}

        try:
            models = getattr(self, "_gemini_list", None) or self._gemini_models(key)
            self._gemini_list = models
        except PermissionError as e:
            return {"error": f"Google rejected your key ({e}). You can add a new one from the chat menu.", "needKey": True}
        except Exception as e:
            return {"error": f"Couldn't reach Google ({e.__class__.__name__}). Check your connection."}

        self._cfg["ask_used"] = [today, used + 1]   # counted per question, even if Google turns it down
        save_config(self._cfg)
        # Each free model has its own allowance (e.g. 3.8 Flash 20/day, each Flash-Lite 500/day), so use them in
        # turn and remember which ones are used up, for a minute or until the daily reset.
        now = time.time()
        skip = {m: t for m, t in (self._cfg.get("gemini_skip") or {}).items() if t > now}
        ready = [m for m in models if m not in skip]
        if not ready:
            return {"error": f"All the free Gemini models are at their limit right now. The next one frees up in about "
                             f"{self._wait_text(min(skip.values()) - now)}. It never charges you."}
        limited, busy, offline = False, False, None
        deadline = now + 120
        for i, model in enumerate(ready[:8]):
            if time.time() > deadline:
                break
            if i:
                self._ask_status(f"{nice_model(ready[i - 1])} is busy, trying {nice_model(model)}…")
            else:
                self._ask_status(f"Asking {nice_model(model)}…")
            status, data, text = self._gemini_stream(model, key, body)
            if status == "offline":
                offline = data
                break
            if status in ("timeout", 500, 502, 503, 504):  # overloaded or hung: rest it a few minutes, try the next
                busy = True
                skip[model] = time.time() + 180
            elif status == 429:                           # free quota used up for now / for today
                limited = True
                skip[model] = self._quota_reset(data, time.time())
            elif status in (403, 404):                    # not available to this key
                skip[model] = time.time() + 3 * 86400
            if status != 200:
                self._cfg["gemini_skip"] = skip
                save_config(self._cfg)
                if status in ("timeout", 429, 403, 404, 500, 502, 503, 504):
                    continue
                msg = ((data or {}).get("error") or {}).get("message", "") if isinstance(data, dict) else ""
                return {"error": f"Gemini returned an error: {msg or 'HTTP ' + str(status)}"}
            if not text:
                return {"error": f"Gemini didn't give an answer ({data or 'empty response'}). Try rephrasing."}
            self._gemini_model = model.split("/")[-1]
            text, open_page = self._take_open_command(text)
            return {"answer": text, "sources": [p["title"] for p in pages], "model": self._gemini_model,
                    "open": open_page, "mode": mode}
        if offline:
            return {"error": f"Couldn't reach Google ({offline}). Check your connection."}
        if busy and not limited:
            return {"error": "Google's Gemini models are overloaded right now (this happens at busy times). "
                             "Try again in a few minutes."}
        if limited:
            soonest = min(skip.values(), default=now + 60)
            return {"error": f"All the free Gemini models are at their limit right now. The next one frees up in about "
                             f"{self._wait_text(soonest - now)}. It never charges you."}
        return {"error": "Gemini is busy or unavailable right now. Try again in a moment."}

    def _ask_status(self, text):
        try:
            self._window.evaluate_js(f"window.askStatus && askStatus({json.dumps(text)})")
        except Exception:
            pass

    def _gemini_stream(self, model, key, body, quiet=20, think_low=True):
        """Streams one answer, showing it in the chat as it arrives. A model that sends nothing for `quiet`
        seconds counts as hung. Returns (status, error_json_or_reason, text): status is 200, an HTTP code,
        "timeout" or "offline"."""
        req_body = dict(body)
        if think_low and re.search(r"gemini-[3-9]", model):     # 3.x+ models: think less, answer faster
            req_body["generationConfig"] = {**body.get("generationConfig", {}), "thinkingConfig": {"thinkingLevel": "low"}}
        auth = self._cfg.get("gemini_auth")
        url = f"{GEMINI}/{model}:streamGenerateContent?alt=sse"
        headers = {"User-Agent": USER_AGENT, "Content-Type": "application/json"}
        if auth == "query":
            url += "&key=" + urllib.parse.quote(key)
        elif auth == "bearer":
            headers["Authorization"] = "Bearer " + key
        else:
            headers["x-goog-api-key"] = key
        req = urllib.request.Request(url, data=json.dumps(req_body).encode(), method="POST", headers=headers)
        text, reason, last_push = "", None, 0.0
        try:
            with urllib.request.urlopen(req, timeout=quiet) as resp:
                for raw in resp:
                    line = raw.decode("utf-8", "replace").strip()
                    if not line.startswith("data:"):
                        continue
                    chunk = json.loads(line[5:])
                    for c in chunk.get("candidates") or []:
                        for p in (c.get("content") or {}).get("parts") or []:
                            if not p.get("thought"):
                                text += p.get("text", "")
                        reason = c.get("finishReason") or reason
                    reason = reason or (chunk.get("promptFeedback") or {}).get("blockReason")
                    if text and time.time() - last_push > 0.25:
                        last_push = time.time()
                        try:
                            self._window.evaluate_js(f"window.askStream && askStream({json.dumps(text)})")
                        except Exception:
                            pass
        except urllib.error.HTTPError as e:
            try:
                err = json.loads(e.read() or b"{}")
            except ValueError:
                err = {}
            if e.code == 400 and think_low and "thinking" in json.dumps(err).lower():
                return self._gemini_stream(model, key, body, quiet, think_low=False)  # model rejects it: retry without
            return e.code, err, ""
        except (TimeoutError, socket.timeout):
            return ("timeout", None, "") if not text else (200, reason, text.strip())
        except urllib.error.URLError as e:
            if isinstance(e.reason, (TimeoutError, socket.timeout)):
                return "timeout", None, ""
            return "offline", e.reason.__class__.__name__, ""
        except (OSError, ValueError) as e:
            return ("offline", e.__class__.__name__, "") if not text else (200, reason, text.strip())
        return 200, reason, text.strip()

    def _take_open_command(self, text):
        """Strips an "OPEN: Page#Section" line from the answer; returns (answer, {title, anchor} or None).
        The page must really exist on the wiki (redirects followed), so a made-up title can't open anything."""
        found = None
        lines = []
        for line in text.splitlines():
            m = re.match(r"^\s*\**\s*OPEN:\s*\[*([^\]#\n]+?)\]*\s*(?:#\s*([^\n]+?))?\s*\**\s*$", line)
            if m and found is None:
                found = (m.group(1).strip(), (m.group(2) or "").strip())
            elif not m:
                lines.append(line)
        if not found:
            return text, None
        title, section = found
        try:
            q = api_get(action="query", titles=title[:250], redirects=1)["query"]
            page = (q.get("pages") or [{}])[0]
            if "missing" in page or "invalid" in page:
                return "\n".join(lines).strip(), None
            title = page["title"]
            redirect_anchor = next((r.get("tofragment", "") for r in q.get("redirects", [])), "")
        except Exception:
            return "\n".join(lines).strip(), None
        return "\n".join(lines).strip(), {"title": title, "anchor": section or redirect_anchor}

    @staticmethod
    def _quota_reset(err, now):
        """When a model's free quota frees up again, from Google's 429 error details."""
        e = (err or {}).get("error", {}) if isinstance(err, dict) else {}
        details = e.get("details") or []
        quota_ids = " ".join(v.get("quotaId", "") for d in details for v in (d.get("violations") or []))
        if re.search(r"limit:\s*0\b", e.get("message", "")):
            return now + 3 * 86400                       # no free allowance for this model at all
        if "PerDay" in quota_ids:
            pacific = now - 8 * 3600                     # daily quotas reset at midnight Pacific time
            return (pacific // 86400 + 1) * 86400 + 8 * 3600
        delay = next((d.get("retryDelay") for d in details if d.get("retryDelay")), "60s")
        try:
            return now + max(5.0, float(str(delay).rstrip("s")))
        except ValueError:
            return now + 60

    @staticmethod
    def _wait_text(seconds):
        seconds = max(60, int(seconds))
        if seconds < 3600:
            return f"{seconds // 60 + 1} min"
        return f"{seconds // 3600}h {seconds % 3600 // 60}m"

    def _my_account_type(self):
        me = self._cfg.get("me")
        if not me:
            return None
        p = self.player(me)  # cached for a few minutes
        return None if "error" in p else p.get("accountType")

    def _answer_mode(self):
        mode = self._cfg.get("ask_mode") or "auto"
        return (self._my_account_type() or "regular") if mode == "auto" else mode

    def ask_mode_info(self):
        """For the chat's "playing as" picker: the saved choice and what Auto resolves to."""
        detected = self._my_account_type()
        return {"mode": self._cfg.get("ask_mode") or "auto", "detected": detected,
                "detectedLabel": ACCOUNT_LABELS.get(detected or "", ""), "me": self._cfg.get("me")}

    def set_ask_mode(self, mode):
        if mode in ("auto", "regular", "ironman", "hardcore", "ultimate", "group", "hcgim"):
            self._cfg["ask_mode"] = mode
            save_config(self._cfg)
        return self.ask_mode_info()

    def _player_summary(self):
        me = self._cfg.get("me")
        if not me:
            return ""
        p = self.player(me)  # cached for a few minutes
        if "error" in p:
            return ""
        levels = ", ".join(f"{s['name']} {s['level']}" for s in p["skills"] if s["name"] != "Overall" and s["xp"] >= 0)
        text = f"{p['name']}"
        if p.get("accountType") in ACCOUNT_LABELS:
            text += f" (account type on the hiscores: {ACCOUNT_LABELS[p['accountType']]})"
        text += f". Levels: {levels}."
        if p.get("sync"):
            done = [q for q, v in p["sync"]["quests"].items() if v == 2]
            text += f" Quests completed ({len(done)}): {', '.join(sorted(done))[:3000]}."
        return text

    # ---- bookmarks ----
    def toggle_bookmark(self, title):
        b = self._cfg["bookmarks"]
        self._cfg["bookmarks"] = [t for t in b if t != title] if title in b else b + [title]
        save_config(self._cfg)
        return self.get_state()

    def _remember(self, title):
        recent = [t for t in self._cfg["recent"] if t != title]
        self._cfg["recent"] = [title] + recent[:11]

    # ---- settings ----
    def get_state(self):
        return {
            "version": VERSION,
            "pinned": self._cfg["pinned"],
            "theme": self._cfg["theme"],
            "zoom": self._cfg["zoom"],
            "hotkey": self._cfg["hotkey"],
            "hotkeyOk": self._hotkey_ok,
            "recent": self._cfg["recent"],
            "accounts": self._cfg["accounts"],
            "me": self._cfg["me"],
            "bookmarks": self._cfg["bookmarks"],
            "alerts": self._cfg["alerts"],
            "now": time.time(),
        }

    def set_pref(self, key, value):
        if key == "theme" and value in ("auto", "dark", "light"):
            self._cfg["theme"] = value
        elif key == "zoom":
            self._cfg["zoom"] = max(70, min(160, int(value)))
        elif key == "clear_recent":
            self._cfg["recent"] = []
        save_config(self._cfg)
        return self.get_state()

    # ---- window controls ----
    def toggle_pin(self):
        self._cfg["pinned"] = not self._cfg["pinned"]
        self._window.on_top = self._cfg["pinned"]
        save_config(self._cfg)
        return self._cfg["pinned"]

    def minimize(self):
        self._window.minimize()

    def close(self):
        self._window.destroy()

    def _scale(self):
        try:
            return user32.GetDpiForWindow(self._hwnd) / 96
        except Exception:
            return 1.0

    def set_mini(self, on):
        """Mini mode: a slim always-on-top search strip. Restores the full window when turned off."""
        hwnd = self._hwnd
        if not hwnd:
            return False
        r = wt.RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(r))
        if on and not self._mini:
            self._full_rect = (r.left, r.top, r.right, r.bottom)
            self._mini = True
            self._window.on_top = True
            w = int(440 * self._scale())
            user32.SetWindowPos(hwnd, None, r.left, r.top, w, int(88 * self._scale()), 0x0004 | 0x0010)
        elif not on and self._mini:
            self._mini = False
            self._window.on_top = self._cfg["pinned"]
            left, top, right, bottom = self._full_rect
            # keep the full window where the mini strip was moved to
            user32.SetWindowPos(hwnd, None, r.left, r.top, right - left, bottom - top, 0x0004 | 0x0010)
        return self._mini

    def mini_height(self, css_px):
        if self._mini and self._hwnd:
            r = wt.RECT()
            user32.GetWindowRect(self._hwnd, ctypes.byref(r))
            h = int(max(88, min(640, css_px)) * self._scale())
            user32.SetWindowPos(self._hwnd, None, 0, 0, r.right - r.left, h, 0x0002 | 0x0004 | 0x0010)  # NOMOVE

    def start_drag(self):
        self._track("move")

    def start_resize(self, edge):
        if edge in ("n", "s", "e", "w", "ne", "nw", "se", "sw"):
            self._track(edge)

    def _track(self, mode):
        """Follow the mouse natively until the button is released (smooth move/resize)."""
        hwnd = self._hwnd
        if not hwnd:
            return
        rect = wt.RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(rect))
        start = wt.POINT()
        user32.GetCursorPos(ctypes.byref(start))
        button = 0x02 if user32.GetSystemMetrics(23) else 0x01  # honour swapped mouse buttons
        min_w, min_h = 360, 320
        last = None
        while user32.GetAsyncKeyState(button) & 0x8000:
            p = wt.POINT()
            user32.GetCursorPos(ctypes.byref(p))
            dx, dy = p.x - start.x, p.y - start.y
            l, t, r, b = rect.left, rect.top, rect.right, rect.bottom
            if mode == "move":
                l, r, t, b = l + dx, r + dx, t + dy, b + dy
            else:
                if "w" in mode:
                    l = min(l + dx, r - min_w)
                if "e" in mode:
                    r = max(r + dx, l + min_w)
                if "n" in mode:
                    t = min(t + dy, b - min_h)
                if "s" in mode:
                    b = max(b + dy, t + min_h)
            if (l, t, r, b) != last:
                flags = 0x0004 | 0x0010 | (0x0001 if mode == "move" else 0)  # NOZORDER|NOACTIVATE[|NOSIZE]
                user32.SetWindowPos(hwnd, None, l, t, r - l, b - t, flags)
                last = (l, t, r, b)
            time.sleep(1 / 144)

    # ---- lifecycle (not exposed: leading underscore) ----
    def _on_shown(self):
        try:
            self._hwnd = int(self._window.native.Handle.ToInt64())
        except Exception:
            self._hwnd = user32.FindWindowW(None, APP_NAME)
        try:  # Windows 11: native rounded corners for the frameless window (ignored on Windows 10)
            ctypes.windll.dwmapi.DwmSetWindowAttribute(self._hwnd, 33, ctypes.byref(ctypes.c_int(2)), 4)
        except Exception:
            pass
        rect = self._cfg.get("rect")
        if rect and len(rect) == 4:
            r = wt.RECT(*rect)
            if user32.MonitorFromRect(ctypes.byref(r), 0):  # only restore if still on a monitor
                user32.SetWindowPos(self._hwnd, None, r.left, r.top, r.right - r.left, r.bottom - r.top, 0x0004)
        threading.Thread(target=self._hotkey_loop, daemon=True).start()
        try:
            self._notifier = Notifier(resource_path("ui", "icon.ico"), APP_NAME,
                                      on_check=self._check_alerts, on_click=self._on_tray_click)
            self._sync_tray()
        except Exception:
            self._notifier = None

    def _on_closing(self):
        if self._notifier:
            self._notifier.close()
        if self._mini:
            self.set_mini(False)  # remember the full-size window, not the mini strip
        if self._hwnd and not user32.IsIconic(self._hwnd):
            r = wt.RECT()
            user32.GetWindowRect(self._hwnd, ctypes.byref(r))
            self._cfg["rect"] = [r.left, r.top, r.right, r.bottom]
        save_config(self._cfg)

    def _toggle_visible(self):
        if self._hwnd and user32.IsWindowVisible(self._hwnd) and not user32.IsIconic(self._hwnd) \
                and user32.GetForegroundWindow() == self._hwnd:
            self._window.hide()
        else:
            self._window.show()
            if user32.IsIconic(self._hwnd):
                self._window.restore()
            user32.SetForegroundWindow(self._hwnd)
            self._window.evaluate_js("window.focusSearch && focusSearch()")

    # ---- show/hide hotkey ----
    def _hotkey_spec(self):
        if self._cfg["hotkey"] == "Off":
            return None
        spec = self._cfg.get("hotkey_spec")
        return tuple(spec) if spec else HOTKEYS.get(self._cfg["hotkey"])

    def _hk_command(self, msg):
        """Ask the hotkey thread to re-register (0x8001) or pause (0x8002), and wait until it has."""
        if not self._hotkey_thread_id:
            return
        self._hk_done.clear()
        user32.PostThreadMessageW(self._hotkey_thread_id, msg, 0, 0)
        self._hk_done.wait(1)

    def set_hotkey(self, label, mods, vk):
        mods, vk = int(mods), int(vk)
        if not 0 < vk < 255 or mods & ~0xF:
            return {**self.get_state(), "error": "That key can't be used as a hotkey."}
        # Without Ctrl/Alt/Win only F-keys, Pause, Scroll Lock and Insert are allowed (anything else breaks typing).
        if not mods & (0x1 | 0x2 | 0x8) and not (0x70 <= vk <= 0x87 or vk in (0x13, 0x91, 0x2D)):
            return {**self.get_state(), "error": "Hold Ctrl, Alt or Win as well, so the hotkey doesn't get in the way of typing."}
        old = (self._cfg["hotkey"], self._cfg.get("hotkey_spec"))
        self._cfg["hotkey"], self._cfg["hotkey_spec"] = str(label)[:40], [mods, vk]
        self._hk_command(0x8001)
        if not self._hotkey_ok:
            self._cfg["hotkey"], self._cfg["hotkey_spec"] = old
            self._hk_command(0x8001)
            return {**self.get_state(), "error": f"{label} is already used by Windows or another app. Try a different combination."}
        save_config(self._cfg)
        return self.get_state()

    def clear_hotkey(self):
        self._cfg["hotkey"], self._cfg["hotkey_spec"] = "Off", None
        self._hk_command(0x8001)
        save_config(self._cfg)
        return self.get_state()

    def pause_hotkey(self, paused):
        """Released while the user is recording a new hotkey, so pressing the old one doesn't hide the window."""
        self._hk_command(0x8002 if paused else 0x8001)

    def _hotkey_loop(self):
        self._hotkey_thread_id = kernel32.GetCurrentThreadId()

        def register():
            user32.UnregisterHotKey(None, 1)
            spec = self._hotkey_spec()
            self._hotkey_ok = bool(spec) and bool(user32.RegisterHotKey(None, 1, spec[0] | 0x4000, spec[1]))

        register()
        msg = wt.MSG()
        while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
            if msg.message == 0x0312:  # WM_HOTKEY
                self._toggle_visible()
            elif msg.message == 0x8001:
                register()
                self._hk_done.set()
            elif msg.message == 0x8002:
                user32.UnregisterHotKey(None, 1)
                self._hk_done.set()


def focus_existing_instance():
    hwnd = user32.FindWindowW(None, APP_NAME)
    if hwnd:
        user32.ShowWindow(hwnd, 9)  # SW_RESTORE
        user32.SetForegroundWindow(hwnd)


def main():
    mutex = kernel32.CreateMutexW(None, False, "Local\\OSRSWikiReader.SingleInstance")
    if kernel32.GetLastError() == 183:  # ERROR_ALREADY_EXISTS
        focus_existing_instance()
        return

    cfg = load_config()
    api = Api(cfg)
    window = webview.create_window(
        APP_NAME,
        url=resource_path("ui", "index.html"),
        js_api=api,
        width=520,
        height=780,
        min_size=(300, 80),  # small enough for mini mode; edge-dragging enforces its own minimum
        frameless=True,
        easy_drag=False,
        on_top=cfg["pinned"],
        background_color="#f4f3f1" if cfg["theme"] in ("light", "parchment") else "#121110",
        text_select=True,
    )
    api._window = window
    window.events.shown += api._on_shown
    window.events.closing += api._on_closing

    os.makedirs(CONFIG_DIR, exist_ok=True)
    webview.start(
        gui="edgechromium",
        user_agent=USER_AGENT,
        private_mode=False,  # keep an HTTP cache so images aren't re-downloaded every launch
        storage_path=os.path.join(CONFIG_DIR, "webview"),
        icon=resource_path("ui", "icon.ico"),
    )
    del mutex


if __name__ == "__main__":
    main()
