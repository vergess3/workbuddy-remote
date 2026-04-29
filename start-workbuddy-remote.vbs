Option Explicit

Dim fso
Dim shell
Dim scriptDir
Dim psScript
Dim command

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
psScript = fso.BuildPath(scriptDir, "tools\start-workbuddy-remote.ps1")

If Not fso.FileExists(psScript) Then
    MsgBox "Startup script not found:" & vbCrLf & psScript, vbCritical, "WorkBuddy Remote"
    WScript.Quit 1
End If

command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File " & Chr(34) & psScript & Chr(34) & " -OpenBrowser"
shell.Run command, 0, False
