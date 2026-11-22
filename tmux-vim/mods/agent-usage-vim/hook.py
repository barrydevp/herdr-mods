import sys
import json
import os
import re
import time
import hashlib
import glob

HOME = os.path.expanduser("~")
AGY_DIR = os.path.join(HOME, ".gemini", "antigravity-cli")
CLAUDE_DIR = os.path.join(HOME, ".claude")
OUT_DIR = os.path.join(HOME, ".config", "herdr-app", "data", "agent-usage")


def clean_line(text, max_len=60):
    if not text:
        return ""
    line = " ".join(str(text).strip().split())
    if line.startswith("/") and " " in line:
        line = line.lstrip("/")
    if len(line) > max_len:
        line = line[: max_len - 1].rstrip() + "…"
    return line


def extract_agy_first_prompt(cid, transcript_path=None):
    paths = []
    if cid:
        paths.append(os.path.join(AGY_DIR, "brain", cid, ".system_generated", "logs", "transcript.jsonl"))
    if transcript_path:
        paths.append(transcript_path)
        paths.append(transcript_path.replace("\\antigravity\\", "\\antigravity-cli\\").replace("/antigravity/", "/antigravity-cli/"))
    for p in paths:
        if not p or not os.path.exists(p):
            continue
        try:
            with open(p, "r", encoding="utf-8", errors="ignore") as f:
                for idx, raw_line in enumerate(f):
                    if idx > 20:
                        break
                    d = json.loads(raw_line)
                    if d.get("type") == "USER_INPUT":
                        content = d.get("content") or ""
                        m = re.search(r"<USER_REQUEST>\s*(.*?)\s*</USER_REQUEST>", content, re.S)
                        txt = m.group(1) if m else content
                        for ln in txt.splitlines():
                            ln = ln.strip()
                            if ln:
                                return clean_line(ln)
        except Exception:
            pass
    return ""


def claude_project_slug(cwd):
    # Claude Code names a project's folder after its path, every non-alphanumeric as "-".
    if not cwd:
        return ""
    p = str(cwd).strip().rstrip("\\/")
    return re.sub(r"[^A-Za-z0-9]", "-", p)


def extract_claude_session_title(data, cwd):
    s_name = clean_line(data.get("session_name") or "")
    if s_name and s_name.lower() != "claude code":
        return s_name

    t_path = data.get("transcript_path") or ""
    sid = data.get("session_id") or (data.get("remote") or {}).get("session_id") or ""
    if (not t_path or not os.path.exists(t_path)) and sid and cwd:
        slug = claude_project_slug(cwd)
        cand = os.path.join(CLAUDE_DIR, "projects", slug, f"{sid}.jsonl")
        if os.path.exists(cand):
            t_path = cand
    if (not t_path or not os.path.exists(t_path)) and cwd:
        slug = claude_project_slug(cwd)
        proj_dir = os.path.join(CLAUDE_DIR, "projects", slug)
        if os.path.isdir(proj_dir):
            files = sorted(glob.glob(os.path.join(proj_dir, "*.jsonl")), key=os.path.getmtime, reverse=True)
            if files:
                t_path = files[0]

    if t_path and os.path.exists(t_path):
        try:
            size = os.path.getsize(t_path)
            with open(t_path, "rb") as f:
                if size > 65536:
                    f.seek(size - 65536)
                    lines = f.read().decode("utf-8", errors="ignore").splitlines()[1:]
                else:
                    lines = f.read().decode("utf-8", errors="ignore").splitlines()

            custom_title = ""
            ai_title = ""
            summary_title = ""
            last_prompt = ""
            last_user_msg = ""

            for line in reversed(lines):
                try:
                    d = json.loads(line)
                    t = d.get("type")
                    if t == "system" and d.get("subtype") == "local_command":
                        cmd_run = d.get("commandRun") or {}
                        if cmd_run.get("command") == "clear":
                            break
                    if not custom_title and t == "custom-title":
                        custom_title = clean_line(d.get("customTitle"))
                    elif not ai_title and t == "ai-title":
                        ai_title = clean_line(d.get("aiTitle"))
                    elif not summary_title and t == "summary":
                        summary_title = clean_line(d.get("summary"))
                    elif not last_prompt and t == "last-prompt":
                        lp = (d.get("lastPrompt") or "").strip()
                        if lp and not lp.startswith("/"):
                            last_prompt = clean_line(lp.splitlines()[0])
                    elif not last_user_msg and t == "user" and not d.get("isMeta"):
                        msg = d.get("message") or {}
                        content = msg.get("content")
                        if isinstance(content, str):
                            txt = content.strip()
                            if txt and not txt.startswith("<") and not txt.startswith("/"):
                                last_user_msg = clean_line(txt.splitlines()[0])
                except Exception:
                    pass

            for cand in (custom_title, ai_title, summary_title, last_user_msg, last_prompt):
                if cand:
                    return cand
        except Exception:
            pass
    return ""


def resolve_title(data, prefix, cwd):
    base = os.path.basename(cwd.rstrip("\\/")) if cwd else ""
    if prefix == "agy":
        title = clean_line(data.get("conversation_title") or "")
        if not title:
            cid = data.get("conversation_id") or data.get("session_id") or ""
            title = extract_agy_first_prompt(cid, data.get("transcript_path"))
        return title or base or "Antigravity"
    else:
        title = extract_claude_session_title(data, cwd)
        return title or base or "Claude Code"


def set_terminal_title(title):
    if not title:
        return
    safe = "".join(ch for ch in str(title) if ord(ch) >= 32 and ch not in "\x07\x1b").strip()
    if not safe:
        return
    try:
        # The agent's own terminal: its console on Windows, its tty elsewhere.
        with open("CONOUT$" if os.name == "nt" else "/dev/tty", "w", encoding="utf-8") as con:
            con.write(f"\x1b]2;{safe}\x07")
            con.flush()
    except Exception:
        pass


def prune(max_age=7 * 86400):
    # Statuslines run every few seconds: look for week-old session files at most hourly.
    marker = os.path.join(OUT_DIR, ".pruned")
    now = time.time()
    try:
        if now - os.path.getmtime(marker) < 3600:
            return
    except OSError:
        pass
    try:
        for e in os.scandir(OUT_DIR):
            if e.name.endswith(".json") and not e.name.endswith("-latest.json") and now - e.stat().st_mtime > max_age:
                os.remove(e.path)
        with open(marker, "w"):
            pass
    except OSError:
        pass


def main():
    try:
        raw = sys.stdin.read()
        if not raw or not raw.strip():
            return
        data = json.loads(raw)
        data["_updated_at"] = time.time()
        term_id = os.environ.get("HC_TERMINAL_ID") or ""
        data["_hc_terminal_id"] = term_id

        os.makedirs(OUT_DIR, exist_ok=True)
        prune()

        product = (data.get("product") or "").lower()
        prefix = "agy" if ("antigravity" in product or "quota" in data or "conversation_id" in data) else "claude"

        raw_cwd = (data.get("workspace") or {}).get("current_dir") or data.get("cwd") or ""
        title = resolve_title(data, prefix, raw_cwd)
        if title:
            data["_resolved_title"] = title
            set_terminal_title(title)

        cid = data.get("conversation_id") or data.get("session_id") or ""
        if cid:
            with open(os.path.join(OUT_DIR, f"{prefix}-conv-{cid}.json"), "w", encoding="utf-8") as f:
                json.dump(data, f)
        if term_id:
            with open(os.path.join(OUT_DIR, f"{prefix}-term-{term_id}.json"), "w", encoding="utf-8") as f:
                json.dump(data, f)
        cwd_low = raw_cwd.lower().rstrip("\\/")
        if cwd_low:
            h = hashlib.md5(cwd_low.encode("utf-8")).hexdigest()[:12]
            with open(os.path.join(OUT_DIR, f"{prefix}-cwd-{h}.json"), "w", encoding="utf-8") as f:
                json.dump(data, f)
        with open(os.path.join(OUT_DIR, f"{prefix}-latest.json"), "w", encoding="utf-8") as f:
            json.dump(data, f)

        if "--title" in sys.argv and title:
            sys.stdout.write(title)
            sys.stdout.flush()
    except Exception:
        pass


if __name__ == "__main__":
    main()
