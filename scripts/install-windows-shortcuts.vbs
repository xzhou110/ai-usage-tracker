Option Explicit
Dim shell, files, root, executable, entryPoint, arguments, folders, folder, path, shortcut
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(files.GetParentFolderName(WScript.ScriptFullName))
executable = root & "\node_modules\electron\dist\electron.exe"
entryPoint = root & "\desktop\main.cjs"
arguments = Chr(34) & entryPoint & Chr(34)
If Not files.FileExists(executable) Or Not files.FileExists(entryPoint) Or Not files.FileExists(root & "\dist\index.html") Then
  Fail "Complete dependency setup and npm run build before installing shortcuts."
End If
folders = Array(shell.SpecialFolders("Programs"), shell.SpecialFolders("Desktop"))

' Validate both destinations first. Preserve unrelated same-named shortcuts.
For Each folder In folders
  If Len(folder) = 0 Or Not files.FolderExists(folder) Then Fail "Windows shortcut folder is unavailable."
  path = folder & "\AI Usage Tracker.lnk"
  If files.FileExists(path) Then
    Set shortcut = shell.CreateShortcut(path)
    If StrComp(shortcut.TargetPath, executable, vbTextCompare) <> 0 Or StrComp(shortcut.Arguments, arguments, vbTextCompare) <> 0 Then
      Fail "An unrelated shortcut already exists at " & path & ". It was not changed."
    End If
  End If
Next

For Each folder In folders
  path = folder & "\AI Usage Tracker.lnk"
  Set shortcut = shell.CreateShortcut(path)
  shortcut.TargetPath = executable
  shortcut.Arguments = arguments
  shortcut.WorkingDirectory = root
  shortcut.Description = "Open the private AI usage sidebar for Claude, Codex, and Cursor."
  shortcut.IconLocation = executable & ",0"
  shortcut.WindowStyle = 1
  shortcut.Save
  Set shortcut = shell.CreateShortcut(path)
  If StrComp(shortcut.TargetPath, executable, vbTextCompare) <> 0 Or StrComp(shortcut.Arguments, arguments, vbTextCompare) <> 0 Or StrComp(shortcut.WorkingDirectory, root, vbTextCompare) <> 0 Then
    Fail "Shortcut verification failed: " & path
  End If
Next
WScript.Echo "AI Usage Tracker is now available in Windows Start and on your Desktop."

Sub Fail(message)
  WScript.Echo message
  WScript.Quit 1
End Sub
