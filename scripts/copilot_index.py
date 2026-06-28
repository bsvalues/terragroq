"""copilot_index.py — CLI wrapper to build the vault RAG index.

Usage:
    python scripts/copilot_index.py

Env vars:
    WILLIAMOS_VAULT_DIR          Vault root dir (default: <project root>/WilliamOS)
    WILLIAMOS_COPILOT_INDEX_DB   Index db path  (default: control-center/backend/copilot_index.db)
"""

import sys
from pathlib import Path

# Add the backend dir to sys.path so copilot.* can be imported
_BACKEND = Path(__file__).resolve().parent.parent / "control-center" / "backend"
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from copilot.retrieval import build_index  # noqa: E402  (after sys.path fix)


def main() -> None:
    stats = build_index()
    print(
        f"Indexed {stats['files']} files, {stats['chunks']} chunks -> {stats['db']}"
    )
    if stats.get("skipped"):
        print(f"  ({stats['skipped']} chunks skipped due to embed errors)")


if __name__ == "__main__":
    main()
