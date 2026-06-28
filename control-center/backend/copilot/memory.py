"""SQLite-backed conversation memory for the WilliamOS Co-Pilot.

Responsibilities:
- Session management (create, identify sessions)
- Message storage and retrieval (chronological, per-session)
- User facts storage (persistent key facts about the user)

No LLM logic — pure storage layer.
"""

import json
import os
import secrets
import sqlite3
import threading
from pathlib import Path
from typing import Optional

_DEFAULT_DB_PATH = os.environ.get(
    "WILLIAMOS_COPILOT_DB",
    str(Path(__file__).resolve().parent.parent / "copilot.db"),
)

_DDL = """
CREATE TABLE IF NOT EXISTS sessions (
    id      TEXT PRIMARY KEY,
    created TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    session TEXT    NOT NULL REFERENCES sessions(id),
    role    TEXT    NOT NULL,
    content TEXT    NOT NULL,
    meta    TEXT,
    created TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS facts (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    text    TEXT NOT NULL,
    created TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fact_events (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    fact_id INTEGER NOT NULL,
    action  TEXT NOT NULL,
    detail  TEXT,
    created TEXT NOT NULL DEFAULT (datetime('now'))
);
"""

_FACT_AUTHORITY_STATES = {
    "intake",
    "unreviewed",
    "working",
    "reviewed",
    "canon",
    "deprecated",
    "superseded",
    "archived",
}


class Memory:
    """SQLite-backed conversation memory."""

    def __init__(self, db_path: Optional[str] = None) -> None:
        self._db_path = db_path or _DEFAULT_DB_PATH
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(self._db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(_DDL)
        self._migrate()
        self._conn.commit()

    def _migrate(self) -> None:
        """Apply small, backward-compatible schema updates."""
        existing = {
            row["name"]
            for row in self._conn.execute("PRAGMA table_info(facts)").fetchall()
        }
        additions = {
            "source": "TEXT NOT NULL DEFAULT 'legacy'",
            "authority_state": "TEXT NOT NULL DEFAULT 'working'",
            "stale": "INTEGER NOT NULL DEFAULT 0",
            "archived": "INTEGER NOT NULL DEFAULT 0",
            "last_used": "TEXT",
            "updated": "TEXT",
        }
        for column, ddl in additions.items():
            if column not in existing:
                self._conn.execute(f"ALTER TABLE facts ADD COLUMN {column} {ddl}")
        self._conn.execute("UPDATE facts SET updated = created WHERE updated IS NULL")

    # ------------------------------------------------------------------
    # Session management
    # ------------------------------------------------------------------

    def start_session(self) -> str:
        """Create a new session and return its id (a hex token)."""
        sid = secrets.token_hex(8)
        with self._lock:
            self._conn.execute("INSERT INTO sessions (id) VALUES (?)", (sid,))
            self._conn.commit()
        return sid

    # ------------------------------------------------------------------
    # Message storage
    # ------------------------------------------------------------------

    def append(
        self,
        session: str,
        role: str,
        content: str,
        meta: Optional[dict] = None,
    ) -> None:
        """Append a message to the given session."""
        meta_json = json.dumps(meta) if meta is not None else None
        with self._lock:
            self._conn.execute(
                "INSERT INTO messages (session, role, content, meta) VALUES (?, ?, ?, ?)",
                (session, role, content, meta_json),
            )
            self._conn.commit()

    def recent(self, session: str, limit: int = 20) -> list[dict]:
        """Return the *limit* most-recent messages for *session*, oldest-first.

        Each dict has at least: role, content, meta (parsed dict or None).
        """
        with self._lock:
            rows = self._conn.execute(
                """
                SELECT role, content, meta
                FROM (
                    SELECT id, role, content, meta
                    FROM messages
                    WHERE session = ?
                    ORDER BY id DESC
                    LIMIT ?
                )
                ORDER BY id ASC
                """,
                (session, limit),
            ).fetchall()

        result = []
        for row in rows:
            meta_raw = row["meta"]
            result.append(
                {
                    "role": row["role"],
                    "content": row["content"],
                    "meta": json.loads(meta_raw) if meta_raw is not None else None,
                }
            )
        return result

    def list_sessions(self, limit: int = 50) -> list[dict]:
        """Return recent sessions most-recent-first.

        Each dict: {"id": str, "created": str, "message_count": int, "preview": str}.
        preview is the first user message truncated to ~80 chars, or "".
        """
        with self._lock:
            rows = self._conn.execute(
                """
                SELECT s.id,
                       s.created,
                       COUNT(m.id) AS message_count,
                       (
                           SELECT content
                           FROM messages
                           WHERE session = s.id AND role = 'user'
                           ORDER BY id ASC
                           LIMIT 1
                       ) AS first_user_content
                FROM sessions s
                LEFT JOIN messages m ON m.session = s.id
                GROUP BY s.id
                ORDER BY s.rowid DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()

        result = []
        for row in rows:
            raw = row["first_user_content"] or ""
            preview = raw[:80] + ("…" if len(raw) > 80 else "")
            result.append(
                {
                    "id": row["id"],
                    "created": row["created"],
                    "message_count": row["message_count"],
                    "preview": preview,
                }
            )
        return result

    def get_session(self, session: str, limit: int = 200) -> list[dict]:
        """Return messages for *session* oldest-first (up to *limit*).

        Shape matches recent(): role, content, meta (parsed dict or None).
        """
        with self._lock:
            rows = self._conn.execute(
                """
                SELECT role, content, meta
                FROM messages
                WHERE session = ?
                ORDER BY id ASC
                LIMIT ?
                """,
                (session, limit),
            ).fetchall()

        result = []
        for row in rows:
            meta_raw = row["meta"]
            result.append(
                {
                    "role": row["role"],
                    "content": row["content"],
                    "meta": json.loads(meta_raw) if meta_raw is not None else None,
                }
            )
        return result

    # ------------------------------------------------------------------
    # User facts
    # ------------------------------------------------------------------

    def remember_fact(
        self,
        text: str,
        source: str = "copilot_tool",
        authority_state: str = "working",
    ) -> int:
        """Store a fact about the user."""
        state = self._normalize_fact_state(authority_state)
        with self._lock:
            cur = self._conn.execute(
                """
                INSERT INTO facts (text, source, authority_state, updated)
                VALUES (?, ?, ?, datetime('now'))
                """,
                (text, source or "unknown", state),
            )
            self._record_fact_event_locked(
                int(cur.lastrowid),
                "created",
                {"source": source or "unknown", "authority_state": state},
            )
            self._conn.commit()
            return int(cur.lastrowid)

    def facts(self) -> list[str]:
        """Return active stored facts as a list of strings.

        Stale, archived, deprecated, and superseded facts are excluded from
        prompt context so old memory does not silently keep influencing answers.
        """
        with self._lock:
            rows = self._conn.execute(
                """
                SELECT id, text
                FROM facts
                WHERE archived = 0
                  AND stale = 0
                  AND authority_state NOT IN ('deprecated', 'superseded', 'archived')
                ORDER BY id ASC
                """
            ).fetchall()
            if rows:
                ids = [row["id"] for row in rows]
                placeholders = ",".join("?" for _ in ids)
                self._conn.execute(
                    f"UPDATE facts SET last_used = datetime('now') WHERE id IN ({placeholders})",
                    ids,
                )
                self._conn.commit()
        return [row["text"] for row in rows]

    def list_facts(self, include_archived: bool = False, limit: int = 200) -> list[dict]:
        """Return facts with governance metadata, newest first."""
        where = "" if include_archived else "WHERE archived = 0"
        with self._lock:
            rows = self._conn.execute(
                f"""
                SELECT id, text, created, updated, source, authority_state, stale, archived, last_used
                FROM facts
                {where}
                ORDER BY id DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        facts = [self._fact_row(row) for row in rows]
        return self._annotate_fact_indicators(facts)

    def get_fact(self, fact_id: int) -> dict | None:
        with self._lock:
            row = self._conn.execute(
                """
                SELECT id, text, created, updated, source, authority_state, stale, archived, last_used
                FROM facts
                WHERE id = ?
                """,
                (fact_id,),
            ).fetchone()
        if not row:
            return None
        annotated = self._annotate_fact_indicators([self._fact_row(row)])
        return annotated[0] if annotated else None

    def update_fact_text(
        self,
        fact_id: int,
        text: str,
        source: str = "operator_edit",
        evidence: dict | None = None,
    ) -> dict | None:
        clean = text.strip()
        if not clean:
            raise ValueError("Fact text cannot be empty")
        with self._lock:
            cur = self._conn.execute(
                """
                UPDATE facts
                SET text = ?, source = ?, updated = datetime('now')
                WHERE id = ? AND archived = 0
                """,
                (clean, source or "operator_edit", fact_id),
            )
            if cur.rowcount:
                self._record_fact_event_locked(
                    fact_id,
                    "edited",
                    {"source": source or "operator_edit", "evidence": evidence or {}},
                )
            self._conn.commit()
        return self.get_fact(fact_id)

    def mark_fact_stale(
        self,
        fact_id: int,
        stale: bool = True,
        evidence: dict | None = None,
    ) -> dict | None:
        state = "deprecated" if stale else "working"
        with self._lock:
            cur = self._conn.execute(
                """
                UPDATE facts
                SET stale = ?, authority_state = ?, updated = datetime('now')
                WHERE id = ? AND archived = 0
                """,
                (1 if stale else 0, state, fact_id),
            )
            if cur.rowcount:
                self._record_fact_event_locked(
                    fact_id,
                    "marked_stale" if stale else "restored",
                    {"authority_state": state, "evidence": evidence or {}},
                )
            self._conn.commit()
        return self.get_fact(fact_id)

    def set_fact_authority(
        self,
        fact_id: int,
        authority_state: str,
        evidence: dict | None = None,
    ) -> dict | None:
        state = self._normalize_fact_state(authority_state)
        stale = 1 if state in {"deprecated", "superseded", "archived"} else 0
        archived = 1 if state == "archived" else 0
        with self._lock:
            cur = self._conn.execute(
                """
                UPDATE facts
                SET authority_state = ?, stale = ?, archived = ?, updated = datetime('now')
                WHERE id = ?
                """,
                (state, stale, archived, fact_id),
            )
            if cur.rowcount:
                self._record_fact_event_locked(
                    fact_id,
                    "authority_changed",
                    {"authority_state": state, "evidence": evidence or {}},
                )
            self._conn.commit()
        return self.get_fact(fact_id)

    def archive_fact(self, fact_id: int, evidence: dict | None = None) -> dict | None:
        """Soft-delete a fact. Archived facts remain recoverable in the DB."""
        return self.set_fact_authority(fact_id, "archived", evidence=evidence)

    def fact_audit(self, fact_id: int, limit: int = 50) -> list[dict]:
        with self._lock:
            rows = self._conn.execute(
                """
                SELECT id, fact_id, action, detail, created
                FROM fact_events
                WHERE fact_id = ?
                ORDER BY id DESC
                LIMIT ?
                """,
                (fact_id, limit),
            ).fetchall()
        return [self._event_row(row) for row in rows]

    def review_queue(self, limit: int = 100) -> dict:
        facts = self.list_facts(include_archived=False, limit=limit)
        needs_review = [
            fact for fact in facts
            if fact["authority_state"] in {"intake", "unreviewed", "working"}
            and not fact["stale"]
        ]
        stale = [fact for fact in facts if fact["stale"]]
        conflicts = [fact for fact in facts if fact["conflict"]]
        canon = [fact for fact in facts if fact["authority_state"] == "canon"]
        return {
            "needs_review": needs_review,
            "stale": stale,
            "conflicts": conflicts,
            "canon": canon,
            "counts": {
                "needs_review": len(needs_review),
                "stale": len(stale),
                "conflicts": len(conflicts),
                "canon": len(canon),
                "total": len(facts),
            },
        }

    def export_facts(self, format: str = "json", include_archived: bool = True) -> dict:
        facts = self.list_facts(include_archived=include_archived, limit=10000)
        if format == "json":
            return {
                "format": "json",
                "facts": facts,
                "counts": self.review_queue(limit=10000)["counts"],
            }
        if format == "markdown":
            lines = [
                "# WilliamOS Memory Export",
                "",
                f"- Facts: {len(facts)}",
                f"- Archived included: {str(include_archived).lower()}",
                "",
            ]
            for fact in facts:
                lines.extend([
                    f"## Fact {fact['id']}",
                    "",
                    fact["text"],
                    "",
                    f"- Authority: {fact['authority_state']}",
                    f"- Source: {fact['source']}",
                    f"- Citation: {fact['citation']}",
                    f"- Created: {fact['created']}",
                    f"- Updated: {fact['updated']}",
                    f"- Last used: {fact['last_used'] or 'never'}",
                    f"- Stale: {str(fact['stale']).lower()}",
                    f"- Archived: {str(fact['archived']).lower()}",
                    f"- Conflict: {str(fact['conflict']).lower()}",
                    "",
                ])
            return {"format": "markdown", "content": "\n".join(lines), "counts": {"facts": len(facts)}}
        raise ValueError("format must be json or markdown")

    def _normalize_fact_state(self, authority_state: str) -> str:
        state = (authority_state or "working").strip().lower()
        if state not in _FACT_AUTHORITY_STATES:
            raise ValueError(f"Unknown fact authority state: {authority_state}")
        return state

    def _fact_row(self, row: sqlite3.Row) -> dict:
        return {
            "id": row["id"],
            "text": row["text"],
            "created": row["created"],
            "updated": row["updated"],
            "source": row["source"],
            "authority_state": row["authority_state"],
            "stale": bool(row["stale"]),
            "archived": bool(row["archived"]),
            "last_used": row["last_used"],
            "citation": f"memory.fact:{row['id']}",
            "review_required": row["authority_state"] in {"intake", "unreviewed", "working"} or bool(row["stale"]),
            "staleness_indicator": "stale" if row["stale"] else "current",
            "conflict": False,
            "conflict_with": [],
        }

    def _event_row(self, row: sqlite3.Row) -> dict:
        raw = row["detail"]
        return {
            "id": row["id"],
            "fact_id": row["fact_id"],
            "action": row["action"],
            "detail": json.loads(raw) if raw else {},
            "created": row["created"],
        }

    def _record_fact_event_locked(self, fact_id: int, action: str, detail: dict | None = None) -> None:
        self._conn.execute(
            """
            INSERT INTO fact_events (fact_id, action, detail)
            VALUES (?, ?, ?)
            """,
            (fact_id, action, json.dumps(detail or {})),
        )

    def _annotate_fact_indicators(self, facts: list[dict]) -> list[dict]:
        active_by_norm: dict[str, list[int]] = {}
        for fact in facts:
            if fact["archived"]:
                continue
            norm = " ".join(fact["text"].lower().split())
            if norm:
                active_by_norm.setdefault(norm, []).append(fact["id"])
        conflicts = {fid: [other for other in ids if other != fid] for ids in active_by_norm.values() if len(ids) > 1 for fid in ids}
        for fact in facts:
            fact["conflict_with"] = conflicts.get(fact["id"], [])
            fact["conflict"] = bool(fact["conflict_with"])
            if fact["stale"]:
                fact["staleness_indicator"] = "stale"
            elif fact["authority_state"] in {"intake", "unreviewed", "working"}:
                fact["staleness_indicator"] = "needs_review"
            else:
                fact["staleness_indicator"] = "current"
            fact["review_required"] = (
                fact["authority_state"] in {"intake", "unreviewed", "working"}
                or fact["stale"]
                or fact["conflict"]
            )
        return facts
