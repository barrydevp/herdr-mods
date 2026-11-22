// Agents in grouped or priority views; parents take their most urgent sub-agent's place.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { agents, terminals, panes, focused, spaces, run, theme, shared, setShared, setAgentOrder, openOverlay, closeOverlay, props, window, layout, checking, nextCommand } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

// Drops what an agent puts before its title: a status glyph or spinner and the separator
// after it ("✦  Working", "⠋ - Thinking"), and Codex's blinking "[ ! ] " / "[ . ] " mark.
// Stops at an opening bracket or quote, so a title that starts with one ("[web] login") keeps it.
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}\p{Ps}\p{Pi}]+/u, "").replace(/^\[ [!.] \] /, "").trim();

function leadPanes(all) {
  const leads = new Map();
  for (const p of all) {
    if (!p.terminal) continue;
    const current = leads.get(p.tab);
    // First agent, else first focused terminal, else first terminal in the tab.
    if (!current || (!current.program?.agent && (p.program?.agent || (!current.focused && p.focused)))) leads.set(p.tab, p);
  }
  return leads;
}

function title(tab, l, fallbackTitle = "") {
  const prog = l?.program?.name;
  const check = (raw) => {
    const live = clean(raw);
    // clean() would strip a path's leading ~ or /: test the title with only its status glyph gone.
    const path = /^[~/]|^[A-Za-z]:\\/.test((raw ?? "").replace(/^[^\p{L}\p{N}~/]+/u, ""));
    const telling = live && live !== (l?.terminal ?? l?.address) && live !== prog && !path && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
    return telling ? live : null;
  };
  const chosen = check(l?.title) ?? check(fallbackTitle);
  return (tab.name === prog || !tab.named) && chosen ? chosen : tab.name;
}
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};
const SORTS = [
  { id: "priority", label: "Priority", icon: "clock" },
  { id: "grouped", label: "Grouped by space", icon: "layers" },
];
const sortOf = () => SORTS.find((s) => s.id === shared("agents.sort")) ?? SORTS[0];
const SECTION = { 4: "Needs you", 3: "Done", 2: "Working", 1: "Idle" };
const SECTION_STATUS = { 4: "blocked", 3: "done", 2: "working" };

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// The agent's icon from the app's program table: a one-color glyph or a picture.
function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

export default class Agents extends View {
  init(_props, cx) {
    if (props()?.sortMenu) return;
    this.folded = new Set();
    this.cursor = null;
    this.pendingG = false;
    this.navItems = [];
    this.rowIndex = new Map();
    this.handle = cx.focus_handle();
    this.scroll = ScrollHandle.new();
    // Each agent's last state and when it changed (ms), kept across restarts.
    try { this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}"); } catch { this.changed = {}; }
    if (!this.changed || typeof this.changed !== "object" || Array.isArray(this.changed)) this.changed = {};
    try { this.pendingPins = JSON.parse(localStorage.getItem("pins") ?? "[]"); } catch { this.pendingPins = []; }
    if (!Array.isArray(this.pendingPins)) this.pendingPins = [];
    if (!this.pendingPins.length) localStorage.removeItem("pins");
    this.migratingPins = new Set();
    if (checking()) return;
    cx.spawn(async (cx) => {
      for (;;) {
        const cmd = await nextCommand();
        if (cmd === "focus") {
          const active = focused()?.agent ?? agents().find((a) => a.focused)?.address;
          if (!this.cursor || !this.navItems.some((item) => item.address === this.cursor)) {
            this.cursor = active ?? this.navItems[0]?.address ?? null;
          }
          this.watchFocus(cx);
        }
      }
    });
    cx.timer.every(30000, (cx) => {
      if (window().active && Object.keys(this.changed).length) cx.notify();
    });
  }

  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    // Gone and old: the list alone is empty right after a start.
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  // Keep offline pins until their terminal returns, and keep each pending until
  // core echoes the label so a failed write doesn't erase the old pin.
  migratePins(all) {
    if (!this.pendingPins.length) return;
    const listed = new Map(all.filter((t) => t.state === "live").map((t) => [t.address, t]));
    const pending = this.pendingPins.filter((address) => {
      const terminal = listed.get(address);
      if (!terminal) return true;
      if (terminal.labels?.["herdr.pinned"]) return false;
      if (!this.migratingPins.has(address)) {
        this.migratingPins.add(address);
        run("terminal.pin", { terminal: address, pinned: true });
      }
      return true;
    });
    if (pending.length === this.pendingPins.length) return;
    this.pendingPins = pending;
    if (pending.length) localStorage.setItem("pins", JSON.stringify(pending));
    else localStorage.removeItem("pins");
  }

  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }

  rank(a) {
    return RANK[a.status] ?? 0;
  }

  sortMenu(t) {
    const on = sortOf().id;
    return v_flex()
      .w_full()
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).child("Sort agents"))
      .children(SORTS.map((s) => h_flex()
        .id(`sort-${s.id}`)
        .h(31)
        .px(8)
        .gap(9)
        .rounded(7)
        .items_center()
        .text_color(t.foreground)
        .hover((el) => el.bg(t.hover))
        .on_click(() => {
          setShared("agents.sort", s.id);
          closeOverlay(props().overlay);
        })
        .child(svg(`mods/workspace-chrome/${s.icon}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().child(s.label))
        .when(s.id === on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).flex_none().text_color(t.foreground)))));
  }

  peek(addr) {
    run("terminal.peek", { terminal: addr });
  }

  // Live sub-agents of `addr`, depth first, each with the tree lines in front of it.
  tree(kidsByParent, addr, lead = []) {
    const kids = (kidsByParent instanceof Map ? kidsByParent.get(addr) : kidsByParent.filter((k) => k.parent === addr && k.state === "live")) ?? [];
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [
        { t: k, lines: [...lead, last ? "└" : "├"] },
        ...this.tree(kidsByParent, k.address, [...lead, last ? "" : "│"]),
      ];
    });
  }

  subRow(t, s, shown, compact, hasFocus) {
    const k = s.t;
    const st = kidStatus(k, this.listed);
    const pic = icon(k.program, 14, t.foreground);
    const on = k.address === shown;
    const isCursor = hasFocus && this.cursor === k.address;
    return h_flex()
      .id(`sub-${k.address}`)
      .pl(39)
      .pr(8)
      .rounded(8)
      .h(26)
      .flex_none()
      .gap(0)
      .items_center()
      .text_size(12.5)
      .when(on, (el) => el.bg(t.raised))
      .when(!on && isCursor, (el) => el.bg(t.hover))
      .when(isCursor, (el) => el.border_1().border_color(t.accent))
      .hover((s) => s.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(() => (this.listed.has(k.address) ? run("pane.focus", { terminal: k.address }) : this.peek(k.address)))
      .children(s.lines.map(l => div().self_start().mt(-4).w(9).h(17).mr(4).flex_none()
        .when(Boolean(l), el => el.border_l(1.5).border_color(t.input))
        .when(l === "└" || l === "├", el => el.border_b(1.5).rounded_bl(6))))
      .when(Boolean(pic), el => el.child(div().mr(8).child(pic)))
      .child(div().flex_1().truncate().text_color(on ? t.foreground : t.muted).child(k.name || k.template || k.program?.name || k.address))
      .child(this.status(t, { status: st }, compact));
  }

  // compact: a ! for blocked where a header already says "Needs you".
  status(t, a, compact = false) {
    const color = t[a.status] ?? t.dim;
    if (a.status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.working).spin(900);
    if (a.status === "blocked" && compact) return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
    if (a.status === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
    // Idle: a ring; done: a dot.
    if (a.status === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
    return div().size(7).mx(3).flex_none().rounded(4).bg(a.status === "done" ? color : t.dim + "00");
  }

  watchFocus(cx) {
    const wasFocused = Boolean(this.handle?.is_focused());
    this.handle.focus();
    if (!wasFocused) cx.notify();
    if (this.watchingFocus) return;
    this.watchingFocus = true;
    cx.spawn(async (cx) => {
      await cx.sleep(30);
      if (!this.handle?.is_focused()) {
        this.handle.focus();
        cx.notify();
      }
      while (this.handle?.is_focused()) {
        await cx.sleep(120);
      }
      this.watchingFocus = false;
      cx.notify();
    });
  }

  onKey(e, cx) {
    const m = e.modifiers;
    if (m.control || m.alt || m.platform) return;
    const key = e.key_char ?? (m.shift && e.key.length === 1 ? e.key.toUpperCase() : e.key);

    if (e.key === "escape" || key === "q") {
      this.pendingG = false;
      run("pane.go", { direction: "right" });
      cx.stop_propagation();
      cx.notify();
      return;
    }

    const items = this.navItems ?? [];
    const idx = Math.max(0, items.findIndex((item) => item.address === this.cursor));

    const moveTo = (nextIdx) => {
      this.pendingG = false;
      if (!items.length) return;
      const clamped = Math.max(0, Math.min(items.length - 1, nextIdx));
      this.cursor = items[clamped].address;
      const rowAt = this.rowIndex.get(this.cursor);
      if (rowAt !== undefined) this.scroll.scroll_to_item(rowAt);
      cx.notify();
    };

    if (key === "j" || e.key === "down") {
      moveTo(idx + 1);
      cx.stop_propagation();
      return;
    }
    if (key === "k" || e.key === "up") {
      moveTo(idx - 1);
      cx.stop_propagation();
      return;
    }
    if (key === "G") {
      moveTo(items.length - 1);
      cx.stop_propagation();
      return;
    }
    if (key === "g") {
      if (this.pendingG) moveTo(0);
      else {
        this.pendingG = true;
        cx.notify();
      }
      cx.stop_propagation();
      return;
    }

    const current = items[idx] ?? items[0];
    const enter = e.key === "enter";
    const open = key === "l" || e.key === "right";
    const fold = (id) => { this.folded.add(id); cx.notify(); };
    const unfold = (id) => { this.folded.delete(id); cx.notify(); };
    const cursorTo = (addr) => {
      this.cursor = addr;
      const rowAt = this.rowIndex.get(addr);
      if (rowAt !== undefined) this.scroll.scroll_to_item(rowAt);
    };

    // On a group header: Enter toggles it, l / right opens it (or steps in), h / left folds it.
    if (current?.group && (enter || open || key === "h" || e.key === "left")) {
      this.pendingG = false;
      const folded = this.folded.has(current.group);
      if (enter) folded ? unfold(current.group) : fold(current.group);
      else if (open) folded ? unfold(current.group) : moveTo(idx + 1);
      else if (!folded) fold(current.group);
      cx.stop_propagation();
      return;
    }

    // l / right on an agent with folded sub-agents: show them.
    if (open && current?.hasSubs && this.folded.has(current.address)) {
      this.pendingG = false;
      unfold(current.address);
      cx.stop_propagation();
      return;
    }

    // Enter / l / right: focus agent's pane (or peek if sub-agent without pane)
    if (enter || open) {
      this.pendingG = false;
      run("pane.go", { direction: "right" });
      if (current) {
        if (current.pane) run("pane.focus", { pane: current.pane });
        else if (this.listed?.has(current.address)) run("pane.focus", { terminal: current.address });
        else this.peek(current.address);
      }
      cx.stop_propagation();
      cx.notify();
      return;
    }

    // Space / p: peek at highlighted agent
    if (e.key === "space" || key === "p") {
      this.pendingG = false;
      if (current && !current.group) this.peek(current.address);
      cx.stop_propagation();
      return;
    }

    // P (Shift+p): toggle pin on highlighted agent
    if (key === "P") {
      this.pendingG = false;
      if (current && !current.isSub && !current.group) {
        run("terminal.pin", { terminal: current.address, pinned: !current.pinned });
      }
      cx.stop_propagation();
      return;
    }

    // h / left: fold the open sub-agents under this agent; otherwise fold what holds it
    // (a sub-agent's parent, an agent's group) and put the cursor on that, so l opens it again.
    if (key === "h" || e.key === "left") {
      this.pendingG = false;
      if (current?.hasSubs && !this.folded.has(current.address)) fold(current.address);
      else if (current?.isSub) {
        fold(current.groupId);
        cursorTo(current.groupId);
      } else if (current?.groupId) {
        fold(current.groupId);
        cursorTo(`group:${current.groupId}`);
      }
      cx.stop_propagation();
      return;
    }

    // s: toggle sort mode (priority <-> grouped)
    if (key === "s") {
      this.pendingG = false;
      const next = sortOf().id === "priority" ? "grouped" : "priority";
      setShared("agents.sort", next);
      cx.stop_propagation();
      cx.notify();
    }
  }

  render(cx) {
    const t = theme();
    if (props()?.sortMenu) return this.sortMenu(t);
    const collapsed = narrow();
    const hasFocus = Boolean(this.handle?.is_focused());
    const sort = sortOf();
    let list = agents();
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    const all = terminals();
    this.migratePins(all);
    const shown = focused()?.agent;
    const now = Date.now();
    this.track(list, now);
    const kidsByParent = new Map();
    for (const k of all) {
      if (k.state === "live" && k.parent) {
        let arr = kidsByParent.get(k.parent);
        if (!arr) { arr = []; kidsByParent.set(k.parent, arr); }
        arr.push(k);
      }
    }
    const trees = new Map(list.map((a) => [a.address, this.tree(kidsByParent, a.address)]));
    const treeOf = (a) => trees.get(a.address) ?? [];
    // A kept sub-agent (one with a pane) is in agents() too: where a tree shows
    // it, it gets no row of its own, unless it's pinned.
    const nested = new Set(collapsed ? [] : list.flatMap((a) => treeOf(a).map((s) => s.t.address)));
    list = list.filter((a) => a.pinned || !nested.has(a.address));
    const tabCounts = new Map();
    for (const a of list) tabCounts.set(a.tab, (tabCounts.get(a.tab) ?? 0) + 1);
    const byPriority = sort.id === "priority";
    const urgency = new Map(list.map((a) => [a.address, Math.max(this.rank(a), ...treeOf(a).map((s) => RANK[kidStatus(s.t, this.listed)] ?? 0))]));
    const rankOf = (a) => urgency.get(a.address);
    if (byPriority) list = [...list].sort((x, y) => rankOf(y) - rankOf(x) || this.since(y) - this.since(x) || y.seq - x.seq);
    const pinned = list.filter((a) => a.pinned);
    const rest = list.filter((a) => !a.pinned);
    list = [...pinned, ...rest];
    const order = list.map((a) => a.address);
    const orderKey = order.join("\0");
    if (orderKey !== this.lastAgentOrder) {
      this.lastAgentOrder = orderKey;
      setAgentOrder(order);
    }

    // Groups in list order: spaces (grouped) or priority sections. Agents of a
    // space are next to each other in agents(), so neighbours make a group.
    const groups = pinned.length ? [{ id: "pinned", label: "Pinned", status: null, members: pinned }] : [];
    for (const a of rest) {
      const r = rankOf(a) || RANK.idle;
      const id = byPriority ? `sec-${r}` : `sp-${a.space}`;
      if (groups.at(-1)?.id === id) groups.at(-1).members.push(a);
      else groups.push({ id, label: byPriority ? SECTION[r] : a.space_name || "", status: byPriority ? SECTION_STATUS[r] : null, members: [a] });
    }

    const navItems = [];
    this.rowIndex = new Map();
    let visualRow = 0;
    if (collapsed) {
      list.forEach((a) => {
        this.rowIndex.set(a.address, visualRow++);
        navItems.push({ address: a.address, pane: a.pane, pinned: a.pinned, isSub: false, hasSubs: false, groupId: null });
      });
    } else {
      for (const g of groups) {
        // The header is a stop too, so a folded group can be opened again from the keyboard.
        this.rowIndex.set(`group:${g.id}`, visualRow++);
        navItems.push({ address: `group:${g.id}`, group: g.id, pane: null, pinned: false, isSub: false, hasSubs: false, groupId: null });
        if (this.folded.has(g.id)) continue;
        for (const a of g.members) {
          const subs = treeOf(a);
          this.rowIndex.set(a.address, visualRow++);
          navItems.push({ address: a.address, pane: a.pane, pinned: a.pinned, isSub: false, hasSubs: subs.length > 0, groupId: g.id });
          if (!this.folded.has(a.address)) {
            for (const s of subs) {
              this.rowIndex.set(s.t.address, visualRow++);
              navItems.push({ address: s.t.address, pane: null, pinned: false, isSub: true, hasSubs: false, groupId: a.address });
            }
          }
        }
      }
    }
    this.navItems = navItems;
    const navigable = (addr) => Boolean(addr) && navItems.some((item) => item.address === addr);
    if (!navigable(this.cursor)) {
      this.cursor = [shown, list.find((a) => a.focused)?.address].find(navigable) ?? navItems[0]?.address ?? null;
    }

    const withKids = (a, i) => {
      const subs = collapsed ? [] : treeOf(a);
      const r = row(a, i, subs);
      if (this.folded.has(a.address)) return [r];
      return [r, ...subs.map((s) => this.subRow(t, s, shown, byPriority, hasFocus))];
    };

    // The fold chevron; folded, the count too, colored by the most urgent one.
    const fold = (a, subs) => {
      const sts = subs.map((s) => kidStatus(s.t, this.listed));
      const top = sts.reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);
      const open = !this.folded.has(a.address);
      return div()
        .id(`fold-${a.address}`)
        .h(18)
        .px(3)
        .gap(3)
        .flex()
        .items_center()
        .rounded(4)
        .text_size(11)
        .text_color(open ? t.dim : (t[top] ?? t.dim))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          open ? this.folded.add(a.address) : this.folded.delete(a.address);
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
        .when(!open, (el) => el.child(String(subs.length)));
    };

    // A row reads "space \u00b7 detail": the detail is a tab someone named or the
    // agent's own title, never an automatic tab number unless two rows would
    // otherwise read the same.
    // Read the pane snapshot once: every host read copies the whole list into JS.
    const leads = leadPanes(panes());
    const termByAddr = new Map(all.map((x) => [x.address, x]));
    const sharedTitles = shared("agent.titles") ?? {};
    const tabs = new Map(spaces().flatMap(s => s.tabs).map(tab => [tab.id, tab]));
    const labels = new Map(list.map(a => {
      const tab = tabs.get(a.tab);
      const many = tabCounts.get(a.tab) > 1;
      const target = many ? a : (leads.get(a.tab) ?? a);
      const addr = target?.terminal ?? target?.address ?? a.address;
      const fallback = termByAddr.get(addr)?.report?.msg || sharedTitles[addr] || "";
      return [a.address, tab ? title(many ? { ...tab, named: false } : tab, target, fallback) : (a.title || fallback || a.program?.name || "")];
    }));
    const label = (a) => labels.get(a.address);
    const detail = new Map(list.map(a => [a.address, /^\d+$/.test(label(a)) ? null : label(a)]));
    const seen = {};
    for (const a of list) { const k = `${a.space_name}\u0000${detail.get(a.address) ?? ""}`; seen[k] = (seen[k] ?? 0) + 1; }
    for (const a of list) {
      if (detail.get(a.address) == null && seen[`${a.space_name}\u0000`] > 1) detail.set(a.address, label(a));
    }

    const row = (a, i, subs = []) => {
      const pic = icon(a.program, 16, t.foreground);
      const more = detail.get(a.address);
      const isCursor = hasFocus && this.cursor === a.address;
      // An agent on another machine (`vps/t7`) says which.
      const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
      if (collapsed) {
        return h_flex()
          .id(`ag-${a.address}`)
          .h(26)
          .px(8)
          .flex_none()
          .items_center()
          .gap(4)
          .rounded(6)
          .when(isCursor, (el) => el.bg(t.hover).border_1().border_color(t.accent))
          .hover((s) => s.bg(t.hover))
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click(() => {
            this.cursor = a.address;
            run("pane.focus", { pane: a.pane });
          })
          .child(div().flex_1().min_w(0).whitespace_nowrap().text_right().text_color(t.muted).child(String(i + 1)))
          .child(h_flex().w(14).flex_none().items_center().justify_center().child(this.status(t, a, true)));
      }
      const when = this.since(a);
      const idle = a.status === "idle" && !a.focused;
      const isPinned = a.pinned;
      const pin = div()
        .id(`pin-${a.address}`)
        .flex_none()
        .p(2)
        .rounded(4)
        .text_color(t.dim)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(isPinned ? "Unpin" : "Pin to the top")
        .on_click((_e, cx) => {
          cx.stop_propagation();
          run("terminal.pin", { terminal: a.address, pinned: !isPinned });
          // The row moves away from under the pointer, and no hover-out comes.
          this.hovered = null;
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/${isPinned ? "pin-off" : "pin"}.svg`).size(13));
      // Under a space header the space goes without saying; an automatic tab number says nothing.
      // Without a space header above (priority, pinned) the row names its space.
      const full = byPriority || isPinned;
      const name = full ? a.space_name || label(a) : more ?? (/^\d+$/.test(label(a)) ? a.program?.name || label(a) : label(a));
      return h_flex()
        .id(`ag-${a.address}`)
        .px(8)
        .h(30)
        .flex_none()
        .rounded(8)
        .items_center()
        .gap(9)
        .when(a.focused, (el) => el.bg(t.selected))
        .when(!a.focused && isCursor, (el) => el.bg(t.hover))
        .when(isCursor, (el) => el.border_1().border_color(t.accent))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_hover((on, cx) => {
          const next = on ? a.address : this.hovered === a.address ? null : this.hovered;
          if (next !== this.hovered) {
            this.hovered = next;
            cx.notify();
          }
        })
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(() => {
          this.cursor = a.address;
          run("pane.focus", { pane: a.pane });
        })
        .when(Boolean(pic), el => el.child(div().id(`agent-fold-${a.address}`)
          .when(subs.length > 0, el => el.on_click((_e, cx) => {
            cx.stop_propagation();
            this.folded.has(a.address) ? this.folded.delete(a.address) : this.folded.add(a.address);
            cx.notify();
          })).child(pic)))
        .child(h_flex().flex_1().min_w(0).gap(5).items_center()
          .child(div().min_w(0).max_w(full && more ? 120 : 200).truncate().text_color(idle ? t.muted : t.foreground).child(name))
          .when(full && Boolean(more), el => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(`\u00b7 ${more}`))))
        .when(Boolean(machine), el => el.child(div().text_size(10).text_color(t.dim).child(machine)))
        .when(subs.length > 0, el => el.child(fold(a, subs)))
        .when(this.hovered === a.address, el => el.child(pin))
        .when(this.hovered !== a.address && Boolean(when), el => el.child(div().flex_none().text_size(11).text_color(t.dim).child(duration(now - when))))
        .child(this.status(t, a, byPriority && !isPinned));
    };

    // A group's header; it folds the group. Folded, it says how many and the most urgent state.
    const header = (g) => {
      const open = !this.folded.has(g.id);
      const top = g.members.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
      const isCursor = hasFocus && this.cursor === `group:${g.id}`;
      return h_flex()
        .id(g.id)
        .px(8)
        .pt(8)
        .h(30)
        .flex_none()
        .gap(6)
        .items_center()
        .rounded(6)
        .when(isCursor, (el) => el.bg(t.hover).border_1().border_color(t.accent))
        .text_size(11)
        .font_medium()
        .cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          open ? this.folded.add(g.id) : this.folded.delete(g.id);
          cx.notify();
        })
        .child(div().truncate().text_color(t[g.status] ?? t.dim).child(g.label))
        .when(byPriority || !open, (el) => el.child(div().text_color(t.dim).child(String(g.members.length))))
        .child(div().flex_1())
        .when(!open, (el) => el
          .when(!byPriority && top && top !== "idle", (el) => el.child(this.status(t, { status: top }, true)))
          .child(svg("mods/workspace-chrome/chevron-right.svg").size(11).flex_none().text_color(t.dim)));
    };
    const rows = collapsed
      ? list.flatMap(withKids)
      : groups.flatMap((g) => [header(g), ...(this.folded.has(g.id) ? [] : g.members.flatMap(withKids))]);

    return v_flex()
      .id("agents-root")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.onKey(e, cx))
      .on_mouse_down("left", (_e, cx) => this.watchFocus(cx))
      .on_mouse_down_out((_e, cx) => { if (this.handle?.is_focused()) cx.notify(); })
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .when(hasFocus, (el) => el.border_1().border_color(t.accent))
      .text_size(13)
      .when(!collapsed, (el) =>
        el.child(
          h_flex()
            .px(16)
            .h(41)
            .pt(14)
            .pb(5)
            .flex_none()
            .items_center()
            .justify_between()
            .child(h_flex().gap(6).items_center()
              .child(div().text_size(11.5).font_medium().text_color(hasFocus ? t.accent : t.dim).when(hasFocus, d => d.font_semibold()).child("Agents"))
              .when(hasFocus, d => d.child(div().px(5).py(0.5).rounded(4).bg(t.raised).text_size(10).text_color(t.muted).child("j/k · l/Enter"))))
            .child(
              div()
                .id("ag-sort")
                .text_size(11)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click(() => openOverlay({ mod: "agents-vim", kind: "popup", width: 200, height: 140, props: { sortMenu: true } }))
                .tooltip(`Sort agents: ${sort.label}`)
                .child(svg(`mods/workspace-chrome/${sort.icon}.svg`).size(14)),
            ),
        ),
      )
      .when(list.length === 0 && !collapsed, (el) =>
        el.child(div().px(12).text_size(12).text_color(t.dim).child("No agent status yet. Agents show up here when they report their status. Older versions and agents inside tmux may not.")),
      )
      .child(v_flex().id("ag-list").flex_1().min_h(0).px(collapsed ? 0 : 8).overflow_y_scrollbar().mode("always").track_scroll(this.scroll).children(rows))
      .when(collapsed, (el) =>
        el.child(
          h_flex()
            .h(28)
            .items_center()
            .justify_center()
            .child(
              div()
                .id("collapse")
                .text_size(13)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click(toggleSidebar)
                .child("»"),
            ),
        ),
      );
  }
}
