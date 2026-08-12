"""Command-line entrypoint for the SEA tier.

Examples:
  python -m sea worker --root ./repo --target mathutil.py \
      --task "average([]) must return 0.0, else the mean" \
      --test "python3 test_mathutil.py" \
      --base-url http://192.168.231.1:11500 --model llama3.1:8b

  python -m sea review --root ./repo --target discount.py \
      --requirement "apply_discount(100,20) must equal 80" --base-url ... --model ...

  python -m sea remediate --root ./repo --target discount.py \
      --requirement "apply_discount(100,20) must equal 80" \
      --test "python3 -c 'from discount import apply_discount as a; assert a(100,20)==80'" ...
"""
from __future__ import annotations

import argparse
import json
import sys
import time

from .model import ModelClient, ModelError
from .roles import remediate, review, worker
from .verify import Verifier
from .workspace import Workspace, WorkspaceError


def _make_verifier_factory(root: str, test_cmd: str | None, compile_py: bool):
    def factory(files):
        return Verifier(root, files, test_cmd=test_cmd, compile_py=compile_py)
    return factory


def _client(args) -> ModelClient:
    return ModelClient(base_url=args.base_url, model=args.model, api=args.api,
                       api_key=args.api_key, temperature=args.temperature)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="sea", description="Structured-Edit Adapter tier for small coding models")
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(sp):
        sp.add_argument("--root", required=True, help="workspace root directory")
        sp.add_argument("--base-url", required=True, help="model endpoint base URL")
        sp.add_argument("--model", required=True, help="model name")
        sp.add_argument("--api", default="auto", choices=["auto", "ollama", "openai"])
        sp.add_argument("--api-key", default=None)
        sp.add_argument("--temperature", type=float, default=0.0)
        sp.add_argument("--max-attempts", type=int, default=3)
        sp.add_argument("--receipt", default=None, help="write the run receipt JSON to this path")

    w = sub.add_parser("worker", help="implement a task via structured edits + verify")
    common(w)
    w.add_argument("--task", required=True)
    w.add_argument("--target", action="append", required=True, help="target file (repeatable)")
    w.add_argument("--test", default=None, help="verification command run in --root")
    w.add_argument("--no-compile", action="store_true", help="skip Python compile check")

    r = sub.add_parser("review", help="emit a strict PASS/FAIL verdict")
    common(r)
    r.add_argument("--target", required=True)
    r.add_argument("--requirement", required=True)

    m = sub.add_parser("remediate", help="review a file, then fix it if the verdict is FAIL")
    common(m)
    m.add_argument("--target", required=True)
    m.add_argument("--requirement", required=True)
    m.add_argument("--test", default=None)
    m.add_argument("--no-compile", action="store_true")

    args = ap.parse_args(argv)

    try:
        ws = Workspace(args.root)
        client = _client(args)

        if args.cmd == "worker":
            factory = _make_verifier_factory(args.root, args.test, not args.no_compile)
            res = worker(args.task, args.target, ws, client, factory, args.max_attempts)

        elif args.cmd == "review":
            res = review(args.target, args.requirement, ws, client, args.max_attempts)

        elif args.cmd == "remediate":
            rev = review(args.target, args.requirement, ws, client, max_attempts=2)
            if not rev.success:
                res = rev
            elif rev.verdict and rev.verdict.verdict == "PASS":
                res = rev  # nothing to fix
            else:
                factory = _make_verifier_factory(args.root, args.test, not args.no_compile)
                res = remediate(args.target, rev.verdict, ws, client, factory, args.max_attempts)
        else:  # pragma: no cover
            ap.error("unknown command")

    except (WorkspaceError, ModelError, ValueError) as e:
        print(json.dumps({"success": False, "error": str(e)}, indent=2))
        return 2

    out = res.to_dict()
    out["at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    print(json.dumps(out, indent=2))
    if args.receipt:
        with open(args.receipt, "w") as fh:
            json.dump(out, fh, indent=2)
    return 0 if res.success else 1


if __name__ == "__main__":
    sys.exit(main())
