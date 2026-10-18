// Gives the frameless pywebview window a normal window's style (sizable, minimize/maximize) while keeping
// the frame itself invisible, so Windows treats it like any other app: Snap Assist, Win+Arrow keys, native
// shadow and animations. Written in C# (not a Python ctypes callback) on purpose: the window procedure runs on
// the UI thread, and a Python one would need the GIL there, which deadlocks when another Python thread holds
// the GIL while waiting on the UI thread (e.g. pywebview setting Form.TopMost from a worker thread).
//
// Built by build.ps1:  csc /target:library /out:framehook\FrameHook.dll framehook\FrameHook.cs
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace OsrsWikiReader
{
    public sealed class FrameHook : NativeWindow
    {
        // WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX
        const int Style = 0x00C00000 | 0x00040000 | 0x00080000 | 0x00020000 | 0x00010000;

        [StructLayout(LayoutKind.Sequential)]
        struct RECT { public int Left, Top, Right, Bottom; }

        [StructLayout(LayoutKind.Sequential)]
        struct MONITORINFO { public int Size; public RECT Monitor, Work; public uint Flags; }

        [StructLayout(LayoutKind.Sequential)]
        struct STYLESTRUCT { public int StyleOld, StyleNew; }

        [StructLayout(LayoutKind.Sequential)]
        struct POINT { public int X, Y; }

        // Posted by Python (any thread) when the title bar is pressed: hand the drag to Windows.
        public const int WM_START_DRAG = 0x8000 + 0x51;   // WM_APP + 0x51

        // How many times Windows has started moving/sizing the window; Python watches it to confirm a drag took.
        public volatile int MoveLoops;

        [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr hwnd);
        [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
        [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
        [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);
        [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] static extern IntPtr SetWindowLongPtr(IntPtr hwnd, int index, IntPtr value);
        [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
        [DllImport("user32.dll")] static extern bool ReleaseCapture();
        [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
        [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam);

        // Memory saving while hidden or minimized: WebView2's "low" memory target makes the engine drop caches
        // and graphics buffers; back to normal the moment the window is shown again. No cost while visible.
        object webView;   // the WinForms WebView2 control (looked up by reflection: no compile-time dependency)
        bool lowMemory;
        bool refocus;     // we hid the web view, so give it keyboard focus back when the window is activated
        // 0 = off, 1 = low memory target, 2 = also tell WebView2 it's invisible (frees graphics buffers),
        // 3 = also suspend the page (like Edge's sleeping tabs; resumes when shown)
        public int SaveMemoryLevel = 3;

        public void TrackWebView(object webViewControl) { webView = webViewControl; }

        void SetLowMemory(bool low)
        {
            if (low == lowMemory || webView == null || (low && SaveMemoryLevel == 0)) return;
            lowMemory = low;
            try
            {
                object core = webView.GetType().GetProperty("CoreWebView2").GetValue(webView, null);
                if (core == null) return;
                if (!low || SaveMemoryLevel >= 2)
                {
                    var control = webView as Control;   // showing it again resumes a suspended page too
                    if (control != null)
                    {
                        control.Visible = !low;
                        if (low) refocus = true;
                    }
                }
                var level = core.GetType().GetProperty("MemoryUsageTargetLevel");
                if (level != null)   // older WebView2 runtimes don't have it
                    level.SetValue(core, Enum.ToObject(level.PropertyType, low ? 1 : 0), null);   // Low = 1, Normal = 0
                if (low && SaveMemoryLevel >= 3)
                {
                    var suspend = core.GetType().GetMethod("TrySuspendAsync");
                    if (suspend != null) suspend.Invoke(core, null);
                }
            }
            catch (Exception) { }
        }

        public FrameHook(IntPtr hwnd)
        {
            AssignHandle(hwnd);
            long style = GetWindowLongPtr(hwnd, -16).ToInt64();   // GWL_STYLE
            SetWindowLongPtr(hwnd, -16, new IntPtr(style | Style));
            // FRAMECHANGED (re-run WM_NCCALCSIZE) | NOMOVE | NOSIZE | NOZORDER | NOACTIVATE
            SetWindowPos(hwnd, IntPtr.Zero, 0, 0, 0, 0, 0x0020 | 0x0002 | 0x0001 | 0x0004 | 0x0010);
        }

        protected override void WndProc(ref Message m)
        {
            switch (m.Msg)
            {
                case WM_START_DRAG:
                    // Act as if the press landed on a real title bar: Windows runs its own move loop, which brings
                    // Snap Layouts (the bar at the top of the screen), edge snapping and Snap Assist.
                    ReleaseCapture();
                    POINT p;
                    GetCursorPos(out p);
                    PostMessage(m.HWnd, 0x00A1, new IntPtr(2), new IntPtr((p.Y << 16) | (p.X & 0xFFFF)));   // WM_NCLBUTTONDOWN, HTCAPTION
                    return;
                case 0x0083:   // WM_NCCALCSIZE: the whole window is client area (no visible frame)
                    if (m.WParam != IntPtr.Zero)
                    {
                        if (IsZoomed(m.HWnd))
                        {
                            // Windows maximizes framed windows a few pixels past the screen edges (the hidden
                            // border); keep the content to the visible work area so nothing gets cut off.
                            var mi = new MONITORINFO { Size = Marshal.SizeOf(typeof(MONITORINFO)) };
                            if (GetMonitorInfo(MonitorFromWindow(m.HWnd, 2), ref mi))
                                Marshal.StructureToPtr(mi.Work, m.LParam, false);   // NCCALCSIZE_PARAMS.rgrc[0]
                        }
                        m.Result = IntPtr.Zero;
                        return;
                    }
                    break;
                case 0x0018:   // WM_SHOWWINDOW: hidden (hotkey / tray) or shown again
                    SetLowMemory(m.WParam == IntPtr.Zero);
                    break;
                case 0x0005:   // WM_SIZE: 1 = minimized; 0 / 2 = restored / maximized
                    long kind = m.WParam.ToInt64();
                    if (kind == 1) SetLowMemory(true);
                    else if (kind == 0 || kind == 2) SetLowMemory(false);
                    break;
                case 0x0006:   // WM_ACTIVATE: typing should go straight to the page after it was hidden
                    base.WndProc(ref m);
                    if (refocus && (m.WParam.ToInt64() & 0xFFFF) != 0)
                    {
                        refocus = false;
                        var c = webView as Control;
                        if (c != null && c.Visible && !c.ContainsFocus) c.Focus();
                    }
                    return;
                case 0x0231:   // WM_ENTERSIZEMOVE
                    MoveLoops++;
                    break;
                case 0x0086:   // WM_NCACTIVATE: lParam -1 = don't paint a frame on focus changes
                    m.LParam = new IntPtr(-1);
                    break;
                case 0x007C:   // WM_STYLECHANGING: keep the frame style if WinForms rewrites it
                    if ((int)m.WParam.ToInt64() == -16)
                    {
                        var ss = (STYLESTRUCT)Marshal.PtrToStructure(m.LParam, typeof(STYLESTRUCT));
                        ss.StyleNew |= Style;
                        Marshal.StructureToPtr(ss, m.LParam, false);
                    }
                    break;
            }
            base.WndProc(ref m);
        }
    }
}
