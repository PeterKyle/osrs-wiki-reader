# Tests

Two kinds of checks, neither of which starts the real app or opens a window.

| What | Runs | Needs |
|---|---|---|
| `test_chats.py` | `app.Api` chat history (save / list / load / delete) against a temp folder | the venv (imports `app.py`) |
| `run_ui.py` | the real `ui/` page in headless Microsoft Edge with a fake `pywebview` API and saved wiki data | Edge (any Python 3.10+, stdlib only) |

## Run

From the repo root:

```
.venv\Scripts\python.exe -m unittest discover tests
.venv\Scripts\python.exe tests\run_ui.py
```

`run_ui.py` options:

```
tests\run_ui.py dock table      only scenarios whose name starts with these
tests\run_ui.py --list          list scenarios
tests\run_ui.py -v              print every scenario's JSON report
tests\run_ui.py -j 1            one Edge at a time (default 4)
tests\run_ui.py --build         only build tests\ui\harness.html and print its file:// URL,
                                then open it in a browser with ?mode=<scenario> to poke at it by hand
```

Each scenario prints `PASS` or `FAIL` (with the mismatched values and its report) and saves a screenshot to
`tests\out\<name>.png`; the exit code is non-zero if anything failed. Look at the screenshots after UI changes:
the checks catch broken behaviour, not every visual regression. Set `EDGE_PATH` if Edge isn't in the usual place.

`test_chats.py` patches `app.CONFIG_DIR` / `app.CHATS_FILE` to a temp dir, so your real `%APPDATA%` chats are
never touched.

## How the UI harness works

- `run_ui.py` builds `tests\ui\harness.html` (gitignored) from the **real** `ui\index.html`: asset paths are pointed
  at `..\..\ui\`, and these scripts are injected before the app's own scripts:
  - `ui\fixtures\*.js`: saved data (wiki pages, hiscores/WikiSync data, GE prices, quest list).
  - `ui\mock_api.js`: a fake `window.pywebview.api` with every method `app.py` exposes, answered from the
    fixtures, plus in-memory chat history. A method the UI calls that the fake doesn't have is reported as an error.
  - `ui\scenarios.js`: reads `?mode=` and drives the UI (open a page, click buttons, send chat messages), then
    writes a JSON summary into `document.title`.
- Edge runs once per scenario: `msedge --headless=new --window-size=W,H --virtual-time-budget=6000
  --screenshot=... --dump-dom`, in a throwaway profile. Virtual time fast-forwards timers, so a run takes ~2 s.
  The runner reads the title from the dumped DOM and compares it with the scenario's `expect` values.
- Every summary has `mode`, `view` (home / article / char / error), `page`, `askOpen`, `docked`, `width` and
  `errors` (uncaught errors, rejected promises, `console.error`); every scenario expects `errors == []`.
- The viewport is about 24 px narrower than `--window-size` (e.g. 1500 gives `innerWidth` 1476).
- Wiki images load from oldschool.runescape.wiki, so screenshots offline show broken images; the checks still pass.

## Scenarios

| Name | Size | Checks |
|---|---|---|
| `home`, `home_light` | 1100×900 | home view, 10 quick links, bookmarks shown (`home_light`: light theme, screenshot only) |
| `article` | 1100×900 | Abyssal whip opens: heading, infobox, tables wrapped |
| `settings` | 1100×900 | settings open; both hotkey rows (show/hide, Wise Old Man) render with their keys |
| `hotkey` | 1100×900 | recording Ctrl+Alt+K as the show/hide hotkey |
| `dock_wide` | 1500×1000 | chat docked beside the page (page's right edge = chat's left edge), 2 messages |
| `dock_narrow` | 640×1000 | too narrow to share: chat floats over the page |
| `table` | 1118×1000 | Optimal quest guide with the chat docked: page column < 820 px, so tables use the compact style (8 px cell padding) |
| `table_wide` | 1500×1000 | same table without the chat: normal style (12 px padding) |
| `hist_menu` | 1500×1000 | 2 questions, Ctrl+N (fresh chat starts with "Greetings"), 1 question, history menu lists 2 chats newest first |
| `hist_load` | 1500×1000 | as above, then opening the older chat brings back its 4 messages |
| `ask` | 1100×900 | a question and its answer in the chat |
| `typing` | 1100×900 | Backspace and / typed in the chat box aren't swallowed by page shortcuts, also after sending |
| `char`, `compare` | 1100×900 | character page / two-account comparison render |
| `quest` | 1100×900 | Dragon Slayer II: requirement banner above the quest details |
| `diary` | 1100×900 | Ardougne Diary: per-tier progress notes |
| `methods` | 1100×900 | Agility: the XP calculator's training-methods list loads |
| `hotkey_bad` | 1100×900 | a plain letter as a global hotkey is refused with a hint |
| `setup` | 1100×900 | no Gemini key: the chat shows the key set-up instead of the input |
| `menu` | 1100×900 | "playing as" menu: picking Ultimate ironman updates the label |
| `ctxsel` | 1100×900 | selecting a paragraph shows the "Ask about this" button |
| `ctxsend` | 1100×900 | asking about a selection sends the page title and the selected text with the question |
| `guide` | 1100×900 | first launch: the quick guide opens by itself |
| `mini` | 520×700 | mini mode with a page preview (screenshot only) |
| `update` | 1100×900 | update pop-up appears when an update is available |

`scenarios.js` has a few more modes without a runner entry (`alert`, `quests`, `updprog`, `ctxpage`); add an entry
to use one, or open them with `--build`.
Useful query params: `theme=light`, `p=<page title>` (article/table), `w=<chat width>` (dock), `nochat=1` (table).

## Add a scenario

1. In `ui\scenarios.js` add an async function to `S`, named after the mode. Use the app's globals (`openPage`,
   `els`, `chat`, `send`, `updateDock`, ...), `await wait(ms)` between steps, and `return` any values to check.
2. In `run_ui.py` add an entry to `SCENARIOS`:
   `dict(name="my_case", mode="mymode", size=(1100, 900), params={"p": "Abyssal whip"}, expect={"view": "article", "myValue": 3})`.
   An expected value can be a function: `at_least(1)`, `starts("Greet")`, or `lambda v, report: ...`.
   Add `budget=9000` if it needs more than 6 s of (virtual) time.
3. Run `tests\run_ui.py my_case -v` and look at `tests\out\my_case.png`.

A page the scenario opens needs a fixture: add `ui\fixtures\page_<name>.js` in the same form as the others
(`window.__PAGES = Object.assign(window.__PAGES || {}, {"Title": {"title": ..., "html": ...}})`, the `html` being
what `Api.page` returns). Trim it to the parts you need; keep `tests\` under ~1.5 MB.

## Fixture licence

The wiki page content in `ui\fixtures\page_*.js` (and item, quest and skill data in the other fixtures) comes from
the [Old School RuneScape Wiki](https://oldschool.runescape.wiki) and is licensed
[CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/). The pages are trimmed copies (navboxes,
comments and later sections removed; the Optimal quest guide table cut to its first 40 quests).
