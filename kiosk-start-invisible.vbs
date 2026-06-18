Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
' Get the folder where this VBS script is located
ScriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)
' Run the node server silently in that exact folder
WshShell.Run "cmd /c cd /d """ & ScriptDir & """ && node kiosk-print-server.js", 0, False
