param(
    [Parameter(Position = 0)]
    [ValidateSet("apply", "pull", "check")]
    [string]$Action = "check"
)

$ErrorActionPreference = "Stop"
$RepoRoot = $PSScriptRoot
$HerdrHome = if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME } else { Join-Path $HOME ".config\herdr-app" }
$Mods = @("spaces-vim", "agents-vim", "workspace-status-vim", "copy-mode", "help-vim")

function Invoke-Check {
    foreach ($m in $Mods) {
        $p = Join-Path $RepoRoot "tmux-vim\mods\$m"
        herdr-app check $p
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    herdr-app check (Join-Path $RepoRoot "copy-mode\mods\copy-mode")
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    herdr-app status
}

if ($Action -eq "apply") {
    # Keep standalone copy-mode in sync with tmux-vim/mods/copy-mode
    Copy-Item "$RepoRoot\tmux-vim\mods\copy-mode\main.js" "$RepoRoot\copy-mode\mods\copy-mode\main.js" -Force
    Copy-Item "$RepoRoot\tmux-vim\mods\copy-mode\mod.json" "$RepoRoot\copy-mode\mods\copy-mode\mod.json" -Force

    # Deploy to live ~/.config/herdr-app (triggers Herdr hot-reload)
    Copy-Item "$RepoRoot\tmux-vim\layouts\main-vim.json" "$HerdrHome\layouts\main-vim.json" -Force
    Copy-Item "$RepoRoot\tmux-vim\keys.json" "$HerdrHome\keys.json" -Force
    foreach ($m in $Mods) {
        New-Item -ItemType Directory -Force -Path "$HerdrHome\mods\$m" | Out-Null
        Copy-Item "$RepoRoot\tmux-vim\mods\$m\main.js" "$HerdrHome\mods\$m\main.js" -Force
        Copy-Item "$RepoRoot\tmux-vim\mods\$m\mod.json" "$HerdrHome\mods\$m\mod.json" -Force
    }
    Write-Output "Applied C:\Dev\herdr-mods -> $HerdrHome"
    Invoke-Check
}
elseif ($Action -eq "pull") {
    Copy-Item "$HerdrHome\layouts\main-vim.json" "$RepoRoot\tmux-vim\layouts\main-vim.json" -Force
    Copy-Item "$HerdrHome\keys.json" "$RepoRoot\tmux-vim\keys.json" -Force
    foreach ($m in $Mods) {
        Copy-Item "$HerdrHome\mods\$m\main.js" "$RepoRoot\tmux-vim\mods\$m\main.js" -Force
        Copy-Item "$HerdrHome\mods\$m\mod.json" "$RepoRoot\tmux-vim\mods\$m\mod.json" -Force
    }
    Copy-Item "$HerdrHome\mods\copy-mode\main.js" "$RepoRoot\copy-mode\mods\copy-mode\main.js" -Force
    Copy-Item "$HerdrHome\mods\copy-mode\mod.json" "$RepoRoot\copy-mode\mods\copy-mode\mod.json" -Force
    Write-Output "Pulled $HerdrHome -> C:\Dev\herdr-mods"
    Invoke-Check
}
else {
    Invoke-Check
}
