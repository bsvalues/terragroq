# Contributing & Operating Guide

WilliamOS is a governance product, so the way we build it should reflect the way it
asks *you* to work: scoped changes, explicit authority, evidence before closure.
This guide is the disciplined workflow for changing this codebase.

---

## 1. Ground rules

1. **One slice, one concern.** Don't bundle unrelated changes. If you find a second
   thing while you're in there, write it down — don't silently expand scope
   (that's MP-002).
2. **Pure logic stays pure.** Anything in `lib/goal/`, `lib/governance/`,
   `lib/work-orders/` must remain free of I/O, randomness, and clock-dependence so
   it stays deterministic and testable. Side effects belong in `app/actions/`.
3. **Server actions are the only mutation boundary.** They authenticate
   (`getSession`), scope by `userId`, call the pure core, persist, and append an
   audit event — in that order.
4. **Never weaken an invariant to make a feature easier.** The invariants in
   `docs/ARCHITECTURE.md` §7 are the product. If a change appears to require
   breaking one, that's a design discussion, not a quiet edit.
5. **Docs travel with code.** If you change behavior, update the matching doc in
   the same slice. Stale docs are worse than no docs.

---

## 2. Local development

```bash
pnpm install
pnpm dev          # http://localhost:3000, Turbopack
pnpm test         # Vitest — run before every commit
pnpm build        # production build; gates on lint + types
```

Required environment variables (see README): `DATABASE_URL`, `BETTER_AUTH_SECRET`,
`BETTER_AUTH_URL`. In v0 these come from the Neon integration and project settings.

---

## 3. The development loop (practice what we preach)

For any non-trivial change, follow the same shape the console enforces:

1. **Classify the work.** What lane is it (docs / ui / read_model / write_model /
   schema / auth / release)? What authority does it actually need? Most UI and read
   work is A0–A2 and low-risk; schema, auth, and release are not.
2. **Read current truth first.** Inspect the real files before editing (don't
   assume — that's MP-006). Use the reference docs to find the right module.
3. **Scope it.** Know your allowed files and your validators *before* you edit.
4. **Implement narrowly.** Touch only what the slice needs.
5. **Verify.** Run `pnpm test` and, for user-visible changes, check the preview in
   the browser. A clean type-check is not proof the behavior is correct.
6. **Evidence + close.** Summarize what changed, what you verified, and what you
   deliberately deferred.

---

## 4. Testing

The suite lives in `tests/` and covers the pure governance core:

| File | Covers |
| ---- | ------ |
| `tests/goal-console.test.ts` | The classifier: lane/mode detection, authority derivation, verdicts, mistake patterns. |
| `tests/work-order-lifecycle.test.ts` | Legal/illegal transitions, approval-readiness, closure report. |
| `tests/governance.test.ts` | Authority grants, execute-guard, loop-engine stop conditions, hashing. |

Rules:
- Any change to a pure module in `lib/` must keep its tests green and add cases for
  new behavior.
- The invariants are the most important tests — if you touch authority,
  execute-guard, or the loop engine, make sure the "approval ≠ authority" and
  "execute never mutates" cases still hold.
- Run `pnpm test` (not just `test:watch`) before committing.

---

## 5. Changing the data model

The schema is `lib/db/schema.ts` (Drizzle) applied to Neon via the integration —
there is no migrate script in the repo.

- Prefer **additive** changes (new nullable columns, new tables). Additive schema
  maps to A4 authority.
- Destructive changes (drops, non-additive migrations) are A5 — high-risk, explicit
  approval each time, and should be rare.
- Always add `userId` to a new register and scope every query by the session user.
- Add the `$inferSelect` type export at the bottom of `schema.ts` alongside the
  others.

---

## 6. Adding a new register / surface

The repo has a consistent shape — follow it:

1. Add the table + type to `lib/db/schema.ts`.
2. Add pure helpers under `lib/governance/` (or `lib/goal/`) if there's any
   decision logic. Keep it I/O-free.
3. Add a server-action file under `app/actions/` (auth-gate, scope, persist, audit).
4. Add the route under `app/(shell)/` and a nav entry in
   `components/shell/nav-items.ts`.
5. Add components under `components/<surface>/`.
6. Add a reference doc under `docs/reference/` and link it from the README +
   `docs/ARCHITECTURE.md`.
7. Add tests for the new pure logic.

---

## 7. Git discipline

- Never push directly to `main` / the default branch. Work on a feature branch and
  open a PR.
- Release actions (commit / tag / push) are gated work — treat them as their own
  step, never a side effect of implementation (MP-005).
- Keep commits scoped to the slice with a clear message.
