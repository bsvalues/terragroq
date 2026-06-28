# WilliamOS Co-Pilot package

import sys
from pathlib import Path

# Ensure scripts/ is on sys.path so williamos_commands (and peers) can be
# imported at runtime (app.py, agent.py, etc.).  conftest.py handles this
# separately for pytest test runs.
_SCRIPTS = str(Path(__file__).resolve().parent.parent.parent.parent / "scripts")
if _SCRIPTS not in sys.path:
    sys.path.insert(0, _SCRIPTS)
