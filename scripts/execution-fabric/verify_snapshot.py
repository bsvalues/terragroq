#!/usr/bin/env python3
"""Independent verifier for CANONICALIZATION CONTRACT v1 (the check Codex's receipt verifier runs).
Recomputes steps 1-6 over each stored snapshot and asserts it equals both the filename and the
embedded snapshot_sha256. Usage: verify_snapshot.py <snapshots_root>"""
import sys, os, json, hashlib, rfc8785
root = sys.argv[1]
n = 0; fails = 0
for node in sorted(os.listdir(root)):
    nd = os.path.join(root, node)
    if not os.path.isdir(nd): continue
    for fn in sorted(os.listdir(nd)):
        if not fn.endswith(".json"): continue
        n += 1
        claimed = fn[:-5]
        d = json.load(open(os.path.join(nd, fn), encoding="utf-8-sig"))
        stored = d.get("snapshot_sha256")
        e = dict(d); e.pop("snapshot_sha256", None)
        recomputed = hashlib.sha256(rfc8785.dumps(e)).hexdigest()
        ok = (recomputed == claimed == stored)
        print(("OK   " if ok else "FAIL ") + "%s recomputed=%s.. filename=%s.. embedded=%s.." %
              (node, recomputed[:12], claimed[:12], str(stored)[:12]))
        if not ok: fails += 1
print("VERIFY snapshots=%d fails=%d" % (n, fails))
sys.exit(1 if fails else 0)
