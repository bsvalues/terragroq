# The Environment: six jobs, simulated end to end

Status: acceptance simulations for the owner's product decision of 2026-08-20 (#762).
The decision: **the Desk is the environment, the Conversation is the operating language** — one
environment that breathes between dialog-shape and desk-shape, driven by intent, never presented as
modes. A workspace is not an object you manage; it is the current working world, assembled when work
is named and restored meaningfully on "where were we".

These are not mockups. Each simulation traces a complete job beat by beat and answers, at every step:
what does William see, what can William say, what appears, what recedes, what does Hermes do
underneath, and when is William actually interrupted. Strains are recorded honestly — a simulation
that only flatters the concept is worthless. The controlling rule set: CONVERSATION-FIRST,
OWNER_FINAL_ONLY, the spatial contract, and the owner-gate categories (financial, destructive,
production, protected, legal, credential, policy, scope, priority). The old Workbench is the "before"
picture and appears nowhere in these traces.

## The vocabulary (five words, no more)

- **The Line** — the conversation. In dialog-shape it is the widest thing on screen; in desk-shape it
  is a strip along the bottom. It is never gone, never a window to find, and typing anywhere reaches
  it. It is the operating language: every sentence in it can reshape everything else.
- **Surfaces** — real representations: a syntax-highlighted editor, a running browser, a live diff, a
  terminal, test output, a diagram, a data table, an agent-at-work view, a rendered document. A file
  is a file. A diff is a diff. Nothing is a card *about* the thing; every surface *is* the thing.
- **Breathing** — the continuum between one-stage dialog-shape and many-surface desk-shape. Intent
  moves it ("show them side by side" widens; "just talk to me for a second" recedes everything).
  Manual pin/split/drag always works; WilliamOS does the obvious arrangement first.
- **The World** — the assembled context of the named work: repository, branch, running dev
  environment, relevant files, related memory and conversations, active agents, open concerns. Loaded
  by naming the work, never constructed by hand.
- **The Memory** — the workspace's own story: everything agents did, decided, failed, and recovered,
  answerable at any moment ("what happened overnight?") and the substrate of restoration.

Chrome disappears behind the work. The visual language is rich — real highlighting, real rendering,
real apps — not the monochrome console DNA of the before picture.

---

## Job 1 — "This login flow is broken. Find out why and fix it."

**Opening state:** empty environment, the Line full width. No project selected — there is no such act
as selecting a project.

1. **William says** exactly that sentence.
2. **Underneath:** Hermes resolves the world. Two candidates carry a login (TerraFusion, WilliamOS);
   TerraFusion has the recent auth churn in memory, so it is the assumption. *The assumption is
   stated, not asked:* the Line replies "Taking this as TerraFusion's login — one word corrects me.
   Reproducing it now." The World assembles silently: repo, current branch, dev server started on
   HERMES, auth-related memory recalled.
3. **William sees** the environment breathe out once: a **browser surface** opens running TerraFusion,
   driven to the failing flow — he watches the redirect bounce happen, live, without touching
   anything. Beside it, a **trace surface**: the actual requests, the 302 chain, the cookie that dies.
4. **The Line narrates the finding** in owner language: "Two auth surfaces are mounted. The legacy
   flow still intercepts the redirect and eats the session cookie. Fix: remove the legacy mount,
   repoint the redirect. Doing it — the diff will be here before anything lands."
5. **Underneath:** Hermes derives the bounded work order (reservation: the two auth files; validators:
   test, build) under the standing authority the sentence "fix it" carries for routine repository
   work. It is recorded, receipted, dispatched to a worker. **Nothing about this appears as UI.**
6. **William sees** the browser surface stay; the trace recedes; a **diff surface** materializes when
   the worker finishes — real diff, minus the legacy mount. A **test surface** flicks through the
   suite: green. The browser surface reruns the flow: login sticks.
7. **William can say** anything at any beat: "wait — why are there two auth surfaces at all?"
   (investigation answers in the Line, work pauses), "don't touch the session file" (constraint lands
   in the running work order), or nothing.
8. **Interrupted?** Never. No gate category is crossed. Merge happens behind review and tests; the
   evidence attaches to this conversation's moment in the Memory. If the fix had, say, renamed a
   published API path, exactly one sentence would have arrived: "This also renames a published path —
   rename, or alias the old one?"

**Verdict: natural.** The whole job is four sentences from William, none of them system vocabulary.
**Strain (S1):** the *assume-and-state* norm is load-bearing. If WilliamOS asks clarifying questions
instead of stating corrigible assumptions, this becomes an interrogation and dies. Hard rule for the
architecture: ambiguity is resolved by stated assumption whenever a wrong guess is cheap.

---

## Job 2 — "Build this UI idea. I don't know exactly what I want yet."

**Opening state:** dialog-shape. This job lives in conversation longer than any other.

1. **William rambles.** Half-thoughts, "kind of like X but not", a pasted screenshot of something he
   half-likes. The Line takes all of it; nothing is classified; nothing becomes a work object.
2. **The Line thinks with him** — asks at most one real question, proposes directions in words first.
3. **William sees** the first materialization only when there is something worth seeing: **two or
   three small prototype surfaces — running, clickable sketches**, not mockups. Each is labeled
   `sketch` (not a branch, not the repo — the label is the only governance visible, and it is one
   word).
4. **William says** "second one, but darker, and the list should feel like cards." The second sketch
   rebuilds in place; the others recede into the recent rail.
5. "Show me the first one again next to it" — **the environment breathes toward desk-shape**: two
   sketches side by side. He pokes both. They are real running surfaces; poking is using.
6. "That one. Make it real." **Underneath:** now — and only now — Hermes turns the chosen sketch into
   governed work: branch, work order, reservation over the real component paths, tests. The sketch
   surface's label flips from `sketch` to the branch name. Same surface, now real.
7. Tests, diff, review proceed as in Job 1. **Interrupted?** Only if realization crosses a gate.
8. **What recedes:** everything about losing candidates — but the Memory keeps them; "what was the
   third option again?" resurrects it as a sketch.

**Verdict: natural — this is the job the operating language exists for.**
**Strain (S2):** the sketch/real seam must stay one visible word on the surface. If making-it-real
sprouts ceremony (forms, approvals for routine realization), the vibe dies at the exact moment of
commitment.

---

## Job 3 — "Codex changed this overnight. Show me what happened and have Claude review it."

**Opening state:** morning. William opens the environment cold.

1. **William sees, before saying anything:** the Line's first message is the night, told as a story —
   three sentences, not a feed: "Overnight: the suite split finished (12 files), one test regressed
   and was remediated, the rename is holding for your call. Nothing else moved." Each clause is a
   handle — pressable, or just answerable.
2. **William says** "show me what happened." The **Memory unfolds** in the Line — the night's moments,
   each expandable to its real artifact. Not a page he navigated to; an answer he was given.
3. "Have Claude review it." **Underneath:** Hermes dispatches the review lane against the exact
   overnight head, bounded to review. An **agent surface** appears small in the corner: Claude,
   reading, progress honest.
4. **William sees** the review land **as annotations on the diff surface itself** — findings pinned to
   the lines they are about, with the reviewer's one-paragraph verdict in the Line. Not a separate
   review page. The diff is the review's home.
5. **William can say** "agree with the second finding, fix it" (remediation dispatches), "ignore the
   style one" (recorded, closed), or "walk me through the router change" (the diff surface scrolls
   and the Line explains, anchored).
6. **Interrupted?** Once, legitimately: the held rename from the night was a genuine gate (published
   path). It arrives as the sentence it always was. He answers in words; the night's last work
   completes.

**Verdict: natural.** The return path is a story plus one honest question.
**Strain (S3):** review-as-annotation requires reviews to be diff-anchored data, not prose blobs. That
is a hard requirement on the review lane's output format — a seam to specify, not an afterthought.

---

## Job 4 — "Try both approaches and let me compare them."

**Opening state:** mid-conversation about an implementation choice.

1. **William says it.** **Underneath:** Hermes forks the work: two bounded work orders, two branches,
   two workers (or one worker twice, sequenced — capacity is Hermes's problem, invisible here).
2. **William sees** an **agent strip** while they work — two small honest progress surfaces. He keeps
   talking about something else entirely in the Line; the environment does not hold him hostage to
   the build.
3. When both land: **the desk breathes wide** — approach A running beside approach B, real apps, plus
   one thin **compare strip**: tests, bundle delta, the two diffs' shapes. He drives both with his own
   hands.
4. **William says** "left one, but take the right one's error handling." **Underneath:** Hermes
   composes — cherry-picks the error path from B's branch onto A's, reruns, shows the combined diff.
5. "Kill the other one." B's branch archives; its surface recedes; the Memory keeps the road not
   taken, resurrectable.
6. **Interrupted?** Never, unless composition crosses a gate.

**Verdict: natural — and this is the job that killed dialog-root alone.** Two live things at once is
the whole answer, and the conversation stays the composer.
**Strain (S4):** "take the right one's error handling" is a semantic merge instruction. Sometimes it
will not compose cleanly. The honest behavior is a plain sentence — "those two touch the same three
lines; here is the conflict" — with the conflict as a real surface. Never a silent best-effort.

---

## Job 5 — "Something is wrong with Hermes. Figure it out without making me troubleshoot it."

**Opening state:** anything. This is the meta-job: the system examining itself.

1. **William says it.** **Underneath:** WilliamOS turns its own diagnostic capabilities on itself —
   lane status, inference reachability, disk and volume preconditions, the audit trail, recent
   failures. These already exist as runtime capabilities; here they are conversational tools.
2. **William sees** infrastructure appear *because it is now the work* — his rule. One **system
   surface**: the actual finding taking shape, not a wall of green/red tiles. The Line narrates in
   owner language: "Found it. The inference container lost its network attachment when Docker
   restarted at 03:10 — every reply since then died silently. Reattached; and the attachment is now
   declared in the compose file so a restart cannot un-fix it. Receipt attached."
3. **William says** nothing, or "how long was it broken?", or "why didn't you catch it before I did?"
   — and that last question gets an honest answer plus, underneath, a derived finding: add the missing
   precondition check. Discovery becomes work without a meeting.
4. **Interrupted?** Only if the repair itself crosses a gate — e.g. restarting something that would
   kill active work: "Fixing this restarts inference; Codex is mid-build. Now, or when it finishes?"
   One sentence, two answers, both his in three words.
5. **What never happens:** William pasting commands, reading logs himself, or being told to check
   something. The moment the environment asks him to be the technician, this job has failed.

**Verdict: natural in shape — with the hardest dependency of the six.**
**Strain (S5):** this job is only as good as the runtime's self-observation seam. The lane walls,
volume preconditions, audit chain and diagnostics built these past days are exactly the organs it
needs, but they must be reachable as tools of the conversation, not scripts on a disk. That seam —
runtime lane's — is named, not assumed.

---

## Job 6 — "Continue the TerraFusion suite split from wherever we stopped yesterday."

**Opening state:** cold open, next day.

1. **William says it.** **Underneath:** restoration is semantic, not photographic. The Memory holds
   yesterday's meaningful state: the branch, the last green and last red test, the pending gate
   nobody answered, which surfaces mattered at the end, the open concern ("the rename").
2. **William sees** the World reassemble in about a breath: source surface at the file where work
   stopped, test surface showing the exact red that stopped it, and the Line saying where things
   stand: "Stopped at the router rename — you never made that call. Everything else is green and
   merged. Continuing the split around it; the rename still needs you."
3. **Underneath:** Hermes resumes continuation — the remaining split work orders derive and dispatch
   under yesterday's still-valid authority. A grant revoked overnight would have stopped them; that
   check runs at every derivation.
4. **William answers the one pending sentence** whenever he likes. Or leaves again. The work continues
   either way, minus only the gated part.
5. **Interrupted?** He was greeted with exactly one held decision — the same one from Job 3's night.
   Nothing new.

**Verdict: natural — durable autonomy is the differentiator no inspiration product has.**
**Strain (S6):** "meaningful state" needs a real definition: the semantic snapshot (branch heads, open
concerns, pending gates, last artifacts, surfaces-that-mattered). It is a designed object with a
schema, not a serialized window layout. First-class architecture work.

---

## The verdict, and what it binds

**All six jobs pass as natural in the combined environment.** None passes in either concept alone —
Jobs 4 and 6 kill pure dialog-root, Jobs 2 and 3 embarrass pure desk-root — which is the strongest
evidence the owner's synthesis (Desk as environment, Conversation as operating language) is the
product and not a compromise.

The six strains are the first six requirements of the frontend architecture, in priority order:

| # | Requirement | From |
|---|---|---|
| S1 | Ambiguity resolves by stated corrigible assumption, never interrogation | Job 1 |
| S6 | The semantic snapshot: a schema for meaningful working state | Job 6 |
| S2 | Sketch → real is one visible word, never ceremony | Job 2 |
| S3 | Reviews are diff-anchored data; annotations live on the artifact | Job 3 |
| S4 | Semantic merge conflicts surface as real conflicts, never silent best-effort | Job 4 |
| S5 | Runtime self-observation reachable as conversational tools (runtime-lane seam) | Job 5 |

Per the owner's gate — "if the design handles those six naturally, then build the new frontend
architecture" — the gate is passed and the architecture work begins, carrying these six requirements
and the frozen rejections. The before picture stays running, untouched, until the new environment can
do a real day's work.
