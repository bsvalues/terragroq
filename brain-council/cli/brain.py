import argparse, json, hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def load(p): return json.loads(Path(p).read_text())
def show(d): print(json.dumps(d,indent=2))
def status(args): show({"version":load(ROOT/"VERSION.json")["version"],"status":load(ROOT/"VERSION.json")["status"],"default_next":"STOP unless owner selects install/verify/commit-candidate/new objective","push_authority":False,"pr_ready_authority":False,"mcp_enabled":False,"autonomy_enabled":False})
def quickstart(args): show({"valid_next_lanes":["install into WilliamOS","verify install","Codex read-only verification","owner commit decision","preserve artifact and stop"],"default":"STOP","blocked":["push","PR readiness","merge","tag","release","MCP","autonomy","production_write"]})
def release(args): show(load(ROOT/"release/V1_5_1_RELEASE_MANIFEST.json"))
def scoreboard(args): show(load(ROOT/"GATE_SCOREBOARD.json"))
def closure(args): print((ROOT/"closure/STOP_HERE_DISPOSITION.md").read_text())
def commit_candidate(args): print((ROOT/"commit_candidate/COMMIT_CANDIDATE_REVIEW_PACKET.md").read_text())
def manifest(args):
    files=[]
    for p in ROOT.rglob("*"):
        rel=p.relative_to(ROOT)
        if p.is_file() and "out" not in rel.parts and "__pycache__" not in rel.parts and p.suffix!=".zip":
            files.append({"path":str(rel),"size_bytes":p.stat().st_size,"sha256":hashlib.sha256(p.read_bytes()).hexdigest()})
    show({"type":"install_manifest","file_count":len(files),"files":files,"blocked":["unbounded_expansion","push","PR readiness","merge","tag","release","MCP","autonomy","production_write"]})
def main():
    p=argparse.ArgumentParser()
    sub=p.add_subparsers(dest="cmd",required=True)
    for name,fn in [("status",status),("quickstart",quickstart),("release",release),("scoreboard",scoreboard),("closure",closure),("commit-candidate",commit_candidate),("manifest",manifest)]:
        sp=sub.add_parser(name); sp.set_defaults(func=fn)
    a=p.parse_args(); a.func(a)
if __name__=="__main__": main()
