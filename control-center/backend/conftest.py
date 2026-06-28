"""Pytest configuration for the control-center backend test suite.

Adds the project's scripts/ directory to sys.path so that williamos_commands
(and other script-level modules) can be imported without installing them.
"""

import sys
from pathlib import Path

# Project root is three levels up from this file:
# control-center/backend/conftest.py -> control-center/backend -> control-center -> project root
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_SCRIPTS = str(_PROJECT_ROOT / "scripts")

if _SCRIPTS not in sys.path:
    sys.path.insert(0, _SCRIPTS)
