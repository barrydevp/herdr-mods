# herdr-mods

Tmux-style `<Ctrl-Space>` keybindings, Vim copy mode, Vim-navigable **Spaces** & **Agents** sidebars, top-center picker / command palette / keybinding help, and an agent context & quota bar for [Herdr](https://herdr.dev). Works on Windows, macOS and Linux, including spaces on other machines (`hc machine`).

## Packages

| Folder | Type | Description |
|---|---|---|
| [`tmux-vim/`](./tmux-vim) | Layout + Mods | Complete Tmux `<Ctrl-Space>` workflow: focusable `Spaces` and `Agents` sidebars with `h/j/k/l` navigation, `picker-vim` / `palette-vim` / `help-vim` popups, Vim copy mode (`Ctrl-Space [`), and an `agent-usage-vim` bar showing the focused agent's context use and account limits (Claude Code, Codex, Antigravity). |
| [`copy-mode/`](./copy-mode) | Mod | Standalone Vim Copy Mode (`Ctrl-Space [`) for any Herdr layout using native `terminal.select` and `terminal.adjust_selection`. |

`agent-usage-vim` runs programs and reaches the network: it runs Python 3 (`python3`, or `python` / `py` on Windows) on the agent's machine, reads the agents' session files there, and asks `api.anthropic.com` for Claude plan limits with your Claude Code login. Set `"claude_usage_api": false` in its layout props to keep it off the network. See [`tmux-vim/RECIPE.md`](./tmux-vim/RECIPE.md).

## How to Install in Herdr

Ask an agent inside Herdr:

```text
Read ~/.config/herdr-app/AGENTS.md and install tmux-vim from https://github.com/barrydevp/herdr-mods/tree/master/tmux-vim
```

Or for standalone Vim Copy Mode only:

```text
Read ~/.config/herdr-app/AGENTS.md and install copy-mode from https://github.com/barrydevp/herdr-mods/tree/master/copy-mode
```

## Local Development Sync

`sync.ps1` copies between this repo and the live Herdr home (`~/.config/herdr-app`, or `$HERDR_APP_HOME`) and runs `herdr-app check` on every mod. It runs in Windows PowerShell and in PowerShell 7 (`pwsh`) on macOS and Linux.

```powershell
./sync.ps1 apply   # repo -> live (backs up a live keys.json that differs first)
./sync.ps1 pull    # live -> repo
./sync.ps1 check   # check every mod and show herdr-app status
```
