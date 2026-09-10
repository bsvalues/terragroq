# Control Center sovereignty boundary

Status: **recorded boundary.** Found by the 2026-09-10 operations audit (finding F5).

## The problem this records

One repository contains two products with opposite AI laws, and nothing stated
which law applied where:

| Product | Runtime | Talks to |
| --- | --- | --- |
| **Control Center** (`control-center/`, FastAPI `:8420`) | local Ollama at `127.0.0.1:11434` | local only |
| **WilliamOS Console** (Next.js root app) | `GROQ_API_KEY` in `.env.local` | cloud Groq |

The Control Center is built on a **local-only, no-cloud, no-API-keys** doctrine —
it is the "second brain" and its value proposition is that nothing leaves the
machine. Sitting in the same repository, `.env.local` also carries a
`GROQ_API_KEY`, which the Next.js Console uses for cloud inference.

The result was an ambiguous guarantee: an operator reading "local-only" could not
tell whether it described the whole repository, one product, or one process. The
Control Center's own safety watchdog noticed the tension and reported it, but the
boundary itself was written down nowhere:

```
WARNING: Git remote detected — WilliamOS should be local-only.
```

## The boundary

1. **The Control Center is local-only.** It must not call an external inference
   provider, and it must not read a cloud API key. Its model runtime is the local
   Ollama endpoint. This is a product guarantee, not a default.

2. **The Next.js Console may use a cloud provider.** `GROQ_API_KEY` is its
   credential and cloud inference is a supported capability of that product.

3. **The two must not be conflated.** A cloud path existing in the repository is
   not a cloud path in the Control Center, and the Control Center's "local-only"
   claim is not a claim about the Next.js Console.

## What each check actually means

- `remote-status` / the safety watchdog warning about a git remote is a statement
  about **the vault and the repository**, not about inference. The vault is a
  personal brain; a remote is a sovereignty question for it. It does not describe
  where model tokens are computed.
- "No cloud LLM" in the Control Center's own doctrine (`GOAL.md`, hard rules)
  applies to **the Control Center**. It was written when the co-pilot was the only
  product in the repository.

## Not decided here

Removing the cloud path from the Console is **not** authorised by this document.
Whether the Next.js Console keeps cloud inference is a product-scope decision for
the owner; this file only states which rule applies to which product so that
"local-only" stops being ambiguous.
