"""OSRS Wiki Reader - a lightweight desktop reader for the Old School RuneScape Wiki.

Unofficial fan project. Article content comes from https://oldschool.runescape.wiki
(CC BY-NC-SA 3.0) via the public MediaWiki API.
"""

import ctypes
import ctypes.wintypes as wt
import gzip
import hashlib
import json
import os
import re
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
VERSION = "1.2.0"
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

HOTKEYS = {  # label -> (modifiers, virtual key)
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
    "hotkey": "Ctrl+Alt+W",
    "recent": [],
    "accounts": [],  # saved RSNs
    "me": None,      # the RSN used for quest requirement checks
    "watchlist": [],  # GE item ids
    "bookmarks": [],  # page titles
    "alerts": [],     # [{"id", "name", "dir": "above"|"below", "price"}]
    "timers": [],     # [{"id", "label", "minutes", "ends" (epoch s), "notified"}]
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


def http_json(url, method="GET"):
    """Returns (status, parsed JSON or None). Network failures raise."""
    req = urllib.request.Request(url, method=method,
                                 headers={"User-Agent": USER_AGENT, "Accept-Encoding": "gzip"})
    try:
        resp = urllib.request.urlopen(req, timeout=15)
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
        self._last_price_check = 0
        self._mini = False
        self._full_rect = None
        self._pool = ThreadPoolExecutor(max_workers=3)
        self._hotkey_thread_id = None
        self._hotkey_ok = False

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

        result = {
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

    def watchlist(self):
        ids = self._cfg["watchlist"]
        if not ids:
            return []
        try:
            by_id = self._items()["_by_id"]
            latest = self._get_timed(f"{PRICES}/latest", 60)["data"]
            day = self._get_timed(f"{PRICES}/24h", 300)["data"]
        except Exception as e:
            return {"error": f"Couldn't load GE prices ({e.__class__.__name__})."}
        return [self._item_summary(by_id[i], latest, day) for i in ids if i in by_id]

    def toggle_watch(self, item_id):
        item_id = int(item_id)
        w = self._cfg["watchlist"]
        self._cfg["watchlist"] = [i for i in w if i != item_id] if item_id in w else w + [item_id]
        if item_id not in self._cfg["watchlist"]:
            self._cfg["alerts"] = [a for a in self._cfg["alerts"] if a["id"] != item_id]
            self._sync_tray()
        save_config(self._cfg)
        return item_id in self._cfg["watchlist"]

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
        if item_id not in self._cfg["watchlist"]:
            self._cfg["watchlist"].append(item_id)
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
        t = sum(1 for x in self._cfg["timers"] if not x.get("notified"))
        parts = []
        if n:
            parts.append(f"{n} price alert{'s' if n != 1 else ''}")
        if t:
            parts.append(f"{t} timer{'s' if t != 1 else ''}")
        if parts:
            self._notifier.show(f"{APP_NAME}: {' and '.join(parts)}")
        else:
            self._notifier.hide()

    # ---- farm run timers ----
    def add_timer(self, label, minutes):
        minutes = float(minutes)
        label = (label or "Timer").strip()[:40]
        if not 0 < minutes <= 14 * 24 * 60:
            return self.get_state()
        timer = {"id": int(time.time() * 1000), "label": label, "minutes": minutes,
                 "ends": time.time() + minutes * 60, "notified": False}
        self._cfg["timers"] = (self._cfg["timers"] + [timer])[-20:]
        save_config(self._cfg)
        self._sync_tray()
        return self.get_state()

    def remove_timer(self, timer_id):
        self._cfg["timers"] = [t for t in self._cfg["timers"] if t["id"] != timer_id]
        save_config(self._cfg)
        self._sync_tray()
        return self.get_state()

    def restart_timer(self, timer_id):
        for t in self._cfg["timers"]:
            if t["id"] == timer_id:
                t["ends"] = time.time() + t["minutes"] * 60
                t["notified"] = False
        save_config(self._cfg)
        self._sync_tray()
        return self.get_state()

    def _check_timers(self):
        due = [t for t in self._cfg["timers"] if not t.get("notified") and t["ends"] <= time.time()]
        if not due:
            return
        for t in due:
            t["notified"] = True
            self._notifier.notify(f"{t['label']} ready!", "Your farm run timer is done. Time to go harvest.", None)
        save_config(self._cfg)
        try:
            self._window.evaluate_js(f"window.onTimersDone && onTimersDone({json.dumps([t['id'] for t in due])})")
        except Exception:
            pass

    def _tick(self):
        """Called by the notifier every 30 s while anything is pending."""
        self._check_timers()
        if time.time() - self._last_price_check >= 290:
            self._last_price_check = time.time()
            self._check_alerts()

    def _check_alerts(self):
        """Checks price alerts (every ~5 minutes, from _tick)."""
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
        # Leave the tray icon up even if nothing else is pending: removing it would also delete the notification.
        if self._cfg["alerts"] or any(not t.get("notified") for t in self._cfg["timers"]):
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

        # A one-file PyInstaller exe runs as two processes (bootloader + app); both lock the file.
        pids = [os.getpid(), os.getppid()]
        script = os.path.join(os.environ.get("TEMP", CONFIG_DIR), "osrs-wiki-reader-update.cmd")
        waits = "\n".join(f':wait{i}\ntasklist /FI "PID eq {p}" 2>nul | find "{p}" >nul && (timeout /t 1 /nobreak >nul & goto wait{i})'
                          for i, p in enumerate(pids))
        with open(script, "w", encoding="mbcs") as f:
            f.write(f'@echo off\n{waits}\nset tries=0\n:move\nmove /y "{new}" "{exe}" >nul 2>&1 && goto done\n'
                    f'set /a tries+=1\nif %tries% lss 30 (timeout /t 1 /nobreak >nul & goto move)\n'
                    f':done\nstart "" "{exe}"\ndel "%~f0"\n')
        subprocess.Popen(["cmd", "/c", script], creationflags=0x08000000 | 0x00000008, close_fds=True)  # no window, detached
        threading.Timer(0.5, self._window.destroy).start()
        return {"ok": True}

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
            "hotkeys": list(HOTKEYS),
            "recent": self._cfg["recent"],
            "accounts": self._cfg["accounts"],
            "me": self._cfg["me"],
            "watchlist": self._cfg["watchlist"],
            "bookmarks": self._cfg["bookmarks"],
            "alerts": self._cfg["alerts"],
            "timers": self._cfg["timers"],
            "now": time.time(),
        }

    def set_pref(self, key, value):
        if key == "theme" and value in ("dark", "parchment"):
            self._cfg["theme"] = value
        elif key == "zoom":
            self._cfg["zoom"] = max(70, min(160, int(value)))
        elif key == "hotkey" and value in HOTKEYS:
            self._cfg["hotkey"] = value
            if self._hotkey_thread_id:
                user32.PostThreadMessageW(self._hotkey_thread_id, 0x8001, 0, 0)  # WM_APP+1: re-register
                time.sleep(0.15)
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
        rect = self._cfg.get("rect")
        if rect and len(rect) == 4:
            r = wt.RECT(*rect)
            if user32.MonitorFromRect(ctypes.byref(r), 0):  # only restore if still on a monitor
                user32.SetWindowPos(self._hwnd, None, r.left, r.top, r.right - r.left, r.bottom - r.top, 0x0004)
        threading.Thread(target=self._hotkey_loop, daemon=True).start()
        try:
            self._notifier = Notifier(resource_path("ui", "icon.ico"), APP_NAME,
                                      on_check=self._tick, on_click=self._on_tray_click, interval_ms=30_000)
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

    def _hotkey_loop(self):
        self._hotkey_thread_id = kernel32.GetCurrentThreadId()

        def register():
            user32.UnregisterHotKey(None, 1)
            spec = HOTKEYS.get(self._cfg["hotkey"])
            self._hotkey_ok = bool(spec) and bool(user32.RegisterHotKey(None, 1, spec[0] | 0x4000, spec[1]))

        register()
        msg = wt.MSG()
        while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
            if msg.message == 0x0312:  # WM_HOTKEY
                self._toggle_visible()
            elif msg.message == 0x8001:
                register()


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
        background_color="#16120e" if cfg["theme"] == "dark" else "#efe3c6",
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
