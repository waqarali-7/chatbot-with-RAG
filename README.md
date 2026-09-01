# Inbound lead agent — demo and eval harness

A text agent that qualifies inbound leads and books appointments for a fictional
multi-location dental and aesthetics clinic, plus the eval harness that says whether it
actually works.

Three artifacts ship together:

| Route | What it is |
|---|---|
| `/` | The chat demo. Anyone can open it and book. |
| `/evals` | The scorecard. A real eval run, per-metric thresholds. |
| `/about-this-assistant` | The chatbot info card, shown in disclosure modes B and C. |
| `/admin` | Bookings, behind basic auth, so a booking can be verified rather than trusted. |

The third artifact is the differentiator: the same eval suite run across three disclosure
modes, reporting what each costs in booking completion. Everyone arguing about AI
disclosure is asserting the conversion impact. Measuring it turns a policy argument into a
number.

---

## Run it

```bash
pnpm install && pnpm ingest && pnpm dev
```

That is the whole setup. No API keys, no database.

With no credentials configured, every role falls back to a deterministic offline
stand-in: a rule-based receptionist for the agent, BM25 over the corpus for retrieval, and
heuristics for the judge. The demo works, the tests run, and the full eval suite produces
real numbers. **Every trace and every result file records which provider actually served
each call, and `/evals` leads with a banner when a run was not produced by the production
stack.** An offline run can never be mistaken for a graded one.

To run the real thing, copy `.env.example` to `.env.local` and fill in what you have. Each
role is routed independently, so a partial setup works.

```bash
pnpm eval          # everything, writes evals/results/
pnpm eval:gate     # the regression gate; runs in the build
pnpm test          # unit tests, scorer negative controls, gate
```

---

## How it is put together

```
app/            chat demo, scorecard, info card, admin, API routes
lib/llm/        provider interface + anthropic, openai, offline stand-in
lib/agent/      system prompt, humanization, guardrails, disclosure, turn loop
lib/rag/        chunking, BM25 and pgvector backends, retrieval with a similarity floor
lib/booking/    slot store, availability, holds, confirmation
evals/          datasets, personas, scorers, runner, thresholds, gate
content/        persona and the synthetic corpus. Swap these to re-skin the vertical.
```

### Booking is done in code, not by the model

The model is never given the power to hold or confirm a slot. The turn loop resolves what
the visitor referred to, takes a row-level lock on the slot store, and then tells the model
what happened so the reply can reflect it.

That is why `inventedSlots = 0` is a property of the system rather than a hope about the
prompt, and why a tampered client-side conversation state cannot produce a phantom booking:
every slot is re-checked against the store before anything is held or confirmed.

### The humanization layer is code, not prompt

The prompt states the style rules and gets them right most of the time, then drifts across a
long conversation, silently. So `lib/agent/humanize.ts` validates every generation before it
reaches the visitor: length, sentence count, list formatting, dashes, banned openers,
assistant register, stacked questions, recap of the visitor's own words, over-acknowledgement,
emoji budget. On a violation it retries once with the violation named, then repairs
deterministically.

Two-sentence replies are emitted as two bubbles, each with a typing delay of
`600ms + 40ms × characters`, capped at 4s, with 20% jitter. The jitter matters as much as the
delay: a perfectly uniform pause is its own tell.

### What streams is bubbles, not tokens

The style validator and the output guardrails need the whole generation before anything
reaches the visitor, so token streaming would mean streaming text that might have to be
withdrawn. What the visitor sees is a typing indicator and then a message arriving, which is
what the humanization spec is actually asking for. Time to first token is still measured from
the provider stream and lands in every trace.

### Abstention is two-stage

The similarity floor catches the easy gaps: nothing clears it, nothing is returned, and the
agent has nothing to answer from. That alone is not enough. Three of the twelve deliberately
unanswerable golden questions retrieve a *highly relevant* chunk that does not contain the
answer — parking at the Clapham site, a hearing loop at Shoreditch — and no floor separates
those from a question the corpus does answer.

So the second stage decomposes every reply into atomic claims and grounds each one against
the retrieved context, the availability that was genuinely on offer, and what the visitor
themselves said. That is what holds `abstentionRate` at 1.00.

### The chat UI is deliberately ordinary

White ground, grey bubbles left, one solid colour right, a real typing indicator, timestamps
only on gaps. No gradient header, no glowing orb, no sparkle icon, no robot avatar. Any
bespoke "AI chat" styling signals bot before the first message and undermines the entire
test. Copying the familiar messaging pattern is the correct choice here, not the lazy one.

The scorecard does the opposite job and looks nothing like it.

---

## What the current run shows, and what it does not

The committed results in `evals/results/` were produced offline. Read them accordingly.

**Holds on any stack, and enforced by the gate on any stack:**

- `abstentionRate` 1.00 — no confabulation on any of the twelve unanswerable questions
- Guardrail violations 0, invented slots 0, claims to be human 0, lectures 0, across all 50 runs
- `goalCompletion` 1.00 on the bookable personas

**Does not transfer, and is labelled as such on `/evals`:**

- `tellRate` 0.00 is a property of the stand-in, not a result. It emits replies from templates
  written to satisfy the style rules, so it cannot trip scorers built to catch a model
  drifting. The scorers are shown to bite by 21 negative controls in
  `evals/scorers/scorers.test.ts`, and the gate refuses to pass without them.
- The disclosure comparison is degenerate on this run. The stand-in consumes the disclosure
  clause only when someone asks what it is, so all three modes drive identical transcripts and
  the delta is necessarily zero. The apparatus is real; the comparison needs a model.
- `recall@5` 0.79 and `falseAbstention` 0.63 are BM25 numbers. Every miss is a vocabulary gap
  a dense retriever closes: "check up" against "examination", "instalments" against "finance".
  The absolute thresholds are defined for the dense stack, so the gate switches those rows to
  no-regression against `evals/baseline.json` and marks them `baseline` rather than `pass`.

**Outstanding:**

- The blind clock-rate study needs three human labellers who have not seen the system. The
  40 excerpts are built and the scoring is implemented; no rate is reported and none is
  estimated. `pnpm tsx scripts/clock-study.ts <name>` prints the blinded set.

---

## Deliberate deviations from the spec

- **The chat route runs on Node, not edge.** Edge is right once Supabase backs the slot store,
  and switching is one line in `app/api/chat/route.ts`. But with no Supabase the store is
  in-process, and an edge function does not share memory with the Node-rendered `/admin`, so a
  booking made in the chat would never appear there. "A cold visitor can open the link, book,
  and see it in `/admin`" is a definition-of-done item and it should hold with zero setup.
  Nothing is lost: this route does not stream tokens.
- **Ground truth in the golden set is a set, not a single chunk id.** Chunks carry 50 tokens of
  overlap and some facts are genuinely stated twice, so "the" ground-truth chunk is not well
  defined. `recall@5` counts a hit on any chunk containing the evidence.
- **Similarity floors are per backend.** 0.35 is the spec floor for dense cosine. BM25 sits on a
  different scale and carries its own, calibrated by a documented rule in
  `scripts/calibrate-floor.ts`.
- **Rate limiting is in-process.** 40 messages per hour per IP, per instance. It exists to stop
  one person burning the token budget, not as a security control.

---

## Swapping the vertical

Edit `content/persona.md` and `content/docs/`, then `pnpm ingest && pnpm tsx scripts/build-golden.ts`.
The golden set resolves its evidence phrases against the new corpus and fails loudly if any
no longer resolve, so ground truth cannot silently drift.

Everything else — the style rules, the guardrails, the ladder, the disclosure modes, the
scorers — is vertical-independent.

---

## Notes

Every document behind the agent is synthetic. Meridian Dental & Aesthetics is not a real
practice, and no client data is used anywhere in this project. Prospect-supplied documents,
transcripts and knowledge bases are explicitly out of scope for this build.
