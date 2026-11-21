# Tmux + Vim Workflow (`main-vim`)

Tmux-style `<Ctrl-Space>` keybindings with popup-free 500ms repeatable keys, Vim copy mode (`Ctrl-Space [`), and focusable **Spaces** and **Agents** sidebar panels that you can jump into with `Ctrl-Space h/j/k/l` and navigate using `h j k l`.

![Tmux + Vim Workflow](preview.png)

## What you see

- **Left sidebar (`268px` wide, `theme().chrome` background):**
  - Top header (`46px`, `workspace-chrome`): app brand, search button, and sidebar collapse toggle.
  - **Spaces pane (`spaces-vim`, weight 1, min `90px`):** spaces grouped by machine with worktrees nested under their main repository. When focused via `Ctrl+Space h` or mouse click, it draws a `1px` `theme().accent` border, highlights the `Spaces` title in `theme().accent` with a `j/k · l/Enter` badge, and outlines the cursor-selected space row in `theme().accent`.
  - **Agents pane (`agents-vim`, weight 1, min `90px`):** agents in Priority or Grouped-by-space view with sub-agent trees. When focused, it draws a `1px` `theme().accent` border, highlights the `Agents` title in `theme().accent` with a `j/k · l/Enter` badge, and outlines the cursor-selected agent row in `theme().accent`.
  - Footer (`69px`, `workspace-chrome`): Settings and Add machine rows.
- **Right work column:**
  - Top tab bar (`42px`, `tabs`), main split terminal pane area (`padding: 8`, `gap: 8`, `radius: 10`), collapsible right `Files` / `Changes` stack (`368px`), and bottom status bar (`28px`, `workspace-status-vim`).
  - **Status bar (`workspace-status-vim`, `28px`):** shows machine name, git branch, agent count, blocked count, and palette shortcut. During the 500ms repeat window after a repeatable `<Ctrl-Space>` key, it displays an inline `REPEAT · 500ms` pill in `theme().accent` instead of opening a popup overlay.

## How it behaves

- **Agent statuses:** working agents spin `mods/workspace-chrome/spinner.svg` in `theme().working`; blocked agents show a `Needs you` badge (or `!` in priority/compact mode) in `theme().blocked`; finished agents show a solid dot in `theme().done`; idle agents show a hollow ring in `theme().idle`.
- **Popup-free repeatable `<Ctrl-Space>` keys (`500ms` window):**
  - Pressing `Ctrl+Space` followed by `h/j/k/l` (or arrows), `n/p` (next/prev tab), `( / )` or `K / J` (prev/next space), `< / >` (move tab left/right), or `{ / }` (swap pane left/right) runs the action immediately and opens a 500ms repeat window in `workspace-status-vim`.
  - Any repeatable key pressed within 500ms runs immediately and resets the 500ms timer. Typing a regular key forwards it to the focused terminal via `hc keys` and exits repeat mode.
  - Non-repeatable `<Ctrl-Space>` bindings (`c` new tab, `1`–`9` select tab, `%` / `v` split right, `"` / `s` split down, `z` zoom, `x` / `q` close pane, `,` rename tab, `&` close tab, `$` rename space, `w` / `P` picker, `[` Vim copy mode, `/` search, `]` paste, `:` palette, `?` help, `b` toggle sidebar, `Ctrl-Space` send NUL) run directly from `keys.json`.
- **Sidebar Vim navigation (`Spaces` and `Agents`):**
  - `Ctrl+Space h` from the leftmost terminal pane moves focus into the sidebar (`Spaces` or `Agents`). `Ctrl+Space j` and `Ctrl+Space k` move between `Spaces` and `Agents`. `Ctrl+Space l`, `Esc`, or `q` moves focus back to the terminal pane.
  - Clicking a specific space or agent row switches to and focuses its terminal pane directly; clicking the sidebar pane background/header focuses that sidebar pane for keyboard navigation.
  - While focused in **Spaces**: `j`/`k` moves the cursor, `gg`/`G` jumps to first/last space, `Enter`/`l` switches to the highlighted space and focuses its terminal, `Space`/`o` switches space while keeping focus in `Spaces`, `h` folds the machine group, `n`/`a`/`+` creates a space, `r` renames, `d`/`x` closes, `m` opens the space menu.
  - While focused in **Agents**: `j`/`k` moves through agents and sub-agents, `gg`/`G` jumps to first/last, `Enter`/`l` focuses the agent's pane (or peeks at an unkept sub-agent), `Space`/`p` peeks, `P` pins/unpins, `h` folds sub-agents or groups, `s` toggles sort mode (`Priority` ↔ `Grouped by space`).
- **Quick pickers & help at top center:** `Alt+P` opens the space/tab/agent picker (`mod.open:picker`), `Alt+Shift+P` opens the command palette (`app.palette`), and `Ctrl+Space ?` / `Ctrl+?` opens the `help-vim` keybindings list at the same top popup position (`offset: 40, width: 640`).
- **Terminal Escape fix:** `"ctrl-[": "send:\u001b"` in the `"terminal"` section of `keys.json` ensures `Ctrl+[` always sends raw `ESC` (`\x1b`) even in programs that negotiate the Kitty keyboard protocol (such as Antigravity and Codex).

## Built from

- **Layout:** `layouts/main-vim.json` (cloned from `main`), wiring block `spaces` to `spaces-vim`, block `agents` to `agents-vim`, and block `status` to `workspace-status-vim`, plus shipped `workspace-chrome`, `tabs`, `pane`, `files`, and `changes`.
- **Mods:**
  - `mods/spaces-vim/` (`focusable: true` in `mod.json`): cloned from `spaces`, listening for `"focus"` on `nextCommand()`, tracking a `FocusHandle` on `#spaces-root`, and handling `h/j/k/l` in `on_key_down`.
  - `mods/agents-vim/` (`focusable: true` in `mod.json`): cloned from `agents`, listening for `"focus"` on `nextCommand()`, tracking a `FocusHandle` on `#agents-root` and a `ScrollHandle` on `#ag-list`, and handling `h/j/k/l` in `on_key_down`.
  - `mods/workspace-status-vim/` (`place: "none"`): cloned from `workspace-status`, receiving repeatable actions via `nextCommand()` (`workspace-status-vim.<action>`), holding focus for `500ms` unless a sidebar mod takes focus, and forwarding unbound keys via `hc(["keys", terminal, key])`.
  - `mods/copy-mode/` (`place: "none"`, top popup overlay `580x40` at offset `12px`): Vim copy mode using `terminal.select`, `terminal.adjust_selection`, `terminal.clear_selection`, and `terminal.copy`.
  - `mods/help-vim/` (`place: "none"`, top popup overlay `640x0.8` at offset `40px`): filterable keybindings popup reading `keys()`, grouping repeatable `workspace-status-vim.*` bindings under `spaces`, `tabs`, and `panes`.
- **Keys:** `keys.json` merging default bindings with `<Ctrl-Space>` sequences, `"alt-p": "mod.open:picker"`, `"alt-shift-p": "app.palette"`, and `"ctrl-[": "send:\u001b"`.

## Watch out

- `this.handle.focus()` is applied by GPUI after the current JS callback returns. Schedule a follow-up `cx.notify()` after `25–35ms` (`watchFocus`) so `this.handle.is_focused()` renders `true` immediately without waiting for mouse hover events, and poll gently while `this.handle.is_focused()` is `true` so the focus ring clears as soon as focus leaves.
- Always call `run("pane.go", { direction: "right" })` when leaving a `"focusable": true` sidebar mod for the already-active terminal pane; calling `run("pane.focus", { pane })` alone on an already-focused pane leaves Herdr's `pane.go` state on the sidebar mod.
- When `workspace-status-vim` runs `pane.go`, it waits `10ms` before focusing its repeat handle and checks `!this.handle.is_focused()` at `45ms` so that if `pane.go` landed on `spaces-vim` or `agents-vim` (which claim focus at `25ms`/`35ms`), the status bar yields focus to the sidebar.
- Guard all `init()` tasks and commands with `if (checking()) return;` after initializing instance fields so `herdr-app check` passes cleanly.
- `workspace-status-vim` runs `hc keys` to forward unbound keys typed during the 500ms repeat window, and `spaces-vim` runs `git` and `hc machine` as the shipped `spaces` mod does.

## Done when

- `herdr-app check` passes on `mods/spaces-vim`, `mods/agents-vim`, `mods/workspace-status-vim`, and `mods/copy-mode`.
- `herdr-app status` reports `"layout": "main-vim"` and `"errors": []`.
- `Ctrl+Space h` moves keyboard focus from the terminal into the left sidebar (`Spaces` or `Agents`) and immediately draws the `theme().accent` focus border; `Ctrl+Space j` and `Ctrl+Space k` move between `Spaces` and `Agents`; `j` and `k` move the row cursor inside the focused sidebar; `Enter` or `l` activates the highlighted item and returns focus to the terminal.
- Pressing `Ctrl+Space n` switches to the next tab and shows `REPEAT · 500ms` in the bottom status bar; pressing `n` or `p` within 500ms switches tabs again without repeating `Ctrl+Space`.
- Pressing `Ctrl+Space [` opens the `COPY (NORMAL)` pill at the top of the window, navigates and selects terminal text with `h/j/k/l` and `v`/`V`, yanks with `y`, and exits cleanly on `q` or `Esc`.
