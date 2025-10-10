# Play a single file
param(
    [Parameter(Mandatory=$true, Position=0)]
    [string]$AudioFilePath
)

$currentPID = $PID

# --- CHANGE: Create an empty file named after the PID in the CWD ('.') ---
# Create the filename string
$pidFileName = "$currentPID" + ".pid"

# Full path to the PID file in the Current Working Directory
$pidFilePath = Join-Path (Get-Location) $pidFileName

# Create an empty file at that path
New-Item -Path $pidFilePath -ItemType File | Out-Null

Add-Type -AssemblyName presentationCore
$mediaPlayer = New-Object system.windows.media.mediaplayer
$mediaPlayer.open($AudioFilePath)
$mediaPlayer.Play()
Exit 0