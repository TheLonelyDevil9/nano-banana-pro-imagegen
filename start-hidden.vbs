' Nano Banana Pro - Hidden Launcher for Windows
' Double-click this file to start the app without a visible terminal window
' The server runs in the background and your browser opens automatically

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Get the directory where this script is located
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

' Change to the script directory
WshShell.CurrentDirectory = scriptDir

' Start the server in a hidden PowerShell window
WshShell.Run "powershell -WindowStyle Hidden -Command ""npx -y serve -l 3000""", 0, False

' Wait for the server to start
WScript.Sleep 2000

' Open the browser
WshShell.Run "http://localhost:3000", 1, False

' Clean up
Set WshShell = Nothing
Set fso = Nothing
