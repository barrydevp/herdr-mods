import sys
import json
import os
import time
import hashlib

def main():
    try:
        raw = sys.stdin.read()
        if not raw or not raw.strip():
            return
        data = json.loads(raw)
        data["_updated_at"] = time.time()
        term_id = os.environ.get("HC_TERMINAL_ID") or ""
        data["_hc_terminal_id"] = term_id

        out_dir = os.path.expanduser("~/.config/herdr-app/data/agent-usage")
        os.makedirs(out_dir, exist_ok=True)

        product = (data.get("product") or "").lower()
        prefix = "agy" if "antigravity" in product or "quota" in data else "claude"

        cid = data.get("conversation_id") or data.get("session_id") or ""
        if cid:
            with open(os.path.join(out_dir, f"{prefix}-conv-{cid}.json"), "w", encoding="utf-8") as f:
                json.dump(data, f)
        if term_id:
            with open(os.path.join(out_dir, f"{prefix}-term-{term_id}.json"), "w", encoding="utf-8") as f:
                json.dump(data, f)
        cwd = ((data.get("workspace") or {}).get("current_dir") or data.get("cwd") or "").lower().rstrip("\\/")
        if cwd:
            h = hashlib.md5(cwd.encode("utf-8")).hexdigest()[:12]
            with open(os.path.join(out_dir, f"{prefix}-cwd-{h}.json"), "w", encoding="utf-8") as f:
                json.dump(data, f)
        with open(os.path.join(out_dir, f"{prefix}-latest.json"), "w", encoding="utf-8") as f:
            json.dump(data, f)
    except Exception:
        pass

if __name__ == "__main__":
    main()
