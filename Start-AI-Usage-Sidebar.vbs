Option Explicit
Dim shell, files, root, executable
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(WScript.ScriptFullName)
executable = root & "\node_modules\electron\dist\electron.exe"
If Not files.FileExists(executable) Then
  MsgBox "Run npm ci and npm run build in the AI Usage Tracker folder first.", vbExclamation, "AI Usage Tracker"
Else
  shell.CurrentDirectory = root
  shell.Run Chr(34) & executable & Chr(34) & " " & Chr(34) & root & "\desktop\main.cjs" & Chr(34), 1, False
End If
