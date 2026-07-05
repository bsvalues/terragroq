# WO-AUTHORITY-004 - Blocked Actions Registry

RESULT: PASS

## Blocked Actions

The registry lists 18 blocked action classes:

- command execution
- command runner
- GitHub write integration
- Codex automation
- Docker metadata
- backup scanning
- port checks
- filesystem scan
- dynamic ingestion
- DB/schema mutation
- production deploy
- cloud setting changes
- LAN exposure
- service/schedule creation
- secrets disclosure
- Hermes/MCP/autonomy activation
- TerraFusion/PACS touch
- unrelated container touch

## Safety

Command execution added: false. The safe default for each blocked action is blocked until owner-approved gate.

