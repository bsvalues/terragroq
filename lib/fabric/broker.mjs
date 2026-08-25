import { auditFabricAction, requireLedger } from "./audit.mjs"
import {
  decodeCliXml,
  defaultExec,
  defaultFabricRoot,
  encodePowerShell,
  meaningfulSshError,
  readRegistry,
  sshArgs,
} from "./transport.mjs"

/**
 * The one way this application touches a node.
 *
 * The lab already had a broker: a Python CLI holding the service key, pinning host keys, refusing
 * nodes that are not in the registry, and appending every action to a single audit log. The
 * application then grew its own ssh calls beside it -- the node probe and the baseline gate each
 * built their own arguments -- so actions taken by the product were absent from the ledger that was
 * supposed to record what happened in this lab. Two mechanisms, one of them invisible.
 *
 * This makes the brokered path the only path for code in this repository: unknown nodes are denied
 * rather than attempted, host keys are pinned, and every call lands in the SAME audit log the CLI
 * writes, in the same format. One ledger, or it is not a ledger.
 *
 * It deliberately does not reimplement the transport. `transport.mjs` already knows how to survive
 * Windows ssh teardown, cmd quoting, PowerShell encoding and CLIXML; that hard-won knowledge is
 * called, not copied. Those primitives used to live in `run-baseline.mjs` -- one of this module's own
 * callers -- which is why the baseline gate could never be routed through here without closing an
 * import cycle, and why it kept a raw transport for four revisions. The split removed the cycle.
 */

/**
 * Carry a POSIX command without asking any shell to preserve its quoting.
 *
 * The Windows path already does this for PowerShell via -EncodedCommand. POSIX bodies were still
 * shipped literally, which meant `quoteForCmd` had to survive them -- and it escapes an embedded
 * double quote as \" , the convention a C runtime uses, NOT the one cmd.exe uses. A probe containing
 * `echo "host=$(hostname)"` was therefore torn apart by cmd before ssh ever saw it, and ssh exited 255
 * with no useful reason. Base64 has no metacharacters, so nothing downstream can reinterpret it.
 */
export function encodePosix(command) {
  return `echo '${Buffer.from(command, "utf8").toString("base64")}' | base64 -d | bash`
}

export const POLICY_DENY = "POLICY_DENY"

export class BrokerDenied extends Error {
  constructor(node, known) {
    super(`${POLICY_DENY}: unknown node "${node}" (allowed: ${known.join(", ")})`)
    this.name = "BrokerDenied"
    this.node = node
    this.allowed = known
  }
}

/** Kept as the broker's name for the shared ledger, so existing callers do not have to move. */
export const auditBrokerAction = auditFabricAction

/**
 * Resolve a node through policy, or refuse.
 *
 * Refusing an unknown name matters more than it looks: the registry is the list of machines this lab
 * has decided to manage, and a typo that silently reaches a different host is how a management plane
 * starts acting on something nobody authorised.
 */
export async function resolveBrokeredNode(name, { fabricRoot = defaultFabricRoot(), registry } = {}) {
  const nodes = registry ?? (await readRegistry(fabricRoot))
  const node = nodes[name]
  if (!node) throw new BrokerDenied(name, Object.keys(nodes))
  return node
}

/**
 * Run a command on a node, through policy, with the result recorded.
 *
 * Every outcome is audited -- success, non-zero exit, and refusal alike. An audit that only records
 * what worked describes a system nobody has ever operated.
 *
 * `requireAudit` is for callers whose evidence is part of the action rather than a note about it. It
 * checks the ledger BEFORE the node is touched, so an action that cannot be recorded does not happen
 * at all. Checking afterwards would only ever tell the caller that a mutation it had already made is
 * missing from the record, which is a worse outcome dressed as a better one. Off by default: reads
 * and machines that have never had a fabric directory are the common case and neither is a fault.
 */
export async function brokeredExec(name, command, options = {}) {
  const {
    fabricRoot = defaultFabricRoot(),
    registry,
    exec = defaultExec,
    timeout = 60_000,
    action = "exec",
    requireAudit = false,
  } = options

  if (requireAudit) await requireLedger(fabricRoot)

  let node
  try {
    node = await resolveBrokeredNode(name, { fabricRoot, registry })
  } catch (error) {
    if (error instanceof BrokerDenied) {
      await auditBrokerAction(fabricRoot, name, action, "denied", error.message).catch(() => {})
    }
    throw error
  }

  const local = node.transport === "local"
  const windows = node.os === "windows"

  try {
    if (local) {
      const { stdout, stderr } = await exec("powershell", ["-NoProfile", "-Command", command], { timeout, windowsHide: true })
      await auditBrokerAction(fabricRoot, name, action, 0, command, { required: requireAudit })
      return { stdout, stderr: decodeCliXml(stderr) }
    }
    const remote = windows ? encodePowerShell(command) : encodePosix(command)
    const { stdout, stderr } = await exec("ssh", sshArgs(node, remote, fabricRoot), { timeout, windowsHide: true })
    await auditBrokerAction(fabricRoot, name, action, 0, command, { required: requireAudit })
    return { stdout, stderr: decodeCliXml(stderr) }
  } catch (error) {
    const reason = meaningfulSshError(error?.stderr) || String(error?.message ?? "")
    await auditBrokerAction(fabricRoot, name, action, error?.code ?? 1, `${command} :: ${reason}`).catch(() => {})
    throw error
  }
}
