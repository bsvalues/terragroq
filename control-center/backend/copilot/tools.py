"""WilliamOS Co-Pilot — Tool Catalog and Safety-Gated Runner.

Exposes the WilliamOS command registry as an LLM function-call catalog and
executes commands through the safety gate.

Public API:
    catalog() -> list[dict]   OpenAI/Ollama function schemas, one per command.
    run(name, arguments, confirmed) -> dict  Safety-gated command execution.

Constants:
    REMEMBER  Tool name for the synthetic remember tool (intercepted by the loop).
"""

from __future__ import annotations

import safety
import command_runner
import williamos_commands

_MAX_OBSERVATION = 2000

# ---------------------------------------------------------------------------
# Synthetic remember tool — intercepted by the agent loop, never reaches
# safety.check_command or command_runner.
# ---------------------------------------------------------------------------

REMEMBER = "remember"

REMEMBER_TOOL = {
    "type": "function",
    "function": {
        "name": REMEMBER,
        "description": (
            "Save a durable fact or preference about the operator for future sessions "
            "(e.g. their goals, name, working style). Use when the user shares something "
            "worth remembering long-term."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "fact": {
                    "type": "string",
                    "description": "The fact or preference to remember about the operator.",
                }
            },
            "required": ["fact"],
        },
    },
}


def catalog() -> list[dict]:
    """Return OpenAI/Ollama function schemas for every registered command."""
    schemas = []
    for cmd in williamos_commands.all_commands():
        schemas.append(
            {
                "type": "function",
                "function": {
                    "name": cmd["name"],
                    "description": cmd["purpose"],
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "args": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "Positional arguments / flags for the command.",
                            }
                        },
                    },
                },
            }
        )
    schemas.append(REMEMBER_TOOL)
    return schemas


def run(
    name: str,
    arguments: dict,
    confirmed: bool = False,
) -> dict:
    """Execute a command through the safety gate.

    Args:
        name:       WilliamOS command name (e.g. "backup-status").
        arguments:  LLM tool-call arguments dict; ``arguments.get("args", [])``
                    is forwarded to the command.
        confirmed:  Caller has explicitly confirmed a CONFIRM_REQUIRED command.

    Returns:
        {
            "ok":            bool,
            "observation":   str (<=2000 chars, stdout+stderr folded),
            "needs_confirm": bool,
            "confirm_reason": str | None,
        }

    Note:
        ``remember`` is intercepted by the agent loop and must never reach this
        function.  If it does (defensive fallback), return an error immediately
        without touching safety or command_runner.
    """
    # Defensive guard — remember is handled exclusively by the loop
    if name == REMEMBER:
        return {
            "ok": False,
            "observation": "remember is handled by the loop, not tools.run",
            "needs_confirm": False,
            "confirm_reason": None,
        }

    args: list[str] = arguments.get("args", [])

    verdict = safety.check_command(name, args)

    if not verdict.get("allowed", False):
        return {
            "ok": False,
            "observation": verdict.get("reason", f"'{name}' is not allowed."),
            "needs_confirm": False,
            "confirm_reason": None,
        }

    if verdict.get("confirm") and not confirmed:
        return {
            "ok": False,
            "observation": "",
            "needs_confirm": True,
            "confirm_reason": verdict.get("confirm_reason"),
        }

    result = command_runner.run_command(name, args, confirmed)

    stdout = result.get("stdout", "")
    stderr = result.get("stderr", "")
    parts = [p for p in (stdout, stderr) if p]
    observation = "\n".join(parts)
    if len(observation) > _MAX_OBSERVATION:
        observation = observation[:_MAX_OBSERVATION] + "\n... [truncated]"

    return {
        "ok": result.get("ok", False),
        "observation": observation,
        "needs_confirm": False,
        "confirm_reason": None,
    }
