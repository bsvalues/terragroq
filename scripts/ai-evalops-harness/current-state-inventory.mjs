#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((value, index, all) => {
  if (!value.startsWith("--")) return ["", ""];
  return [value.slice(2), all[index + 1]];
}).filter(([key]) => key));

if (!args.output || !args["observed-at"]) {
  throw new Error("usage: current-state-inventory.mjs --output <path> --observed-at <ISO-8601>");
}

const observedAt = new Date(args["observed-at"]);
if (!Number.isFinite(observedAt.valueOf())) throw new Error("--observed-at must be ISO-8601");

const roots = {
  terragroq: "C:\\Users\\bs\\terragroq-review",
  HermesLab: "C:\\HermesLab",
};
const reservedOutputPatterns = [
  /^\?\? scripts\/ai-evalops-harness\/current-state-inventory\.mjs$/,
  /^\?\? docs\/reports\/ai-evalops-harness\/WO-AEH-002-/,
];

function run(command, commandArgs, options = {}) {
  try {
    return { ok: true, stdout: execFileSync(command, commandArgs, {
      encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024, ...options,
    }).trim() };
  } catch (error) {
    return { ok: false, error: `${error.code ?? "EXEC_ERROR"}` };
  }
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function source(file) {
  const text = readFileSync(file, "utf8");
  return { path: file, sha256: sha256(text), text };
}

function repoState(id, root) {
  const head = run("git", ["-C", root, "rev-parse", "HEAD"]);
  const branch = run("git", ["-C", root, "branch", "--show-current"]);
  const status = run("git", ["-C", root, "status", "--short"]);
  const entries = status.ok ? status.stdout.split(/\r?\n/).filter(Boolean)
    .filter((line) => !reservedOutputPatterns.some((pattern) => pattern.test(line.replaceAll("\\", "/")))) : [];
  return {
    id, root, head: head.ok ? head.stdout : null,
    branch: branch.ok ? (branch.stdout || "DETACHED") : null,
    dirty: entries.length > 0, statusEntries: entries.sort(),
    source: "git rev-parse/branch/status --short (read-only; reserved WO-AEH-002 outputs excluded)",
  };
}

function readJson(file) {
  const item = source(file);
  return { ...item, value: JSON.parse(item.text.replace(/^\uFEFF/, "")) };
}

function snapshotSummary(label, file) {
  const item = readJson(file);
  const timestamp = item.value.observed_at ?? item.value.timestamp ?? null;
  const rawAgeSeconds = timestamp ? Math.floor((observedAt - new Date(timestamp)) / 1000) : null;
  const clockAmbiguous = rawAgeSeconds !== null && rawAgeSeconds < 0;
  return {
    label, source: { path: item.path, sha256: item.sha256 }, observedAt: timestamp,
    ageSeconds: clockAmbiguous ? null : rawAgeSeconds, freshnessTtlSeconds: 300,
    clockAmbiguous,
    freshness: rawAgeSeconds === null ? "UNKNOWN" : clockAmbiguous ? "CLOCK_AMBIGUOUS_FUTURE" : rawAgeSeconds <= 300 ? "FRESH" : "STALE",
    scheduler: item.value.scheduler ?? "UNKNOWN",
    nodeHealth: item.value.node_health ?? item.value.status ?? "UNKNOWN",
    runningWorkloads: item.value.resources?.running_workloads ?? null,
  };
}

const readme = source(path.join(roots.HermesLab, "README.md"));
const serviceMap = source(path.join(roots.HermesLab, "SERVICE-MAP.md"));
const compose = source(path.join(roots.HermesLab, "hermes", "docker-compose.yml"));

const docker = run("docker", ["ps", "--format", "{{json .}}"]);
const containers = docker.ok && docker.stdout ? docker.stdout.split(/\r?\n/).map((line) => {
  const row = JSON.parse(line);
  return { name: row.Names, image: row.Image, state: row.State, status: row.Status, ports: row.Ports };
}).sort((a, b) => a.name.localeCompare(b.name)) : [];

const scheduledTaskResult = run("powershell", ["-NoProfile", "-Command",
  "$items=Get-ScheduledTask -TaskPath '\\' | Where-Object {$_.TaskName -like 'Hermes*'} | ForEach-Object {$i=Get-ScheduledTaskInfo $_; [pscustomobject]@{name=$_.TaskName;state=[string]$_.State;principal=$_.Principal.UserId;logonType=[string]$_.Principal.LogonType;runLevel=[string]$_.Principal.RunLevel;lastRunTime=$i.LastRunTime.ToUniversalTime().ToString('o');lastTaskResult=$i.LastTaskResult;nextRunTime=$i.NextRunTime.ToUniversalTime().ToString('o')}}; @($items | Sort-Object name) | ConvertTo-Json -Compress"
]);
const scheduledTasks = scheduledTaskResult.ok && scheduledTaskResult.stdout ? JSON.parse(scheduledTaskResult.stdout) : [];

const volumeResult = run("powershell", ["-NoProfile", "-Command",
  "$items=Get-Volume | Where-Object DriveLetter | ForEach-Object {[pscustomobject]@{drive=[string]$_.DriveLetter;fileSystem=[string]$_.FileSystemType;health=[string]$_.HealthStatus;operational=[string]$_.OperationalStatus;sizeBytes=[int64]$_.Size;freeGiBFloor=[math]::Floor($_.SizeRemaining/1GB)}}; @($items | Sort-Object drive) | ConvertTo-Json -Compress"
]);
const volumes = volumeResult.ok && volumeResult.stdout ? JSON.parse(volumeResult.stdout) : [];

const modelResult = run("docker", ["exec", "ollama", "ollama", "list"]);
const installedModels = modelResult.ok ? modelResult.stdout.split(/\r?\n/).slice(1).filter(Boolean).map((line) => {
  const fields = line.trim().split(/\s{2,}/);
  return { name: fields[0] ?? null, digestPrefix: fields[1] ?? null, size: fields[2] ?? null };
}).sort((a, b) => a.name.localeCompare(b.name)) : [];

const serviceIdentities = containers.map((container) => {
  const identity = run("docker", ["inspect", "--format", "{{.Config.User}}", container.name]);
  const declaredUser = identity.ok ? identity.stdout : "INSPECTION_UNAVAILABLE";
  return { service: container.name, declaredContainerUser: declaredUser || "IMAGE_DEFAULT_UNSPECIFIED" };
});

const relevantPorts = run("powershell", ["-NoProfile", "-Command",
  "$p=3000,5433,6379,9000,11434; Get-NetTCPConnection -State Listen | Where-Object {$p -contains $_.LocalPort} | Select-Object LocalAddress,LocalPort | Sort-Object LocalPort,LocalAddress | ConvertTo-Json -Compress"
]);
let listeners = [];
if (relevantPorts.ok && relevantPorts.stdout) {
  const parsed = JSON.parse(relevantPorts.stdout);
  listeners = (Array.isArray(parsed) ? parsed : [parsed]).map((x) => ({ address: x.LocalAddress, port: x.LocalPort }));
}

const containerByName = Object.fromEntries(containers.map((item) => [item.name, item]));
const contradictions = [];
for (const name of ["postgres", "redis"]) {
  if (containerByName[name]?.state === "running" && serviceMap.text.match(new RegExp(`\\| ${name} \\|[^\\n]+\\| \\*\\*STOPPED\\*\\* \\|`, "i"))) {
    contradictions.push({
      id: `HERMES_${name.toUpperCase()}_STATE_DRIFT`, severity: "HIGH",
      declared: "STOPPED / non-authoritative", observed: "running container",
      declaredSource: serviceMap.path, observedSource: "docker ps",
    });
  }
}
if (containerByName["open-webui"] && readme.text.includes("Open WebUI + Portainer (optional polish; images not pulled yet)")) {
  contradictions.push({ id: "HERMES_README_UI_DRIFT", severity: "MEDIUM", declared: "images not pulled", observed: "open-webui and portainer running", declaredSource: readme.path, observedSource: "docker ps" });
}

const floatingImages = containers.filter((x) => /:(latest|main)$/.test(x.image)).map((x) => ({ name: x.name, image: x.image }));
const broadListeners = listeners.filter((x) => ["0.0.0.0", "::"].includes(x.address));
const aegisSnapshot = readJson(path.join(roots.HermesLab, "aegis", "aegis-latest.json"));
const parseCompactUtc = (value) => value && /^\d{8}T\d{6}Z$/.test(value)
  ? new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`)
  : null;
const backupTime = parseCompactUtc(aegisSnapshot.value.backup?.last_backup);
const restoreTime = parseCompactUtc(aegisSnapshot.value.backup?.last_restore_verify);
const backupAgeSeconds = backupTime ? Math.floor((observedAt - backupTime) / 1000) : null;
const backupClockAmbiguous = backupAgeSeconds !== null && backupAgeSeconds < 0;

const inventory = {
  schema: "williamos-ai-evalops-current-state-inventory/1",
  workOrder: "WO-AEH-002",
  observedAt: observedAt.toISOString(),
  method: "read-only local inspection; no environment values, credentials, container labels, process command lines, or protected payloads captured",
  repositories: Object.entries(roots).map(([id, root]) => repoState(id, root)),
  localMachine: {
    hostname: os.hostname(), platform: os.platform(), release: os.release(), arch: os.arch(),
    cpuModel: os.cpus()[0]?.model ?? null, logicalCpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    source: "Node.js os module (local host only)",
  },
  declaredSources: [readme, serviceMap, compose].map(({ path: file, sha256: digest }) => ({ path: file, sha256: digest })),
  observedRuntime: {
    dockerAvailable: docker.ok, containers,
    relevantListeners: listeners,
    source: "docker ps minimal fields; Get-NetTCPConnection limited to declared lab ports",
  },
  scheduledTasks: {
    items: scheduledTasks,
    source: "Get-ScheduledTask/Get-ScheduledTaskInfo restricted to root tasks named Hermes*; actions and arguments excluded",
  },
  installedModels: {
    ollamaAvailable: modelResult.ok, items: installedModels,
    source: "docker exec ollama ollama list; model name, digest prefix, and size only",
  },
  disksAndMounts: {
    items: volumes,
    source: "Get-Volume drive-letter volumes; free capacity rounded down to whole GiB for deterministic evidence",
  },
  runtimeIdentities: {
    scheduledTaskPrincipals: scheduledTasks.map(({ name, principal, logonType, runLevel }) => ({ name, principal, logonType, runLevel })),
    containerUsers: serviceIdentities,
    source: "scheduled-task principals and Docker Config.User only; no tokens, profiles, environment, groups, or credential stores inspected",
  },
  backupMetadata: {
    source: { path: aegisSnapshot.path, sha256: aegisSnapshot.sha256, kind: "retained repository snapshot; not a live AEGIS probe" },
    generation: aegisSnapshot.value.backup?.last_backup ?? null,
    lastBackup: aegisSnapshot.value.backup?.last_backup ?? null,
    lastRestoreVerify: aegisSnapshot.value.backup?.last_restore_verify ?? null,
    backupAgeSeconds: backupClockAmbiguous ? null : backupAgeSeconds,
    thresholdHours: aegisSnapshot.value.backup?.threshold_hours ?? null,
    freshness: backupAgeSeconds === null ? "UNKNOWN" : backupClockAmbiguous ? "CLOCK_AMBIGUOUS_FUTURE" : backupAgeSeconds <= (aegisSnapshot.value.backup?.threshold_hours ?? 0) * 3600 ? "WITHIN_RETAINED_THRESHOLD" : "STALE",
    restoreClockAmbiguous: restoreTime ? restoreTime > observedAt : false,
    capabilityClaim: aegisSnapshot.value.backup?.capability ?? "UNKNOWN",
  },
  capabilitySnapshots: [
    snapshotSummary("Hermes", path.join(roots.HermesLab, "hermes", "hermes-placement.json")),
    snapshotSummary("Atlas", path.join(roots.HermesLab, "atlas", "atlas-placement.json")),
    snapshotSummary("AEGIS", path.join(roots.HermesLab, "aegis", "aegis-latest.json")),
  ],
  reconciliation: {
    contradictions,
    broadPublishedLabListeners: broadListeners,
    floatingRuntimeImages: floatingImages,
    conclusions: [
      "Historical capability snapshots do not establish live dispatch readiness after their five-minute TTL.",
      "Scheduler declarations remain OFF; running services do not imply execution authority.",
      "Dirty repository state is foreign/shared state and was not modified or normalized by this inventory.",
      "Atlas and AEGIS values are repository snapshot claims, not live probes from this local-only run.",
    ],
  },
};

writeFileSync(args.output, `${JSON.stringify(inventory, null, 2)}\n`, "utf8");
