import sqlite3
import re
from datetime import datetime
from typing import List, Dict, Any, Optional

DATABASE = "chat_history.db"


def get_db(db_path: str = DATABASE) -> sqlite3.Connection:
    """Get a SQLite database connection with row factory."""
    db = sqlite3.connect(db_path, timeout=10)
    db.row_factory = sqlite3.Row
    return db


def get_all_memories(db_path: str = DATABASE) -> List[Dict[str, Any]]:
    """
    Retrieve all saved persistent memories ordered chronologically.
    """
    db = get_db(db_path)
    try:
        rows = db.execute(
            """
            SELECT id, content, created_at
            FROM memories
            ORDER BY id ASC
            """
        ).fetchall()
        return [
            {
                "id": row["id"],
                "content": row["content"],
                "created_at": row["created_at"]
            }
            for row in rows
        ]
    except Exception as error:
        print("Error fetching memories:", repr(error))
        return []
    finally:
        db.close()


def add_memory(content: str, db_path: str = DATABASE) -> Optional[int]:
    """
    Save a new memory fact to the database.
    """
    content = str(content).strip()[:5000]
    if not content:
        return None

    db = get_db(db_path)
    try:
        cursor = db.execute(
            """
            INSERT INTO memories (content, created_at)
            VALUES (?, ?)
            """,
            (content, datetime.utcnow().isoformat())
        )
        db.commit()
        return cursor.lastrowid
    except Exception as error:
        print("Error saving memory:", repr(error))
        return None
    finally:
        db.close()


def delete_memory(memory_id: int, db_path: str = DATABASE) -> bool:
    """
    Delete a single memory by ID.
    """
    db = get_db(db_path)
    try:
        cursor = db.execute(
            """
            DELETE FROM memories
            WHERE id = ?
            """,
            (memory_id,)
        )
        db.commit()
        return cursor.rowcount > 0
    except Exception as error:
        print("Error deleting memory:", repr(error))
        return False
    finally:
        db.close()


def clear_all_memories(db_path: str = DATABASE) -> bool:
    """
    Clear all saved persistent memories.
    """
    db = get_db(db_path)
    try:
        db.execute("DELETE FROM memories")
        db.commit()
        return True
    except Exception as error:
        print("Error clearing memories:", repr(error))
        return False
    finally:
        db.close()


def extract_memory_from_message(text: str) -> Optional[str]:
    """
    Detect if the user is giving an instruction to remember something.
    Returns the extracted fact to remember, or None.
    """
    if not text:
        return None

    clean_text = text.strip()

    # Don't treat questions as memory commands (e.g. "Do you remember my name?")
    if clean_text.endswith("?"):
        return None

    # Don't match inquiry questions
    question_starters = (
        "do you remember",
        "can you remember",
        "could you remember",
        "would you remember",
        "did you remember",
        "will you remember",
        "what do you remember",
        "what did i",
        "what is my",
        "what's my",
        "who am i"
    )
    lower_text = clean_text.lower()
    if any(lower_text.startswith(qs) for qs in question_starters):
        return None

    patterns = [
        r"^(?:please\s+)?remember\s+(?:that\s+)?(.+)$",
        r"^(?:please\s+)?remember\s*:\s*(.+)$",
        r"^(?:please\s+)?save\s+(?:this\s+)?to\s+(?:your\s+)?memory\s*:\s*(.+)$",
        r"^(?:please\s+)?save\s+to\s+memory\s+(?:that\s+)?(.+)$",
        r"^(?:please\s+)?keep\s+in\s+mind\s+(?:that\s+)?(.+)$",
        r"^(?:please\s+)?note\s+(?:that\s+)?(.+)$",
        r"^(?:don'?t\s+forget|dont\s+forget)\s+(?:that\s+)?(.+)$",
    ]

    for pattern in patterns:
        match = re.match(pattern, clean_text, re.IGNORECASE)
        if match:
            fact = match.group(1).strip()
            fact = fact.rstrip("!.")
            if len(fact) >= 3:
                return fact

    return None


def format_memory_prompt(memories: List[Dict[str, Any]]) -> str:
    """
    Format memories into a system prompt section.
    """
    if not memories:
        return ""

    lines = [
        f"- {m['content']}"
        for m in memories
        if m.get("content")
    ]

    if not lines:
        return ""

    return (
        "\n\n[USER LONG-TERM MEMORY (🧠)]\n"
        "You have the following persistent memories and facts saved about the user:\n"
        + "\n".join(lines)
        + "\nUse these remembered details naturally when relevant to personalize your responses."
    )
