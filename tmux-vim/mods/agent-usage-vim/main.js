import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, agents, terminals, focused, theme, exec, hc, appHome, window, checking } from "herdr";

const ICONS = {
  antigravity: { icon: "icons/antigravity.svg", tint: false },
  codex: { icon: "icons/codex.svg", tint: true },
  claude: { icon: "icons/claude.svg", tint: false },
};

function detectAgentKey(p, t, a, fg) {
  // Check live foreground process name first when available from `hc get`
  if (fg?.name) {
    const fgLow = `${fg.name} ${(fg.argv ?? []).join(" ")}`.toLowerCase();
    if (fgLow.includes("codex")) return "codex";
    if (fgLow.includes("claude")) return "claude";
    if (fgLow.includes("agy") || fgLow.includes("antigravity")) return "antigravity";
    // If foreground is explicitly a shell (pwsh, powershell, cmd, bash, zsh), no agent is running in the foreground
    if (/^(pwsh|powershell|cmd|bash|zsh|fish|nu|sh)(\.exe)?$/i.test(fg.name)) {
      return null;
    }
  }

  const raw = [
    p?.app,
    p?.program?.key,
    p?.program?.name,
    t?.agent,
    t?.status?.app,
    t?.program?.key,
    t?.foreground?.name,
    a?.app,
    a?.program?.key,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (raw.includes("codex")) return "codex";
  if (raw.includes("claude")) return "claude";
  if (raw.includes("antigravity") || raw.includes("agy")) return "antigravity";
  return null;
}

export default class AgentUsageBar extends View {
  init(_props, cx) {
    this.cache = {};
    this.fgInfo = {};
    this.lastSig = "";
    this.busy = false;
    this.pendingRefresh = false;
    if (checking()) return;
    this.refresh(cx);
    cx.timer.every(4000, (cx) => {
      if (window().active) this.refresh(cx);
    });
  }

  target() {
    const f = focused();
    const allPanes = panes();
    const allTerms = terminals();
    const allAgents = agents();
    const termMap = new Map(allTerms.map((t) => [t.address, t]));
    const agentMap = new Map(allAgents.map((a) => [a.address, a]));

    const activeSpace = spaces().find((s) => s.active);
    const activeTab = activeSpace?.tabs?.find((tb) => tb.active);
    const tabId = f?.tab ?? activeTab?.id ?? null;

    // 1. Currently focused terminal/pane in the active tab
    const focusedPane =
      (f?.pane && allPanes.find((p) => p.pane === f.pane)) ||
      (tabId && allPanes.find((p) => p.tab === tabId && p.focused)) ||
      allPanes.find((p) => p.focused) ||
      (tabId && allPanes.find((p) => p.tab === tabId)) ||
      null;

    const focusedTermAddr = f?.shown ?? f?.terminal ?? focusedPane?.terminal ?? null;
    if (focusedTermAddr) {
      const p = allPanes.find((x) => x.terminal === focusedTermAddr) ?? focusedPane;
      const t = termMap.get(focusedTermAddr);
      const a = agentMap.get(focusedTermAddr);
      const fg = this.fgInfo[focusedTermAddr];
      const key = detectAgentKey(p, t, a, fg);
      if (key) {
        return {
          terminal: focusedTermAddr,
          agent: key,
          cwd: fg?.cwd ?? p?.cwd ?? t?.cwd ?? f?.cwd ?? activeSpace?.folder ?? "",
          pid: fg?.pid ?? null,
          argv: fg?.argv ?? null,
          program: p?.program ?? a?.program ?? t?.program ?? null,
        };
      }
    }

    // 2. Any other agent pane in the SAME active tab (e.g., when split alongside a shell)
    if (tabId) {
      const tabPanes = allPanes.filter((p) => p.tab === tabId && p.terminal && p.terminal !== focusedTermAddr);
      for (const p of tabPanes) {
        const t = termMap.get(p.terminal);
        const a = agentMap.get(p.terminal);
        const fg = this.fgInfo[p.terminal];
        const key = detectAgentKey(p, t, a, fg);
        if (key) {
          return {
            terminal: p.terminal,
            agent: key,
            cwd: fg?.cwd ?? p.cwd ?? t?.cwd ?? activeSpace?.folder ?? "",
            pid: fg?.pid ?? null,
            argv: fg?.argv ?? null,
            program: p.program ?? a?.program ?? t?.program ?? null,
          };
        }
      }
    }

    // No active agent in the current tab
    return {
      terminal: focusedTermAddr ?? null,
      agent: null,
      cwd: (focusedTermAddr && this.fgInfo[focusedTermAddr]?.cwd) ?? focusedPane?.cwd ?? f?.cwd ?? activeSpace?.folder ?? "",
      pid: null,
      argv: null,
      program: null,
    };
  }

  collectCandidateTerminals() {
    const f = focused();
    const allPanes = panes();
    const allAgents = agents();
    const addrs = new Set();

    if (f?.shown) addrs.add(f.shown);
    if (f?.terminal) addrs.add(f.terminal);
    for (const p of allPanes) {
      if (p.terminal) addrs.add(p.terminal);
    }
    for (const a of allAgents) {
      if (a.address) addrs.add(a.address);
    }
    return Array.from(addrs).filter((addr) => addr && !addr.includes("/"));
  }

  refresh(cx) {
    if (checking()) return;
    if (this.busy) {
      this.pendingRefresh = true;
      return;
    }
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const addrs = this.collectCandidateTerminals();
        for (const addr of addrs) {
          try {
            const r = await hc(["get", addr, "--json"]);
            if (r.code === 0 && r.stdout) {
              const info = JSON.parse(r.stdout);
              if (info?.foreground) {
                this.fgInfo[addr] = info.foreground;
              }
            }
          } catch {
            // ignore individual hc get error
          }
        }

        const allPanes = panes();
        const allTerms = terminals();
        const allAgents = agents();
        const termMap = new Map(allTerms.map((t) => [t.address, t]));
        const agentMap = new Map(allAgents.map((a) => [a.address, a]));

        const reqList = [];
        for (const addr of addrs) {
          const p = allPanes.find((x) => x.terminal === addr);
          const t = termMap.get(addr);
          const a = agentMap.get(addr);
          const fg = this.fgInfo[addr];
          const key = detectAgentKey(p, t, a, fg);
          if (key) {
            reqList.push({
              terminal: addr,
              agent: key,
              cwd: fg?.cwd ?? p?.cwd ?? t?.cwd ?? "",
              pid: fg?.pid ?? null,
              argv: fg?.argv ?? null,
            });
          }
        }

        if (reqList.length > 0) {
          const scriptPath = `${appHome()}/mods/agent-usage-vim/query.py`;
          const res = await exec("python", [scriptPath, JSON.stringify(reqList)], { timeout: 5000 });
          if (res.code === 0 && res.stdout) {
            const parsed = JSON.parse(res.stdout.trim());
            if (parsed && typeof parsed === "object") {
              this.cache = { ...this.cache, ...parsed };
            }
          }
        }
        cx.notify();
      } catch {
        // ignore transient errors
      } finally {
        this.busy = false;
        if (this.pendingRefresh) {
          this.pendingRefresh = false;
          this.refresh(cx);
        }
      }
    });
  }

  renderIcon(t, agentKey, prog) {
    const spec = (prog?.icon ? { icon: prog.icon, tint: prog.tint } : null) ?? ICONS[agentKey] ?? ICONS.antigravity;
    if (!spec?.icon) return null;
    return spec.tint
      ? svg(spec.icon).size(13).flex_none().text_color(t.muted)
      : image(spec.icon).w(13).h(13).flex_none();
  }

  render(cx) {
    const t = theme();
    const cur = this.target();
    const allTerms = terminals();
    const termObj = cur.terminal ? allTerms.find((x) => x.address === cur.terminal) : null;
    const sig = `${cur.terminal ?? "none"}:${cur.agent ?? "none"}:${cur.cwd}:${cur.pid ?? 0}:${termObj?.turn ?? 0}:${termObj?.status ?? ""}`;
    if (sig !== this.lastSig && !checking()) {
      this.lastSig = sig;
      this.refresh(cx);
    }

    if (!cur.agent || !cur.terminal) {
      return h_flex()
        .id("agent-usage-bar")
        .size_full()
        .px(14)
        .gap(8)
        .items_center()
        .bg(t.chrome)
        .border_t(1)
        .border_color(t.border)
        .text_size(11.5)
        .text_color(t.dim)
        .on_click((_e, cx) => this.refresh(cx))
        .child("No active agent in this tab");
    }

    const data = this.cache[cur.terminal] ?? null;
    const agentKey = data?.agent_key ?? cur.agent;
    const modelLabel = data?.model ? `${data.agent} · ${data.model}` : cur.agent === "codex" ? "Codex" : cur.agent === "claude" ? "Claude Code" : "Antigravity";
    const ctxVal = data?.context_value ?? "loading…";
    const limitItems = Array.isArray(data?.limit_items) && data.limit_items.length ? data.limit_items : [{ text: "loading…", pct: null }];

    const ctxPct = data?.context_pct ?? 0;
    const ctxColor = ctxPct >= 85 ? t.blocked : ctxPct >= 60 ? (t.working ?? t.ansi3) : t.muted;

    const itemColor = (pct) => (pct != null && pct <= 5 ? t.blocked : pct != null && pct <= 20 ? (t.working ?? t.ansi3) : t.muted);

    const pic = this.renderIcon(t, agentKey, cur.program);

    const rightChildren = [div().text_color(t.dim).child("Limit:")];
    limitItems.forEach((item, idx) => {
      if (idx > 0) rightChildren.push(div().text_color(t.dim).child("·"));
      rightChildren.push(div().text_color(itemColor(item.pct)).child(item.text));
    });

    return h_flex()
      .id("agent-usage-bar")
      .size_full()
      .px(14)
      .gap(16)
      .items_center()
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(11.5)
      .text_color(t.muted)
      .on_click((_e, cx) => this.refresh(cx))
      .child(
        h_flex()
          .gap(6)
          .items_center()
          .flex_none()
          .when(Boolean(pic), (el) => el.child(pic))
          .child(div().text_color(t.foreground).font_medium().child(modelLabel))
          .child(div().text_color(t.dim).child("·"))
          .child(div().text_color(t.dim).child("Context:"))
          .child(div().text_color(ctxColor).child(ctxVal)),
      )
      .child(
        h_flex()
          .gap(6)
          .items_center()
          .flex_none()
          .children(rightChildren),
      );
  }
}
