# OSRS Wiki Reader

A small, fast desktop window for the [Old School RuneScape Wiki](https://oldschool.runescape.wiki), for looking things up while you play without opening a browser.

**[Download the latest version](../../releases/latest)**: grab `OSRS.Wiki.Reader.exe` and double-click it. Nothing to install. It updates itself when a new version comes out.

> Windows may say "Windows protected your PC" the first time, because the app isn't code-signed. Click **More info → Run anyway**.

## What it does

- **Wiki reader**: clean dark or parchment theme, search with autocomplete, find on page (Ctrl+F), bookmarks, history.
- **Show/hide hotkey** you can set to any combination (Ctrl+Alt+W by default), a **pin** to keep it above the game, and a **mini mode** search strip.
- **Character tab**: look up any account's levels, boss kills and clues (official hiscores), weekly gains (Wise Old Man), and quests/diaries (WikiSync). Compare two accounts side by side.
- **Requirement checks**: set your account and quest, diary and guide pages tick off what you meet. The Character tab lists quests you can start now.
- **Grand Exchange**: live prices and a price chart on item pages, a watchlist, and price alerts as Windows notifications.
- **XP calculator** on skill pages, with training methods from the wiki.
- **Farm run timers** with notifications when your crops are ready.

Quest and diary progress needs the free **WikiSync** plugin enabled in RuneLite.

## Building from source

Windows 10/11 with Python 3.10+:

```powershell
powershell -ExecutionPolicy Bypass -File build.ps1
```

This creates `dist\OSRS Wiki Reader.exe`. The UI lives in `ui/` (plain HTML/CSS/JS rendered with WebView2 via [pywebview](https://pywebview.flowrl.com/)); `app.py` handles the wiki, hiscores and prices APIs.

## Credits

Unofficial fan project, not affiliated with Jagex or the OSRS Wiki.
Wiki content is licensed [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/). Prices from the [OSRS Wiki Real-time Prices API](https://prices.runescape.wiki), player data from the official hiscores, [Wise Old Man](https://wiseoldman.net) and WikiSync.
