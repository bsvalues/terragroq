import { execFile as execFileCallback } from "node:child_process"
import { promisify } from "node:util"

type GitRunOptions = Readonly<{
  cwd: string
  encoding: "utf8"
  maxBuffer: number
  shell: false
  timeout: number
  windowsHide: true
}>

export type HelloApplicationGitRunner = (
  file: string,
  args: string[],
  options: GitRunOptions,
) => Promise<Readonly<{ stdout: string; stderr: string }>>

const execFile = promisify(execFileCallback)

const defaultGitRunner: HelloApplicationGitRunner = async (file, args, options) => {
  const result = await execFile(file, args, options)
  return { stdout: String(result.stdout), stderr: String(result.stderr) }
}

export async function readHelloApplicationProjectHead(
  workspaceRoot: string,
  run: HelloApplicationGitRunner = defaultGitRunner,
): Promise<string> {
  const result = await run("git", ["rev-parse", "--verify", "HEAD^{commit}"], {
    cwd: workspaceRoot,
    encoding: "utf8",
    maxBuffer: 65_536,
    shell: false,
    timeout: 5_000,
    windowsHide: true,
  })
  const head = result.stdout.trim()
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(head)) {
    throw new Error("HELLO_APPLICATION_PROJECT_HEAD_INVALID")
  }
  return head.toLowerCase()
}
