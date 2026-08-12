"""CLI / hook entrypoint:  python -m capg "<command>"

Prints a JSON verdict and sets the exit code so a shell hook can gate execution:
    exit 0  -> ALLOW    (proceed)
    exit 2  -> ASK      (require human approval)
    exit 3  -> DENY     (block)
"""
import json
import sys

from .gate import Decision, classify

_EXIT = {Decision.ALLOW: 0, Decision.ASK: 2, Decision.DENY: 3}


def main(argv=None) -> int:
    argv = argv if argv is not None else sys.argv[1:]
    if not argv:
        print(json.dumps({"error": "usage: python -m capg \"<command>\""}))
        return 64
    command = argv[0] if len(argv) == 1 else " ".join(argv)
    v = classify(command)
    print(json.dumps({"command": command, **v.to_dict()}))
    return _EXIT[v.decision]


if __name__ == "__main__":
    sys.exit(main())
