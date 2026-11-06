# Lists the top-level windows of one process (position, visible, always-on-top) as JSON.
# It reads window properties only. It does not capture the screen or any window contents.
param([int]$ProcessId)
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class W {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public static List<string> ForPid(uint pid) {
    var found = new List<string>();
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p != pid) return true;
      RECT r; GetWindowRect(h, out r);
      var sb = new StringBuilder(256); GetWindowText(h, sb, 256);
      int ex = GetWindowLong(h, -20);
      found.Add(String.Format("{{\"title\":{0},\"visible\":{1},\"minimized\":{2},\"x\":{3},\"y\":{4},\"w\":{5},\"h\":{6},\"topmost\":{7},\"toolwindow\":{8}}}",
        "\"" + sb.ToString().Replace("\\", "\\\\").Replace("\"", "'") + "\"",
        IsWindowVisible(h) ? "true" : "false", IsIconic(h) ? "true" : "false", r.L, r.T, r.R - r.L, r.B - r.T,
        (ex & 0x8) != 0 ? "true" : "false", (ex & 0x80) != 0 ? "true" : "false"));
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
$wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$list = [W]::ForPid([uint32]$ProcessId) -join ','
Write-Output ('{"work":{"x":' + $wa.X + ',"y":' + $wa.Y + ',"w":' + $wa.Width + ',"h":' + $wa.Height + '},"windows":[' + $list + ']}')
