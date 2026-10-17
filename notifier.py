"""Tray icon + Windows notifications for price alerts, using the plain Win32 notification-area API.

Runs its own thread with a hidden message-only window, which receives tray clicks and a check timer.
"""

import ctypes
import ctypes.wintypes as wt
import threading

user32 = ctypes.windll.user32
shell32 = ctypes.windll.shell32
kernel32 = ctypes.windll.kernel32

LRESULT = ctypes.c_ssize_t
WNDPROC = ctypes.WINFUNCTYPE(LRESULT, wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM)

user32.DefWindowProcW.argtypes = [wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM]
user32.DefWindowProcW.restype = LRESULT
user32.CreateWindowExW.argtypes = [wt.DWORD, wt.LPCWSTR, wt.LPCWSTR, wt.DWORD, ctypes.c_int, ctypes.c_int,
                                   ctypes.c_int, ctypes.c_int, wt.HWND, wt.HMENU, wt.HINSTANCE, wt.LPVOID]
user32.CreateWindowExW.restype = wt.HWND
user32.LoadImageW.argtypes = [wt.HINSTANCE, wt.LPCWSTR, wt.UINT, ctypes.c_int, ctypes.c_int, wt.UINT]
user32.LoadImageW.restype = wt.HANDLE
user32.SetTimer.argtypes = [wt.HWND, ctypes.c_size_t, wt.UINT, wt.LPVOID]
user32.KillTimer.argtypes = [wt.HWND, ctypes.c_size_t]
user32.PostMessageW.argtypes = [wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM]
kernel32.GetModuleHandleW.restype = wt.HMODULE


class WNDCLASSW(ctypes.Structure):
    _fields_ = [("style", wt.UINT), ("lpfnWndProc", WNDPROC), ("cbClsExtra", ctypes.c_int),
                ("cbWndExtra", ctypes.c_int), ("hInstance", wt.HINSTANCE), ("hIcon", wt.HICON),
                ("hCursor", wt.HANDLE), ("hbrBackground", wt.HBRUSH), ("lpszMenuName", wt.LPCWSTR),
                ("lpszClassName", wt.LPCWSTR)]


class NOTIFYICONDATAW(ctypes.Structure):
    _fields_ = [("cbSize", wt.DWORD), ("hWnd", wt.HWND), ("uID", wt.UINT), ("uFlags", wt.UINT),
                ("uCallbackMessage", wt.UINT), ("hIcon", wt.HICON), ("szTip", wt.WCHAR * 128),
                ("dwState", wt.DWORD), ("dwStateMask", wt.DWORD), ("szInfo", wt.WCHAR * 256),
                ("uVersion", wt.UINT), ("szInfoTitle", wt.WCHAR * 64), ("dwInfoFlags", wt.DWORD),
                ("guidItem", ctypes.c_byte * 16), ("hBalloonIcon", wt.HICON)]


shell32.Shell_NotifyIconW.argtypes = [wt.DWORD, ctypes.POINTER(NOTIFYICONDATAW)]

NIM_ADD, NIM_MODIFY, NIM_DELETE, NIM_SETVERSION = 0, 1, 2, 4
NIF_MESSAGE, NIF_ICON, NIF_TIP, NIF_INFO = 0x1, 0x2, 0x4, 0x10
NIIF_USER, NIIF_LARGE_ICON = 0x4, 0x20
WM_TIMER, WM_LBUTTONUP, WM_APP = 0x0113, 0x0202, 0x8000
WM_TRAY, WM_CMD = WM_APP + 2, WM_APP + 3
NIN_BALLOONUSERCLICK = 0x0405
HWND_MESSAGE = wt.HWND(-3)


class Notifier:
    """on_check() runs on a timer while the tray icon is shown; on_click(payload) runs when the
    tray icon or a notification is clicked (payload = whatever was passed to notify())."""

    def __init__(self, icon_path, tooltip, on_check, on_click, interval_ms=300_000):
        self._icon_path = icon_path
        self._tooltip = tooltip
        self._on_check = on_check
        self._on_click = on_click
        self._interval = interval_ms
        self._hwnd = None
        self._shown = False
        self._payload = None
        self._pending = []  # ("show", tip) | ("hide",) | ("notify", title, text, payload)
        self._lock = threading.Lock()
        self._ready = threading.Event()
        threading.Thread(target=self._run, daemon=True).start()
        self._ready.wait(5)

    # ---- thread-safe public API ----
    def show(self, tooltip):
        self._post(("show", tooltip))

    def hide(self):
        self._post(("hide",))

    def notify(self, title, text, payload=None):
        self._post(("notify", title, text, payload))

    def close(self):
        """Remove the tray icon immediately (safe from any thread; used at exit)."""
        if self._shown and self._hwnd:
            shell32.Shell_NotifyIconW(NIM_DELETE, ctypes.byref(self._nid()))
            self._shown = False

    def _post(self, cmd):
        with self._lock:
            self._pending.append(cmd)
        if self._hwnd:
            user32.PostMessageW(self._hwnd, WM_CMD, 0, 0)

    # ---- window thread ----
    def _nid(self, flags=0):
        nid = NOTIFYICONDATAW()
        nid.cbSize = ctypes.sizeof(NOTIFYICONDATAW)
        nid.hWnd = self._hwnd
        nid.uID = 1
        nid.uFlags = flags
        return nid

    def _run(self):
        hinst = kernel32.GetModuleHandleW(None)
        self._proc = WNDPROC(self._wndproc)  # keep a reference
        wc = WNDCLASSW()
        wc.lpfnWndProc = self._proc
        wc.hInstance = hinst
        wc.lpszClassName = "OSRSWikiReaderNotifier"
        user32.RegisterClassW(ctypes.byref(wc))
        self._hwnd = user32.CreateWindowExW(0, wc.lpszClassName, "OSRS Wiki Reader notifier", 0,
                                            0, 0, 0, 0, HWND_MESSAGE, None, hinst, None)
        self._icon = user32.LoadImageW(None, self._icon_path, 1, 0, 0, 0x10 | 0x40)  # IMAGE_ICON, LOADFROMFILE|DEFAULTSIZE
        self._ready.set()
        msg = wt.MSG()
        while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
            user32.TranslateMessage(ctypes.byref(msg))
            user32.DispatchMessageW(ctypes.byref(msg))

    def _set_tray(self, tooltip):
        nid = self._nid(NIF_MESSAGE | NIF_ICON | NIF_TIP)
        nid.uCallbackMessage = WM_TRAY
        nid.hIcon = self._icon
        nid.szTip = tooltip[:127]
        if not self._shown:
            shell32.Shell_NotifyIconW(NIM_ADD, ctypes.byref(nid))
            nid.uVersion = 4
            shell32.Shell_NotifyIconW(NIM_SETVERSION, ctypes.byref(nid))
            self._shown = True
            user32.SetTimer(self._hwnd, 1, self._interval, None)
            user32.SetTimer(self._hwnd, 2, 20_000, None)  # one early check shortly after start
        else:
            shell32.Shell_NotifyIconW(NIM_MODIFY, ctypes.byref(nid))

    def _handle_commands(self):
        with self._lock:
            cmds, self._pending = self._pending, []
        for cmd in cmds:
            if cmd[0] == "show":
                self._set_tray(cmd[1])
            elif cmd[0] == "hide" and self._shown:
                shell32.Shell_NotifyIconW(NIM_DELETE, ctypes.byref(self._nid()))
                user32.KillTimer(self._hwnd, 1)
                user32.KillTimer(self._hwnd, 2)
                self._shown = False
            elif cmd[0] == "notify":
                _, title, text, payload = cmd
                if not self._shown:
                    self._set_tray(self._tooltip)
                self._payload = payload
                nid = self._nid(NIF_INFO)
                nid.szInfoTitle = title[:63]
                nid.szInfo = text[:255]
                nid.dwInfoFlags = NIIF_USER | NIIF_LARGE_ICON
                nid.hBalloonIcon = self._icon
                shell32.Shell_NotifyIconW(NIM_MODIFY, ctypes.byref(nid))

    def _wndproc(self, hwnd, msg, wparam, lparam):
        try:
            if msg == WM_CMD:
                self._handle_commands()
                return 0
            if msg == WM_TIMER:
                if wparam == 2:
                    user32.KillTimer(hwnd, 2)
                threading.Thread(target=self._on_check, daemon=True).start()
                return 0
            if msg == WM_TRAY:
                event = lparam & 0xFFFF
                if event == WM_LBUTTONUP:
                    threading.Thread(target=self._on_click, args=(None,), daemon=True).start()
                elif event == NIN_BALLOONUSERCLICK:
                    threading.Thread(target=self._on_click, args=(self._payload,), daemon=True).start()
                return 0
        except Exception:
            pass
        return user32.DefWindowProcW(hwnd, msg, wparam, lparam)
