import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import {
  agents,
  checking,
  focused,
  hc,
  keys,
  nextCommand,
  run,
  spaces,
  theme,
  window,
} from "herdr";

const REPEAT_MS = 500;

// Repeatable actions: command string -> [herdrCommand, args]
const REPEAT_ACTIONS = {
  "tab-next": ["tab.next", {}],
  "tab-prev": ["tab.prev", {}],
  "space-next": ["space.next", {}],
  "space-prev": ["space.prev", {}],
  "tab-left": ["tab.move", { by: -1 }],
  "tab-right": ["tab.move", { by: 1 }],
  "pane-left": ["pane.go", { direction: "left" }],
  "pane-down": ["pane.go", { direction: "down" }],
  "pane-up": ["pane.go", { direction: "up" }],
  "pane-right": ["pane.go", { direction: "right" }],
  "swap-left": ["pane.swap", { direction: "left" }],
  "swap-right": ["pane.swap", { direction: "right" }],
};

// Keys accepted during the 500ms repeat window -> action name in REPEAT_ACTIONS
const REPEAT_KEYS = {
  n: "tab-next",
  p: "tab-prev",
  ")": "space-next",
  "(": "space-prev",
  J: "space-next",
  K: "space-prev",
  "<": "tab-left",
  ">": "tab-right",
  h: "pane-left",
  j: "pane-down",
  k: "pane-up",
  l: "pane-right",
  left: "pane-left",
  down: "pane-down",
  up: "pane-up",
  right: "pane-right",
  "{": "swap-left",
  "}": "swap-right",
};

function forwardKey(e, key) {
  if (["enter", "tab", "backspace", "left", "right", "up", "down", "space"].includes(e.key)) return e.key;
  if (key === " ") return "space";
  if (/^[A-Z]$/.test(key)) return `shift+${key.toLowerCase()}`;
  if (key.length === 1 && "abcdefghijklmnopqrstuvwxyz0123456789`\\[],=-.';/".includes(key)) {
    return key === "\\" ? "backslash" : key;
  }
  return null;
}

export default class WorkspaceStatus extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.repeat = false;
    this.lastAction = "";
    this.generation = 0;
    if (checking()) return;
    cx.spawn(async (cx) => {
      for (;;) {
        const cmd = await nextCommand();
        this.trigger(cmd, cx);
      }
    });
  }

  trigger(actionName, cx) {
    const spec = REPEAT_ACTIONS[actionName];
    if (!spec) return;
    const [command, args] = spec;
    const gen = ++this.generation;
    this.repeat = true;
    this.lastAction = actionName;

    // Run the command first while the current pane or sidebar mod still holds focus
    run(command, args);
    cx.notify();

    // After 10ms, take focus for repeat keys; if a sidebar mod (spaces-vim / agents-vim)
    // was the target of pane.go, its 25ms/35ms watchFocus will take focus and we yield at 45ms.
    cx.timer.after(10, (cx) => {
      if (this.generation !== gen || !this.repeat) return;
      this.handle.focus();
      cx.notify();
    });
    cx.timer.after(45, (cx) => {
      if (this.generation !== gen || !this.repeat) return;
      if (!this.handle.is_focused()) {
        this.repeat = false;
        cx.notify();
      }
    });
    cx.timer.after(REPEAT_MS, (cx) => {
      if (this.generation === gen && this.repeat) {
        this.endRepeat(cx);
      }
    });
  }

  endRepeat(cx) {
    this.generation++;
    this.repeat = false;
    if (this.handle?.is_focused()) {
      const pane = focused()?.pane;
      if (pane) run("pane.focus", { pane });
    }
    cx.notify();
  }

  onKey(e, cx) {
    if (!this.repeat) return;
    cx.stop_propagation();
    const m = e.modifiers;
    if (e.key === "escape") {
      this.endRepeat(cx);
      return;
    }
    const plain = !m.control && !m.alt && !m.platform;
    const key = plain ? (e.key_char ?? (m.shift && e.key.length === 1 ? e.key.toUpperCase() : e.key)) : e.key;
    const actionName = plain && REPEAT_KEYS[key];
    if (actionName) {
      this.trigger(actionName, cx);
      return;
    }
    const forwarded = plain && forwardKey(e, key);
    const terminal = focused()?.terminal;
    this.endRepeat(cx);
    if (forwarded && terminal) {
      const pending = hc(["keys", terminal, forwarded]);
      cx.spawn(async () => {
        await pending;
      });
    }
  }

  hint() {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  render() {
    const t = theme();
    const space = spaces().find((s) => s.active);
    const list = agents();
    const needs = list.filter((a) => a.status === "blocked").length;
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    return h_flex()
      .id("status-root")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.onKey(e, cx))
      .size_full()
      .px(14)
      .gap(16)
      .items_center()
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(11.8)
      .text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(space?.branch), (el) => el.child(label("branch", space.branch)))
      .child(
        h_flex()
          .gap(6)
          .items_center()
          .child(div().size(6).rounded(3).bg(t.dim))
          .child(`${list.length} agents`)
          .when(needs > 0, (el) => el.child(div().text_color(t.blocked).child(`· ${needs} needs you`))),
      )
      .when(this.repeat, (el) =>
        el.child(
          div()
            .px(6)
            .py(1)
            .rounded(4)
            .bg(t.accent)
            .text_size(10.5)
            .font_semibold()
            .text_color(t.accent_foreground)
            .child(`REPEAT · ${REPEAT_MS}ms`),
        ),
      )
      .child(div().flex_1())
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint()));
  }
}
