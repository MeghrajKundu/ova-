from flask import Flask, render_template, request, jsonify, Response, stream_with_context
from groq import Groq
from dotenv import load_dotenv

import sqlite3
import os
import sys
import json
import uuid
import subprocess
from datetime import datetime

from services.search import search_tavily, needs_web_search, is_news_query
from services.memory import (
    get_all_memories,
    add_memory,
    delete_memory,
    clear_all_memories,
    extract_memory_from_message,
    format_memory_prompt
)
from services.files import (
    save_uploaded_file,
    read_file,
    limit_text
)

# ============================================================
# OVA - CONFIGURATION & CLIENT
# ============================================================

load_dotenv()

app = Flask(__name__)

DATABASE = "chat_history.db"

DEFAULT_MODEL = "openai/gpt-oss-120b"

AVAILABLE_MODELS = [
    {
        "id": "openai/gpt-oss-120b",
        "name": "GPT-OSS 120B",
        "tag": "Flagship",
        "desc": "Deep multi-step reasoning, high intelligence & coding"
    },
    {
        "id": "qwen/qwen3.8-27b",
        "name": "Qwen 3.8 27B",
        "tag": "Ultra-Fast",
        "desc": "Lightning fast coding, math & reasoning"
    },
    {
        "id": "groq/compound",
        "name": "Compound Web",
        "tag": "Composite",
        "desc": "Automated web browsing and multi-agent synthesis"
    },
    {
        "id": "openai/gpt-oss-20b",
        "name": "GPT-OSS 20B",
        "tag": "Lightweight",
        "desc": "Ultra-efficient for rapid chat & summaries"
    }
]

# Safety limits & Model TPM (Tokens Per Minute) Quotas on Groq Free/On-Demand Tier
MODEL_TPM_LIMITS = {
    "openai/gpt-oss-120b": 8000,
    "qwen/qwen3.8-27b": 8000,
    "openai/gpt-oss-20b": 8000,
    "groq/compound": 70000,
}

MAX_MESSAGE_LENGTH = 12000
MAX_HISTORY_LENGTH = 20000

def estimate_tokens(text: str) -> int:
    """Fast, conservative token estimation (~3.2 characters per token)."""
    if not text:
        return 0
    return max(1, int(len(text) / 3.2))

api_key = os.getenv("GROQ_API_KEY")
if not api_key:
    raise RuntimeError("GROQ_API_KEY is missing from .env")

client = Groq(api_key=api_key)

# ============================================================
# DATABASE SETUP & HELPERS
# ============================================================

def get_db():
    db = sqlite3.connect(DATABASE, timeout=10)
    db.row_factory = sqlite3.Row
    return db

def current_time():
    return datetime.utcnow().isoformat()

def create_database():
    db = get_db()
    db.execute("""
        CREATE TABLE IF NOT EXISTS chats (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    db.execute("""
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    """)
    db.execute("""
        CREATE TABLE IF NOT EXISTS memories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    """)
    db.commit()
    db.close()

create_database()

def create_chat(title="New Chat"):
    chat_id = str(uuid.uuid4())
    timestamp = current_time()
    db = get_db()
    db.execute(
        "INSERT INTO chats (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
        (chat_id, title, timestamp, timestamp)
    )
    db.commit()
    db.close()
    return chat_id

def chat_exists(chat_id):
    db = get_db()
    row = db.execute("SELECT id FROM chats WHERE id = ?", (chat_id,)).fetchone()
    db.close()
    return row is not None

def save_message(chat_id, role, content):
    db = get_db()
    timestamp = current_time()
    db.execute(
        "INSERT INTO messages (chat_id, role, content, created_at) VALUES (?, ?, ?, ?)",
        (chat_id, role, content, timestamp)
    )
    db.execute(
        "UPDATE chats SET updated_at = ? WHERE id = ?",
        (timestamp, chat_id)
    )
    db.commit()
    db.close()

def get_chat_messages(chat_id):
    db = get_db()
    rows = db.execute(
        "SELECT role, content, created_at FROM messages WHERE chat_id = ? ORDER BY id ASC",
        (chat_id,)
    ).fetchall()
    db.close()
    return [
        {
            "role": row["role"],
            "content": row["content"],
            "created_at": row["created_at"]
        }
        for row in rows
    ]

# ============================================================
# SYSTEM PROMPTS & CONTEXT
# ============================================================

SYSTEM_PROMPT = """You are OVA (Omni Virtual Assistant), an advanced, ultra-intelligent personal AI assistant built for deep problem solving, high-performance programming, creative work, and research.

Key Directives:
- Accuracy First: Deliver precise, rigorously truthful, and verified answers.
- Code & Artifacts: Write clean, production-grade code. When providing complete interactive web apps, components, visualizations, or SVGs, provide the code within standard markdown codeblocks (e.g. ```html, ```css, ```js, ```python) so the user can inspect, run, or open them in Canvas Studio.
- Math & Formatting: Use standard LaTeX notation (e.g. $...$ or $$...$$) for mathematical expressions, and formatted GitHub markdown (tables, bold, lists).
- Conciseness & Depth: Be punchy and direct when questions are simple. When queries demand architectural depth, code implementations, or analysis, deliver comprehensive excellence.
"""

REASONING_PROMPT_ADDON = """
[DEEP REASONING MODE ACTIVATED]
Before providing your final response, you MUST work through the problem step-by-step inside <think>...</think> tags.
In your thinking block:
1. Deconstruct the problem and clarify requirements.
2. Outline possible approaches and evaluate trade-offs or edge cases.
3. Arrive at the optimal solution logically.
After closing the </think> tag, present your final, clear, beautifully formatted solution to the user.
"""

def build_history(messages, max_tokens=2200):
    """
    Build sliding conversation history keeping most recent messages within a safe token budget.
    Also strips any prior streaming error messages so they don't corrupt context.
    """
    history = []
    used_tokens = 0
    for message in reversed(messages):
        if not isinstance(message, dict):
            continue
        role = message.get("role")
        if role not in ["user", "assistant"]:
            continue
        content = str(message.get("content", "")).strip()
        # Skip empty or prior error notifications
        if not content or content.startswith("⚠️ Groq Streaming Error") or content.startswith("⚠️ Error"):
            continue

        # Prevent single huge assistant message (e.g. 10k chars) from starving the whole budget
        if len(content) > 2800:
            content = content[:2800] + "\n...[truncated for length]"

        msg_tokens = estimate_tokens(content)
        if used_tokens + msg_tokens > max_tokens:
            if not history and max_tokens > 150:
                # Include truncated slice of the immediate prior message if needed
                allowed_chars = int(max_tokens * 3.0)
                history.insert(0, {"role": role, "content": content[:allowed_chars] + "\n...[truncated]"})
            break

        history.insert(0, {"role": role, "content": content})
        used_tokens += msg_tokens
    return history

# ============================================================
# ROUTES
# ============================================================

@app.route("/")
def home():
    return render_template("index.html")

@app.route("/api/models", methods=["GET"])
def api_models():
    return jsonify({
        "models": AVAILABLE_MODELS,
        "default": DEFAULT_MODEL
    })

# ------------------------------------------------------------
# STREAMING CHAT (SSE) - ⚡ Ultra-Fast Token-by-Token Streaming
# ------------------------------------------------------------
@app.route("/chat/stream", methods=["POST"])
def chat_stream():
    data = request.get_json(silent=True) or {}
    chat_id = data.get("chat_id")
    user_message = data.get("message", "").strip()
    selected_model = data.get("model", DEFAULT_MODEL)
    reasoning_mode = bool(data.get("reasoning_mode", False))
    force_web_search = data.get("web_search")  # True, False, or None (auto)

    if not user_message:
        return jsonify({"error": "No user message provided."}), 400

    if len(user_message) > MAX_MESSAGE_LENGTH:
        user_message = user_message[:MAX_MESSAGE_LENGTH] + "\n[Message truncated]"

    if not chat_id or not chat_exists(chat_id):
        chat_id = create_chat()

    # Save user message immediately
    save_message(chat_id, "user", user_message)

    # Check for memory actions
    user_msg_lower = user_message.lower().strip()
    memory_notice = None
    if any(cmd in user_msg_lower for cmd in ["clear all memories", "delete all memories", "wipe my memory", "clear memories", "wipe memories", "forget all memories"]):
        clear_all_memories()
        memory_notice = "All memories have been permanently cleared."
    else:
        extracted = extract_memory_from_message(user_message)
        if extracted:
            add_memory(extracted)
            memory_notice = f'Remembered: "{extracted}"'

    # Model-aware token budgeting
    model_tpm = MODEL_TPM_LIMITS.get(selected_model, 8000)
    if model_tpm <= 8000:
        history_token_budget = 2000
        safe_total_budget = 6500
        default_max_output = 1800
    else:
        history_token_budget = 8000
        safe_total_budget = 40000
        default_max_output = 4096

    # Build memory context & history
    memories_list = get_all_memories()
    memory_context = format_memory_prompt(memories_list)
    all_chat_messages = get_chat_messages(chat_id)
    history = build_history(all_chat_messages, max_tokens=history_token_budget)

    # Determine if web search is needed
    use_web = force_web_search if isinstance(force_web_search, bool) else needs_web_search(user_message)
    is_news = is_news_query(user_message)

    def generate():
        nonlocal chat_id
        # Send initial metadata
        yield f"data: {json.dumps({'type': 'init', 'chat_id': chat_id, 'memory_notice': memory_notice})}\n\n"

        search_context = ""
        sources = []
        if use_web:
            yield f"data: {json.dumps({'type': 'status', 'status': 'Searching live web with Tavily...'})}\n\n"
            search_topic = "news" if is_news else "general"
            search_result = search_tavily(
                query=user_message,
                max_results=4,
                topic=search_topic,
                days=3
            )
            if search_result.get("success"):
                sources = search_result.get("sources", [])
                search_context = search_result.get("context", "")
                yield f"data: {json.dumps({'type': 'sources', 'sources': sources})}\n\n"
            else:
                err_msg = search_result.get("message", "Search unavailable")
                yield f"data: {json.dumps({'type': 'status', 'status': f'Web search notice: {err_msg}'})}\n\n"

        # Build system prompt
        sys_prompt = SYSTEM_PROMPT.strip()
        if reasoning_mode:
            sys_prompt += "\n" + REASONING_PROMPT_ADDON.strip()
        if search_context:
            sys_prompt += f"\n\n[LIVE WEB SEARCH RESULTS FROM TAVILY]\n{search_context}\nSynthesize an accurate, well-cited answer using these real-time sources."
        if memory_context:
            sys_prompt += f"\n{memory_context}"

        messages = [{"role": "system", "content": sys_prompt}]
        messages.extend(history)

        # Dynamic output tokens to strictly respect Groq TPM limits
        input_tokens = estimate_tokens(sys_prompt) + sum(estimate_tokens(m.get("content", "")) for m in history)
        if model_tpm <= 8000:
            max_output_tokens = min(default_max_output, max(512, safe_total_budget - input_tokens))
        else:
            max_output_tokens = default_max_output

        full_response = ""
        try:
            stream = client.chat.completions.create(
                model=selected_model,
                messages=messages,
                temperature=0.6 if reasoning_mode else 0.7,
                max_tokens=max_output_tokens,
                stream=True
            )

            for chunk in stream:
                if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
                    token = chunk.choices[0].delta.content
                    full_response += token
                    yield f"data: {json.dumps({'type': 'chunk', 'content': token})}\n\n"

        except Exception as stream_err:
            err_str = str(stream_err)
            print("GROQ STREAM ERROR:", repr(stream_err))
            
            # Check for Rate Limit / 413 / TPM quota
            is_rate_limit = any(k in err_str.lower() for k in ["413", "rate_limit", "tpm", "tokens per minute", "rate limit"])
            if is_rate_limit and not full_response:
                yield f"data: {json.dumps({'type': 'status', 'status': f'Rate limit detected on {selected_model}. Auto-recovering with compressed context...'})}\n\n"
                try:
                    # Retry with only immediate prompt and reduced token budget
                    minimal_messages = [{"role": "system", "content": sys_prompt[:1500]}]
                    minimal_messages.append({"role": "user", "content": user_message})

                    retry_stream = client.chat.completions.create(
                        model=selected_model,
                        messages=minimal_messages,
                        temperature=0.6 if reasoning_mode else 0.7,
                        max_tokens=1024,
                        stream=True
                    )
                    for chunk in retry_stream:
                        if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
                            token = chunk.choices[0].delta.content
                            full_response += token
                            yield f"data: {json.dumps({'type': 'chunk', 'content': token})}\n\n"
                except Exception as retry_err:
                    print("RETRY FAILED:", repr(retry_err))
                    user_friendly_error = (
                        f"⚠️ **Groq Rate Limit Exceeded:** The free tier for {selected_model} has an 8,000 tokens/min limit. "
                        "Please wait 10 seconds before asking your next question, or switch to the **Compound Web** model (70k TPM limit) in the top selector."
                    )
                    yield f"data: {json.dumps({'type': 'error', 'error': user_friendly_error})}\n\n"
            else:
                yield f"data: {json.dumps({'type': 'error', 'error': err_str})}\n\n"

        # Save assistant message to database only if valid content was generated
        if full_response and not full_response.startswith("⚠️"):
            save_message(chat_id, "assistant", full_response)

        # Automatic Chat Title if it's the first exchange
        db = get_db()
        row = db.execute("SELECT title FROM chats WHERE id = ?", (chat_id,)).fetchone()
        new_title = None
        if row and row["title"] == "New Chat":
            new_title = user_message[:45] + ("..." if len(user_message) > 45 else "")
            db.execute(
                "UPDATE chats SET title = ?, updated_at = ? WHERE id = ?",
                (new_title, current_time(), chat_id)
            )
            db.commit()
        db.close()

        yield f"data: {json.dumps({'type': 'done', 'chat_id': chat_id, 'title': new_title})}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive"
        }
    )

# ------------------------------------------------------------
# LEGACY /chat (for fallback compatibility)
# ------------------------------------------------------------
@app.route("/chat", methods=["POST"])
def chat():
    try:
        data = request.get_json(silent=True) or {}
        chat_id = data.get("chat_id")
        messages = data.get("messages")
        if not messages:
            single = data.get("message")
            if single:
                messages = [{"role": "user", "content": str(single)}]
        if not messages:
            return jsonify({"error": "No messages provided."}), 400

        user_message = ""
        for m in reversed(messages):
            if m.get("role") == "user":
                user_message = str(m.get("content", "")).strip()
                break

        if not user_message:
            return jsonify({"error": "No user message found."}), 400

        if not chat_id or not chat_exists(chat_id):
            chat_id = create_chat()

        save_message(chat_id, "user", user_message)
        history = build_history(get_chat_messages(chat_id), max_tokens=2000)

        response = client.chat.completions.create(
            model=DEFAULT_MODEL,
            messages=[{"role": "system", "content": SYSTEM_PROMPT}] + history,
            temperature=0.7,
            max_tokens=1500
        )
        answer = response.choices[0].message.content or "No response generated."
        save_message(chat_id, "assistant", answer)

        return jsonify({
            "answer": answer,
            "chat_id": chat_id,
            "web_search": False,
            "sources": []
        })
    except Exception as error:
        return jsonify({"error": str(error)}), 500

# ------------------------------------------------------------
# FILE UPLOAD & INGESTION
# ------------------------------------------------------------
@app.route("/api/upload", methods=["POST"])
def api_upload():
    try:
        if "file" not in request.files:
            return jsonify({"error": "No file uploaded."}), 400
        file = request.files["file"]
        if not file or not file.filename:
            return jsonify({"error": "Empty filename."}), 400

        filepath = save_uploaded_file(file)
        text_content = read_file(filepath)
        limited_text = limit_text(text_content, 30000)

        return jsonify({
            "success": True,
            "filename": file.filename,
            "path": filepath,
            "content": limited_text,
            "char_count": len(text_content),
            "truncated": len(text_content) > 30000
        })
    except Exception as error:
        return jsonify({"error": str(error)}), 500

# ------------------------------------------------------------
# CODE EXECUTION RUNNER (Canvas Studio Python runner)
# ------------------------------------------------------------
@app.route("/api/run-code", methods=["POST"])
def api_run_code():
    try:
        data = request.get_json(silent=True) or {}
        code = data.get("code", "")
        if not code.strip():
            return jsonify({"error": "No code provided."}), 400

        # Execute in isolated subprocess with strict 8-second timeout
        proc = subprocess.run(
            [sys.executable, "-c", code],
            capture_output=True,
            text=True,
            timeout=8
        )
        return jsonify({
            "success": proc.returncode == 0,
            "stdout": proc.stdout,
            "stderr": proc.stderr,
            "exit_code": proc.returncode
        })
    except subprocess.TimeoutExpired:
        return jsonify({
            "success": False,
            "stdout": "",
            "stderr": "Execution timed out (maximum 8 seconds allowed).",
            "exit_code": -1
        })
    except Exception as error:
        return jsonify({
            "success": False,
            "stdout": "",
            "stderr": str(error),
            "exit_code": -1
        }), 500

# ------------------------------------------------------------
# CHAT MANAGEMENT API
# ------------------------------------------------------------
@app.route("/api/chats", methods=["GET"])
def api_chats():
    try:
        db = get_db()
        rows = db.execute(
            "SELECT id, title, created_at, updated_at FROM chats ORDER BY updated_at DESC"
        ).fetchall()
        db.close()
        return jsonify({
            "chats": [
                {
                    "id": row["id"],
                    "title": row["title"],
                    "created_at": row["created_at"],
                    "updated_at": row["updated_at"]
                }
                for row in rows
            ]
        })
    except Exception as error:
        return jsonify({"error": str(error)}), 500

@app.route("/api/chats", methods=["POST"])
def api_create_chat():
    try:
        chat_id = create_chat()
        return jsonify({"success": True, "chat_id": chat_id})
    except Exception as error:
        return jsonify({"error": str(error)}), 500

@app.route("/api/chats/<chat_id>/messages", methods=["GET"])
def api_messages(chat_id):
    try:
        if not chat_exists(chat_id):
            return jsonify({"error": "Chat not found."}), 404
        return jsonify({"messages": get_chat_messages(chat_id)})
    except Exception as error:
        return jsonify({"error": str(error)}), 500

@app.route("/api/chats/<chat_id>", methods=["DELETE"])
def api_delete_chat(chat_id):
    try:
        db = get_db()
        db.execute("DELETE FROM messages WHERE chat_id = ?", (chat_id,))
        db.execute("DELETE FROM chats WHERE id = ?", (chat_id,))
        db.commit()
        db.close()
        return jsonify({"success": True})
    except Exception as error:
        return jsonify({"error": str(error)}), 500

@app.route("/api/chats/<chat_id>/rename", methods=["PUT", "POST"])
def api_rename_chat(chat_id):
    try:
        data = request.get_json(silent=True) or {}
        new_title = data.get("title", "").strip()
        if not new_title:
            return jsonify({"error": "Title cannot be empty."}), 400

        db = get_db()
        db.execute("UPDATE chats SET title = ?, updated_at = ? WHERE id = ?", (new_title, current_time(), chat_id))
        db.commit()
        db.close()
        return jsonify({"success": True, "title": new_title})
    except Exception as error:
        return jsonify({"error": str(error)}), 500

@app.route("/api/chats/<chat_id>/export", methods=["GET"])
def api_export_chat(chat_id):
    try:
        if not chat_exists(chat_id):
            return jsonify({"error": "Chat not found."}), 404

        fmt = request.args.get("format", "markdown").lower()
        db = get_db()
        chat_row = db.execute("SELECT title, created_at FROM chats WHERE id = ?", (chat_id,)).fetchone()
        messages = get_chat_messages(chat_id)
        db.close()

        if fmt == "json":
            return jsonify({
                "chat_id": chat_id,
                "title": chat_row["title"],
                "created_at": chat_row["created_at"],
                "messages": messages
            })
        else:
            md_lines = [f"# {chat_row['title']}", f"*Exported on {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC*\n", "---"]
            for m in messages:
                speaker = "### 👤 User" if m["role"] == "user" else "### ⚡ OVA"
                md_lines.append(f"\n{speaker}\n\n{m['content']}\n")
            return Response(
                "\n".join(md_lines),
                mimetype="text/markdown",
                headers={"Content-Disposition": f"attachment; filename=chat_{chat_id[:8]}.md"}
            )
    except Exception as error:
        return jsonify({"error": str(error)}), 500

# ------------------------------------------------------------
# MEMORY API
# ------------------------------------------------------------
@app.route("/api/memories", methods=["GET"])
def api_get_memories():
    try:
        memories = get_all_memories()
        return jsonify({"memories": memories})
    except Exception as error:
        return jsonify({"error": str(error)}), 500

@app.route("/api/memories", methods=["POST"])
def api_add_memory():
    try:
        data = request.get_json(silent=True) or {}
        content = str(data.get("content", "")).strip()
        if not content:
            return jsonify({"error": "Memory is empty."}), 400
        memory_id = add_memory(content)
        return jsonify({"success": True, "id": memory_id})
    except Exception as error:
        return jsonify({"error": str(error)}), 500

@app.route("/api/memories/<int:memory_id>", methods=["DELETE"])
def api_delete_memory(memory_id):
    try:
        success = delete_memory(memory_id)
        return jsonify({"success": success})
    except Exception as error:
        return jsonify({"error": str(error)}), 500

@app.route("/api/memories", methods=["DELETE"])
def api_clear_memories():
    try:
        success = clear_all_memories()
        return jsonify({"success": success})
    except Exception as error:
        return jsonify({"error": str(error)}), 500

# ------------------------------------------------------------
# HEALTH CHECK
# ------------------------------------------------------------
@app.route("/api/health", methods=["GET"])
def api_health():
    tavily_key = os.getenv("TAVILY_API_KEY")
    return jsonify({
        "status": "online",
        "ova": True,
        "database": os.path.exists(DATABASE),
        "model": DEFAULT_MODEL,
        "models": [m["id"] for m in AVAILABLE_MODELS],
        "web_search": "Tavily" if tavily_key else "Disabled",
        "tavily_configured": bool(tavily_key),
        "memory": True,
        "streaming": True,
        "code_runner": True
    })

# ============================================================
# RUN SERVER
# ============================================================
if __name__ == "__main__":
    print("\n==========================================")
    print("         OVA - NEXT-GEN AI STUDIO         ")
    print("==========================================")
    print(f"Default Model: {DEFAULT_MODEL}")
    print(f"Models: {[m['name'] for m in AVAILABLE_MODELS]}")
    print(f"Tavily Search: {'ACTIVE' if os.getenv('TAVILY_API_KEY') else 'DISABLED'}")
    print("Streaming (SSE): ENABLED")
    print("Canvas Studio & Code Runner: ENABLED")
    print("http://127.0.0.1:5000\n==========================================\n")
    app.run(host="127.0.0.1", port=5000, debug=True)
