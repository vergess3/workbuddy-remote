Option Explicit

Dim fso
Dim shell
Dim scriptDir
Dim psScript
Dim command
Dim oShell

Set oShell = CreateObject("WScript.Shell")

' 1. Kill ALL existing WorkBuddy processes system-wide
oShell.Run "taskkill /F /IM workbuddy*.exe /T 2>nul", 0, True
WScript.Sleep 500

' 2. WMIC method as backup
oShell.Run "wmic process where ""name like 'wcorkbuddy%'"" delete 2>nul", 0, True
WScript.Sleep 500

' 3. PowerShell force kill
oShell.Run "powershell -WindowStyle Hidden -Command ""Get-Process | Where-Object {$_.Name -like '*workbuddy*'} | Stop-Process -Force -ErrorAction SilentlyContinue""", 0, True
WScript.Sleep 500

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
psScript = fso.BuildPath(scriptDir, "tools\workbuddy-start-main-window-bridge.ps1")

If Not fso.FileExists(psScript) Then
    MsgBox "Startup script not found:" & vbCrLf & psScript, vbCritical, "WorkBuddy Remote"
    WScript.Quit 1
End If

command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File " & Chr(34) & psScript & Chr(34)
shell.Run command, 0, False
