# WilliamOS command shortcuts

vault := "WilliamOS"

init:
    python scripts/william.py init

today:
    python scripts/william.py today

weekly:
    python scripts/william.py weekly

inbox text:
    python scripts/william.py inbox "{{text}}"

decision title:
    python scripts/william.py decision "{{title}}"

doctrine title:
    python scripts/william.py doctrine "{{title}}"

concept title:
    python scripts/william.py concept "{{title}}"

case title:
    python scripts/william.py case "{{title}}"

check:
    python scripts/william.py check

mcp-check:
    python scripts/william.py mcp-check

orphans:
    python scripts/william.py orphans

stale:
    python scripts/william.py stale-decisions

graph:
    python scripts/william.py graph

search q:
    rg "{{q}}" {{vault}}

synth-week:
    python scripts/william.py synth-week

synth-week-dry:
    python scripts/william.py synth-week --dry-run

synth-status:
    python scripts/william.py synth-status

sem-index:
    python scripts/william.py semantic-index

sem-search q:
    python scripts/william.py semantic-search "{{q}}"

sem-status:
    python scripts/william.py semantic-status

sem-clear:
    python scripts/william.py semantic-clear --confirm

inbox-status:
    python scripts/william.py inbox-status

process-inbox:
    python scripts/william.py process-inbox

process-inbox-dry:
    python scripts/william.py process-inbox --dry-run

doctrine-status:
    python scripts/william.py doctrine-status

promote-doctrine:
    python scripts/william.py promote-doctrine

promote-doctrine-dry:
    python scripts/william.py promote-doctrine --dry-run

decision-status:
    python scripts/william.py decision-status

promote-decisions:
    python scripts/william.py promote-decisions

promote-decisions-dry:
    python scripts/william.py promote-decisions --dry-run

concept-status:
    python scripts/william.py concept-status

promote-concepts:
    python scripts/william.py promote-concepts

promote-concepts-dry:
    python scripts/william.py promote-concepts --dry-run

project-status:
    python scripts/william.py project-status

promote-projects:
    python scripts/william.py promote-projects

promote-projects-dry:
    python scripts/william.py promote-projects --dry-run

cortex-status:
    python scripts/william.py cortex-status

cortex-map:
    python scripts/william.py cortex-map

cortex-map-dry:
    python scripts/william.py cortex-map --dry-run

cockpit-status:
    python scripts/william.py cockpit-status

cockpit:
    python scripts/william.py cockpit

cockpit-html:
    python scripts/william.py cockpit --html

cockpit-dry:
    python scripts/william.py cockpit --dry-run

git-status:
    python scripts/william.py git-status

git-init:
    python scripts/william.py git-init

snapshot-dry:
    python scripts/william.py snapshot --dry-run

snapshot msg:
    python scripts/william.py snapshot --message "{{msg}}"

snapshot-manifest:
    python scripts/william.py snapshot-manifest

backup-status:
    python scripts/william.py backup-status

backup-dry:
    python scripts/william.py backup --dry-run

backup-manifest:
    python scripts/william.py backup-manifest

backup-verify archive:
    python scripts/william.py backup-verify "{{archive}}"

backup dest:
    python scripts/william.py backup --dest "{{dest}}"

restore-status:
    python scripts/william.py restore-status

restore-manifest:
    python scripts/william.py restore-manifest

restore-drill archive dest:
    python scripts/william.py restore-drill --archive "{{archive}}" --dest "{{dest}}"

restore-drill-keep archive dest:
    python scripts/william.py restore-drill --archive "{{archive}}" --dest "{{dest}}" --keep

restore-runtime-proof archive dest:
    python scripts/william.py restore-runtime-proof --archive "{{archive}}" --dest "{{dest}}"

restore-runtime-proof-latest dest:
    python scripts/william.py restore-runtime-proof --latest --dest "{{dest}}"

remote-status:
    python scripts/william.py remote-status

remote-strategy:
    python scripts/william.py remote-strategy

remote-readiness:
    python scripts/william.py remote-readiness

release-status:
    python scripts/william.py release-status

acceptance-dry:
    python scripts/william.py acceptance --dry-run

acceptance:
    python scripts/william.py acceptance

release-manifest:
    python scripts/william.py release-manifest

release-tag-dry name:
    python scripts/william.py release-tag --name "{{name}}" --dry-run

routine-status:
    python scripts/william.py routine-status

daily-review:
    python scripts/william.py daily-review

daily-review-dry:
    python scripts/william.py daily-review --dry-run

weekly-review:
    python scripts/william.py weekly-review

weekly-review-dry:
    python scripts/william.py weekly-review --dry-run

monthly-review:
    python scripts/william.py monthly-review

monthly-review-dry:
    python scripts/william.py monthly-review --dry-run

review-status:
    python scripts/william.py review-status

review-queues:
    python scripts/william.py review-queues

review-queues-dry:
    python scripts/william.py review-queues --dry-run

acceptance-checklist:
    python scripts/william.py acceptance-checklist

acceptance-checklist-all:
    python scripts/william.py acceptance-checklist --lane all

accept-status:
    python scripts/william.py accept-status

accept-plan draft:
    python scripts/william.py accept-plan --draft "{{draft}}"

accept-log:
    python scripts/william.py accept-log

closure-status:
    python scripts/william.py closure-status

post-acceptance:
    python scripts/william.py post-acceptance

post-acceptance-dry:
    python scripts/william.py post-acceptance --dry-run

post-acceptance-cortex:
    python scripts/william.py post-acceptance --refresh-cortex

post-acceptance-checklist:
    python scripts/william.py post-acceptance-checklist

maintenance-status:
    python scripts/william.py maintenance-status

maintenance-dry:
    python scripts/william.py maintenance-review --dry-run

maintenance-review:
    python scripts/william.py maintenance-review

maintenance-manifest:
    python scripts/william.py maintenance-manifest

maintenance-tag-dry name:
    python scripts/william.py maintenance-tag --name "{{name}}" --dry-run

drive-backup-status:
    python scripts/william.py drive-backup-status

drive-backup-plan dest:
    python scripts/william.py drive-backup-plan --dest "{{dest}}"

drive-backup-plan-dry dest:
    python scripts/william.py drive-backup-plan --dest "{{dest}}" --dry-run

drive-backup dest:
    python scripts/william.py drive-backup --dest "{{dest}}"

drive-backup-log:
    python scripts/william.py drive-backup-log

runtime-status:
    python scripts/william.py runtime-status

runtime-smoke:
    python scripts/william.py runtime-smoke

runtime-smoke-dry:
    python scripts/william.py runtime-smoke --dry-run

help-all:
    python scripts/william.py help-all

command-status:
    python scripts/william.py command-status

command-report:
    python scripts/william.py command-report

command-report-dry:
    python scripts/william.py command-report --dry-run

schema-status:
    python scripts/william.py schema-status

schema-check:
    python scripts/william.py schema-check

schema-report:
    python scripts/william.py schema-report

schema-report-dry:
    python scripts/william.py schema-report --dry-run

obsidian-status:
    python scripts/william.py obsidian-status

obsidian-quality:
    python scripts/william.py obsidian-quality

obsidian-quality-dry:
    python scripts/william.py obsidian-quality --dry-run

production-status:
    python scripts/william.py production-status

production-readiness:
    python scripts/william.py production-readiness

commit msg:
    git add .
    git commit -m "{{msg}}"

export file out:
    pandoc "{{file}}" -o "{{out}}"
