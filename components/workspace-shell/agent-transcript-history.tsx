"use client"

import type { AgentProvider, CompletedAgentTurn } from "./agent-sessions"

export function AgentTranscriptHistory({
  sessionKey,
  role,
  provider,
  assignment,
  truth,
  turns,
}: {
  sessionKey: string
  role: string
  provider: AgentProvider
  assignment: string
  truth: "live" | "resume-unverified"
  turns: readonly CompletedAgentTurn[]
}) {
  return (
    <section
      role="region"
      aria-label="Agent transcript"
      data-session-key={sessionKey}
      className="my-2 max-h-56 overflow-y-auto rounded-md border border-[#334032] bg-[#0b100b] shadow-inner shadow-black/30"
    >
      <header className="sticky top-0 z-10 border-b border-[#293328] bg-[#0e140e]/95 px-3 py-2 backdrop-blur-sm">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <strong className="truncate text-[10px] font-semibold tracking-[0.08em] text-[#d8e2d4]">
            {role} · {provider}
          </strong>
          <span className={`shrink-0 font-mono text-[8.5px] ${truth === "resume-unverified" ? "text-[#c7a97a]" : "text-[#8fb08a]"}`}>
            {truth === "resume-unverified" ? "saved · resume unverified" : "live · verified"}
          </span>
        </div>
        <p className="mt-0.5 truncate text-[9.5px] text-[#9fac9b]" title={assignment}>{assignment}</p>
      </header>

      {turns.length === 0 ? (
        <p className="px-3 py-4 text-[10px] text-[#748171]">No completed turns yet.</p>
      ) : (
        <ol className="divide-y divide-[#222b21]">
          {turns.map((turn, index) => (
            <li key={`${turn.completedAt}:${index}`} className="grid gap-2 px-3 py-2.5">
              <time dateTime={turn.completedAt} className="font-mono text-[8.5px] tracking-[0.04em] text-[#687466]">
                {turn.completedAt}
              </time>
              <div className="grid grid-cols-[3.4rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-[10.5px] leading-4">
                <span className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-[#7f8d7c]">Owner</span>
                <p className="min-w-0 whitespace-pre-wrap break-words text-[#dce4d9]">{turn.ownerPrompt}</p>
                <span className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-[#8fa88a]">Result</span>
                <p className="min-w-0 whitespace-pre-wrap break-words text-[#aebca9]">{turn.finalResult}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
