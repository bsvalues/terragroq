"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"

import { authClient } from "@/lib/auth-client"

export function EnvironmentSignIn() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)

    try {
      const result = await authClient.signIn.email({ email, password })
      if (result.error) throw new Error(result.error.message ?? "SIGN_IN_FAILED")
      router.replace("/environment")
      router.refresh()
    } catch {
      setError("That email and password did not open the environment.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#090b0f] px-5 py-12 text-neutral-100">
      <section className="w-full max-w-sm" aria-labelledby="environment-sign-in-title">
        <div className="mb-10 h-px bg-gradient-to-r from-transparent via-sky-300/70 to-transparent" aria-hidden />
        <h1 id="environment-sign-in-title" className="text-balance text-2xl font-medium tracking-[-0.025em]">
          Return to your environment
        </h1>
        <p className="mt-2 text-sm leading-6 text-neutral-400">Your working world will be restored after you sign in.</p>

        <form className="mt-8 space-y-5" onSubmit={submit}>
          <label className="block text-sm text-neutral-300">
            <span className="mb-2 block">Email</span>
            <input
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-base text-white outline-none transition focus:border-sky-300/70 focus:ring-2 focus:ring-sky-300/20"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
              autoFocus
            />
          </label>
          <label className="block text-sm text-neutral-300">
            <span className="mb-2 block">Password</span>
            <input
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-base text-white outline-none transition focus:border-sky-300/70 focus:ring-2 focus:ring-sky-300/20"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              minLength={8}
              required
            />
          </label>

          {error ? (
            <p className="rounded-lg border border-red-300/20 bg-red-400/10 px-3 py-2 text-sm text-red-100" role="alert">
              {error}
            </p>
          ) : null}

          <button
            className="w-full rounded-xl bg-sky-200 px-4 py-3 text-sm font-medium text-slate-950 transition hover:bg-sky-100 focus:outline-none focus:ring-2 focus:ring-sky-200 focus:ring-offset-2 focus:ring-offset-[#090b0f] disabled:cursor-wait disabled:opacity-60"
            type="submit"
            disabled={busy}
          >
            {busy ? "Opening…" : "Open environment"}
          </button>
        </form>
      </section>
    </main>
  )
}
