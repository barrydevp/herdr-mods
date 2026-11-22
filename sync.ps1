param(
    [Parameter(Position = 0)]
    [ValidateSet("apply", "pull", "check")]
    [string]$Action = "check"
)

# Runs on Windows PowerShell and on PowerShell 7 (pwsh) for macOS and Linux.
$ErrorActionPreference = "Stop"
$RepoRoot = $PSScriptRoot
$HerdrHome = if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME } else { Join-Path (Join-Path $HOME ".config") "herdr-app" }
$Mods = @("spaces-vim", "agents-vim", "workspace-status-vim", "agent-usage-vim", "copy-mode", "help-vim", "picker-vim", "palette-vim")

function P([string[]]$Parts) { $Parts -join [IO.Path]::DirectorySeparatorChar }
$Pkg = P $RepoRoot, "tmux-vim"
$Standalone = P $RepoRoot, "copy-mode", "mods", "copy-mode"

function Invoke-Check {
    foreach ($m in $Mods) {
        herdr-app check (P $Pkg, "mods", $m)
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    herdr-app check $Standalone
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    herdr-app status
}

if ($Action -eq "apply") {
    # Keep standalone copy-mode in sync with tmux-vim/mods/copy-mode
    foreach ($f in "main.js", "mod.json") {
        Copy-Item (P $Pkg, "mods", "copy-mode", $f) (P $Standalone, $f) -Force
    }

    # keys.json is the whole live file: keep a copy of live edits that were never pulled.
    $LiveKeys = P $HerdrHome, "keys.json"
    $RepoKeys = P $Pkg, "keys.json"
    if ((Test-Path $LiveKeys) -and ((Get-Content $LiveKeys -Raw) -ne (Get-Content $RepoKeys -Raw))) {
        $Backup = "$LiveKeys.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
        Copy-Item $LiveKeys $Backup
        Write-Warning "Live keys.json differed from the repo; saved it as $Backup (use 'pull' to keep live edits)."
    }

    # Deploy to live ~/.config/herdr-app (triggers Herdr hot-reload)
    Copy-Item (P $Pkg, "layouts", "main-vim.json") (P $HerdrHome, "layouts", "main-vim.json") -Force
    Copy-Item $RepoKeys $LiveKeys -Force
    foreach ($m in $Mods) {
        $Dest = P $HerdrHome, "mods", $m
        New-Item -ItemType Directory -Force -Path $Dest | Out-Null
        Copy-Item (P $Pkg, "mods", $m, "*") $Dest -Force
    }
    Write-Output "Applied $RepoRoot -> $HerdrHome"
    Invoke-Check
}
elseif ($Action -eq "pull") {
    Copy-Item (P $HerdrHome, "layouts", "main-vim.json") (P $Pkg, "layouts", "main-vim.json") -Force
    Copy-Item (P $HerdrHome, "keys.json") (P $Pkg, "keys.json") -Force
    foreach ($m in $Mods) {
        Get-ChildItem (P $HerdrHome, "mods", $m) -File | Where-Object { $_.Name -in "main.js", "mod.json" -or $_.Extension -eq ".py" } | ForEach-Object {
            Copy-Item $_.FullName (P $Pkg, "mods", $m, $_.Name) -Force
        }
    }
    foreach ($f in "main.js", "mod.json") {
        Copy-Item (P $HerdrHome, "mods", "copy-mode", $f) (P $Standalone, $f) -Force
    }
    Write-Output "Pulled $HerdrHome -> $RepoRoot"
    Invoke-Check
}
else {
    Invoke-Check
}
