import json
import os
import re
import struct
import uuid
import zlib
from pathlib import Path

from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

BASE_DIR = Path(__file__).parent
CONFIG_FILE = BASE_DIR / "config.json"

SUPPORTED_PROVIDERS = ["anthropic", "openai"]

DEFAULT_CONFIG = {
    "vault_path": "",
    "active_provider": "anthropic",
    "api_keys": {"anthropic": "", "openai": ""},
}


# ── Config ──────────────────────────────────────────────────────────

def load_config():
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE) as f:
            cfg = json.load(f)
        # Migrate old single-key format
        if "anthropic_api_key" in cfg and "api_keys" not in cfg:
            old_key = cfg.pop("anthropic_api_key", "")
            cfg["api_keys"] = {"anthropic": old_key, "openai": ""}
        cfg.setdefault("active_provider", "anthropic")
        cfg.setdefault("api_keys", {"anthropic": "", "openai": ""})
        for p in SUPPORTED_PROVIDERS:
            cfg["api_keys"].setdefault(p, "")
        return cfg
    return DEFAULT_CONFIG.copy()


def save_config(cfg):
    with open(CONFIG_FILE, "w") as f:
        json.dump(cfg, f, indent=2)


# ── AI generation ────────────────────────────────────────────────────

def generate_with_ai(provider, api_key, prompt, max_tokens=2000, fast=False):
    if provider == "anthropic":
        import anthropic as anthropic_sdk
        client = anthropic_sdk.Anthropic(api_key=api_key)
        model = "claude-haiku-4-5-20251001" if fast else "claude-sonnet-4-6"
        msg = client.messages.create(
            model=model, max_tokens=max_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
        return msg.content[0].text.strip()
    elif provider == "openai":
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        model = "gpt-4o-mini" if fast else "gpt-4o"
        resp = client.chat.completions.create(
            model=model, max_tokens=max_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
        return resp.choices[0].message.content.strip()
    else:
        raise ValueError(f"Unsupported provider: {provider}")


# ── Helpers ─────────────────────────────────────────────────────────

def slugify(text):
    s = re.sub(r"[^\w\s-]", "", str(text).lower())
    return re.sub(r"[\s_-]+", "-", s).strip("-")


def cards_file_path(vault_path, rel_file_path, section_slug):
    cards_dir = Path(vault_path) / "_cards"
    file_slug = slugify(
        str(Path(rel_file_path).with_suffix("")).replace("/", "-").replace("\\", "-")
    )
    return cards_dir / f"{file_slug}__{section_slug}.json"


def load_cards_file(filepath):
    if Path(filepath).exists():
        with open(filepath) as f:
            return json.load(f)
    return {"generated": [], "user_created": []}


def save_cards_file(filepath, data):
    Path(filepath).parent.mkdir(parents=True, exist_ok=True)
    with open(filepath, "w") as f:
        json.dump(data, f, indent=2)


def stats_path(vault_path):
    return Path(vault_path) / "_cards" / "stats.json"


def load_stats(vault_path):
    sp = stats_path(vault_path)
    if sp.exists():
        with open(sp) as f:
            return json.load(f)
    return {}


def save_stats(vault_path, stats):
    sp = stats_path(vault_path)
    sp.parent.mkdir(parents=True, exist_ok=True)
    with open(sp, "w") as f:
        json.dump(stats, f, indent=2)


# ── Vault scanning ───────────────────────────────────────────────────

def parse_sections(md_file):
    try:
        content = Path(md_file).read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return []

    sections = []
    current = None
    current_lines = []

    for line in content.splitlines():
        m2 = re.match(r"^## (.+)$", line)
        m3 = re.match(r"^### (.+)$", line)
        header = m2 or m3

        if header:
            if current is not None:
                current["content"] = "\n".join(current_lines).strip()
                if current["content"]:
                    sections.append(current)
            heading = header.group(1).strip()
            current = {
                "heading": heading,
                "level": 2 if m2 else 3,
                "slug": slugify(heading),
            }
            current_lines = []
        elif current is not None:
            current_lines.append(line)

    if current is not None:
        current["content"] = "\n".join(current_lines).strip()
        if current["content"]:
            sections.append(current)

    return sections


def scan_dir(directory, vault_root):
    result = []
    for item in sorted(directory.iterdir()):
        if item.name.startswith("_") or item.name.startswith("."):
            continue
        if item.is_dir():
            children = scan_dir(item, vault_root)
            if children:
                result.append({
                    "type": "folder",
                    "name": item.name,
                    "path": str(item.relative_to(vault_root)),
                    "slug": slugify(item.name),
                    "children": children,
                })
        elif item.suffix == ".md":
            sections = parse_sections(item)
            if not sections:
                continue
            result.append({
                "type": "file",
                "name": item.stem,
                "path": str(item.relative_to(vault_root)),
                "slug": slugify(item.stem),
                "sections": sections,
            })
    return result


def scan_vault(vault_path):
    vault = Path(vault_path)
    if not vault.exists():
        return []
    return scan_dir(vault, vault)


def annotate_has_cards(tree, vault_path):
    for node in tree:
        if node["type"] == "folder":
            annotate_has_cards(node["children"], vault_path)
        else:
            for section in node.get("sections", []):
                fp = cards_file_path(vault_path, node["path"], section["slug"])
                data = load_cards_file(fp)
                section["has_cards"] = bool(
                    data.get("generated") or data.get("user_created")
                )
    return tree


# ── Icon generation (pure stdlib, no PIL) ───────────────────────────

def _png_chunk(chunk_type, data):
    crc = zlib.crc32(chunk_type + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + chunk_type + data + struct.pack(">I", crc)


def create_solid_png(size, r, g, b):
    header = b"\x89PNG\r\n\x1a\n"
    ihdr = _png_chunk(
        b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    )
    row = b"\x00" + bytes([r, g, b] * size)
    idat = _png_chunk(b"IDAT", zlib.compress(row * size))
    iend = _png_chunk(b"IEND", b"")
    return header + ihdr + idat + iend


def ensure_icons():
    icons_dir = BASE_DIR / "static" / "icons"
    icons_dir.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        icon_path = icons_dir / f"icon-{size}.png"
        if not icon_path.exists():
            icon_path.write_bytes(create_solid_png(size, 79, 110, 247))  # #4f6ef7


# ── Routes ───────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/config", methods=["GET"])
def get_config():
    cfg = load_config()
    keys_set = {p: bool(cfg["api_keys"].get(p, "").strip()) for p in SUPPORTED_PROVIDERS}
    return jsonify({
        "vault_path": cfg.get("vault_path", ""),
        "active_provider": cfg.get("active_provider", "anthropic"),
        "keys_set": keys_set,
    })


@app.route("/api/config", methods=["POST"])
def set_config():
    cfg = load_config()
    data = request.json or {}
    if "vault_path" in data:
        cfg["vault_path"] = data["vault_path"]
    if "active_provider" in data and data["active_provider"] in SUPPORTED_PROVIDERS:
        cfg["active_provider"] = data["active_provider"]
    for provider, key in (data.get("api_keys") or {}).items():
        if provider in SUPPORTED_PROVIDERS and key.strip():
            cfg["api_keys"][provider] = key.strip()
    save_config(cfg)
    keys_set = {p: bool(cfg["api_keys"].get(p, "").strip()) for p in SUPPORTED_PROVIDERS}
    return jsonify({"ok": True, "keys_set": keys_set})


@app.route("/api/test-vault-path")
def test_vault_path():
    path = request.args.get("path", "").strip()
    if not path:
        return jsonify({"ok": False, "error": "No path provided"})
    p = Path(path)
    if not p.exists():
        return jsonify({"ok": False, "error": "Path does not exist"})
    if not p.is_dir():
        return jsonify({"ok": False, "error": "Not a directory"})
    md_count = sum(1 for _ in p.rglob("*.md"))
    return jsonify({"ok": True, "md_count": md_count})


@app.route("/api/browse")
def browse_dirs():
    req_path = request.args.get("path", "").strip()
    p = Path(req_path) if req_path else Path.home()
    if not p.exists() or not p.is_dir():
        p = Path.home()

    dirs = []
    try:
        for item in sorted(p.iterdir()):
            if item.is_dir() and not item.name.startswith("."):
                dirs.append({"name": item.name, "path": str(item)})
    except PermissionError:
        pass

    parent = str(p.parent) if p != p.parent else None
    return jsonify({"current": str(p), "parent": parent, "dirs": dirs})


@app.route("/api/vault")
def vault_scan():
    cfg = load_config()
    vault_path = cfg.get("vault_path", "")
    if not vault_path or not Path(vault_path).exists():
        return jsonify({"error": "Vault path not set or not found"}), 400
    tree = scan_vault(vault_path)
    tree = annotate_has_cards(tree, vault_path)
    return jsonify(tree)


@app.route("/api/section")
def get_section():
    cfg = load_config()
    vault_path = cfg.get("vault_path", "")
    file_path = request.args.get("path", "")
    heading = request.args.get("heading", "")

    if not vault_path or not file_path:
        return jsonify({"error": "Missing params"}), 400

    full_path = Path(vault_path) / file_path
    if not full_path.exists():
        return jsonify({"error": "File not found"}), 404

    sections = parse_sections(full_path)
    section = next((s for s in sections if s["heading"] == heading), None)
    if not section:
        return jsonify({"error": "Section not found"}), 404

    return jsonify(section)


@app.route("/api/cards")
def get_cards():
    cfg = load_config()
    vault_path = cfg.get("vault_path", "")
    file_path = request.args.get("path", "")
    section_slug = request.args.get("section_slug", "")

    if not vault_path or not file_path or not section_slug:
        return jsonify({"error": "Missing params"}), 400

    fp = cards_file_path(vault_path, file_path, section_slug)
    data = load_cards_file(fp)
    stats = load_stats(vault_path)

    for card in data.get("generated", []) + data.get("user_created", []):
        card["stats"] = stats.get(card.get("id", ""), {"seen": 0, "missed": 0})

    return jsonify(data)


@app.route("/api/cards", methods=["POST"])
def save_cards():
    cfg = load_config()
    vault_path = cfg.get("vault_path", "")
    data = request.json or {}
    file_path = data.get("path", "")
    section_slug = data.get("section_slug", "")

    if not vault_path or not file_path or not section_slug:
        return jsonify({"error": "Missing params"}), 400

    fp = cards_file_path(vault_path, file_path, section_slug)
    existing = load_cards_file(fp)
    action = data.get("action")

    if action == "add_user":
        card = data.get("card", {})
        card["id"] = str(uuid.uuid4())
        card["user_created"] = True
        existing.setdefault("user_created", []).append(card)

    elif action == "edit":
        card_id = data.get("card_id")
        updates = data.get("updates", {})
        for arr in ("generated", "user_created"):
            for card in existing.get(arr, []):
                if card.get("id") == card_id:
                    card.update({k: v for k, v in updates.items() if k != "id"})
                    break

    elif action == "delete":
        card_id = data.get("card_id")
        for arr in ("generated", "user_created"):
            existing[arr] = [c for c in existing.get(arr, []) if c.get("id") != card_id]

    save_cards_file(fp, existing)
    return jsonify({"ok": True})


@app.route("/api/generate-cards", methods=["POST"])
def generate_cards():
    cfg = load_config()
    provider = cfg.get("active_provider", "anthropic")
    api_key = cfg.get("api_keys", {}).get(provider, "").strip()
    vault_path = cfg.get("vault_path", "")

    if not api_key:
        return jsonify({"error": f"No {provider} API key configured. Add it in Settings."}), 400

    data = request.json or {}
    file_path = data.get("path", "")
    section_slug = data.get("section_slug", "")
    heading = data.get("heading", "")
    content = data.get("content", "").strip()

    if not content:
        return jsonify({"error": "Section has no content to generate cards from"}), 400

    prompt = (
        "You are creating Anki-style flashcards from study notes. "
        "Generate 6-10 high-quality cards from the section below.\n\n"
        f"Section heading: {heading}\n\n"
        f"Content:\n{content}\n\n"
        "Generate a mix of:\n"
        "1. Cloze/fill-in-the-blank cards (most common): "
        'front has a sentence with {blank} where the answer goes, '
        "back is just the answer, extra provides context\n"
        "2. Multiple-choice cards (2-3 max): front is a question, "
        "options array has 4 choices, correct_index is 0-3, extra provides explanation\n\n"
        'Tag each card as one of: "definition", "process", or "scenario"\n\n'
        "Return ONLY a valid JSON array with this exact schema:\n"
        "[\n"
        '  {"type":"cloze","tag":"definition","front":"The {blank} is...","back":"answer","extra":"context"},\n'
        '  {"type":"multiple_choice","tag":"process","front":"What happens when...?","options":["A","B","C","D"],"correct_index":2,"extra":"explanation"}\n'
        "]\n\n"
        "Rules:\n"
        "- Cards must be self-contained and answerable without external context\n"
        "- Cloze fronts must have exactly one {blank} placeholder\n"
        "- Focus on testable facts, definitions, processes, and key concepts\n"
        "- Return ONLY the JSON array, no other text"
    )

    try:
        response_text = generate_with_ai(provider, api_key, prompt, max_tokens=2000)
    except Exception as e:
        return jsonify({"error": f"AI generation failed: {e}"}), 500

    match = re.search(r"\[.*\]", response_text, re.DOTALL)
    if not match:
        return jsonify({"error": "Failed to parse cards from AI response"}), 500

    try:
        cards_raw = json.loads(match.group())
    except json.JSONDecodeError as e:
        return jsonify({"error": f"Invalid JSON from AI: {e}"}), 500

    source = f"{file_path}::{heading}"
    generated = []
    for card in cards_raw:
        card["id"] = str(uuid.uuid4())
        card["source"] = source
        card["user_created"] = False
        generated.append(card)

    fp = cards_file_path(vault_path, file_path, section_slug)
    existing = load_cards_file(fp)
    existing["generated"] = generated
    save_cards_file(fp, existing)

    return jsonify({"cards": generated, "count": len(generated)})


@app.route("/api/stats", methods=["GET"])
def get_stats():
    cfg = load_config()
    return jsonify(load_stats(cfg.get("vault_path", "")))


@app.route("/api/stats", methods=["POST"])
def update_stats():
    cfg = load_config()
    vault_path = cfg.get("vault_path", "")
    updates = request.json or {}
    stats = load_stats(vault_path)
    for card_id, new_data in updates.items():
        stats[card_id] = new_data
    save_stats(vault_path, stats)
    return jsonify({"ok": True})


@app.route("/api/explain", methods=["POST"])
def explain_card():
    cfg = load_config()
    provider = cfg.get("active_provider", "anthropic")
    api_key = cfg.get("api_keys", {}).get(provider, "").strip()
    if not api_key:
        return jsonify({"error": f"No {provider} API key configured. Add it in Settings."}), 400

    data = request.json or {}
    card_type = data.get("type", "cloze")
    front = data.get("front", "")
    back = data.get("back", "")
    extra = data.get("extra", "")
    options = data.get("options", [])
    correct_index = data.get("correct_index", 0)

    if card_type == "cloze":
        q = front.replace("{blank}", "___")
        prompt = (
            f"Flashcard question: {q}\n"
            f"Answer: {back}\n"
            + (f"Context: {extra}\n" if extra else "")
            + "\nIn 2-3 sentences, explain WHY this is the answer and give one memorable hook to remember it. Be concise and direct."
        )
    else:
        opts = "\n".join(f"{chr(65 + i)}. {o}" for i, o in enumerate(options))
        correct = options[correct_index] if 0 <= correct_index < len(options) else ""
        prompt = (
            f"Flashcard question: {front}\n"
            f"Options:\n{opts}\n"
            f"Correct answer: {correct}\n"
            + (f"Context: {extra}\n" if extra else "")
            + "\nIn 2-3 sentences, explain WHY this is correct and give one memorable hook to remember it. Be concise and direct."
        )

    try:
        explanation = generate_with_ai(provider, api_key, prompt, max_tokens=250, fast=True)
    except Exception as e:
        return jsonify({"error": f"AI explanation failed: {e}"}), 500

    return jsonify({"explanation": explanation})


@app.route("/api/weak-cards")
def get_weak_cards():
    cfg = load_config()
    vault_path = cfg.get("vault_path", "")
    if not vault_path:
        return jsonify({"error": "No vault path configured"}), 400

    stats = load_stats(vault_path)
    cards_dir = Path(vault_path) / "_cards"
    if not cards_dir.exists():
        return jsonify([])

    all_cards = []
    for json_file in sorted(cards_dir.glob("*.json")):
        if json_file.name == "stats.json":
            continue
        try:
            with open(json_file) as f:
                data = json.load(f)
        except Exception:
            continue
        for card in data.get("generated", []) + data.get("user_created", []):
            card_id = card.get("id", "")
            s = stats.get(card_id, {})
            seen = s.get("seen", 0)
            if seen == 0:
                continue
            missed = s.get("missed", 0)
            lapses = s.get("lapses", 0)
            ease = s.get("ease", 2.5)
            missed_rate = missed / seen
            weakness = (missed_rate * 2) + (lapses * 0.5) + max(0, 2.5 - ease)
            if weakness <= 0:
                continue
            card["stats"] = s
            card["weakness"] = round(weakness, 3)
            card["missed_rate"] = round(missed_rate, 3)
            all_cards.append(card)

    all_cards.sort(key=lambda c: c.get("weakness", 0), reverse=True)
    return jsonify(all_cards[:50])


if __name__ == "__main__":
    ensure_icons()
    app.run(debug=True, host='0.0.0.0', port=5000)
