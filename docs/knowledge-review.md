# Easumi knowledge review

The Next.js workspace at `/knowledge` reads through a same-origin Next.js API route, which forwards the signed-in user's bearer token to FastAPI. Python subprocesses, database profiles, and database tunnels are not needed by the frontend.

## Configuration

Set `API_BASE_URL` in Vercel's environment settings, including the API prefix, for example `https://your-backend.example/api/v1`. This is a server-only variable. Configure Preview and Production separately to select their respective backends. Redeploy after changing it; existing auth proxy rewrites also use this variable at build time.

On the backend, add each authorized staff user's ID to the existing `ADMIN_USER_IDS` setting. Requests use normal account authentication; there is no shared admin API key. Backend staff authorization rejects guests, inactive accounts, and users outside the allowlist.

Sign in at `/login?next=/knowledge`. All successful logins return to the workspace. The home page opens knowledge review; former chat and roadmap URLs redirect there. Existing session refresh is reused. Anonymous visitors see a sign-in message and receive no review records.

For local development, set `API_BASE_URL=http://127.0.0.1:8010/api/v1` in `.env.local`, run the backend, then:

```bash
npm run dev -- --hostname 127.0.0.1 --port 3015
```

Visit http://127.0.0.1:3015/knowledge.

## Read endpoints

- `GET /admin/kaya/knowledge/gaps?filter[status]=open&page[limit]=25&page[offset]=0&filter[signal]=missing_knowledge`
- `GET /admin/kaya/knowledge/gaps/{gap_id}`
- `GET /admin/kaya/feedback/reports?filter[status]=quarantined&page[limit]=25&page[before]=...`
- `GET /admin/kaya/feedback/messages?limit=25&before=...`

All paths above are relative to `/api/v1`. Gap statuses are open, researching, answered, and rejected. Feedback uses the existing status filters and cursor pagination. Search covers loaded records. Both lists show 25 records per page with Previous/Next controls. Gaps use an offset; feedback uses cursors. The record list and detail panel scroll independently. User correction claims are explicitly unverified.

Both lists return `meta.total`, the number of records in the selected status rather than on the page. The first summary card and the `Page n of m` label read it; when a backend does not send it they fall back to `—` and a page number alone.

## What the detail panel shows

The detail panel follows the recorded request through review to delivery:

- **Question understood in context** — the retrieval question, falling back to the original question.
- **Context** — municipality, topic, language and supported user profile choices, when saved. Empty fields are omitted.
- **Validator checks** — recorded feedback on the initial draft and later checks, plus the final validation outcome. Draft issues may have been corrected before delivery.
- **Sources** — internal record references and captured external web URLs, before the final answer.
- **Final answer** — the stored assistant message, redacted by the backend.
- **Reader feedback** — ratings, comments, and detected corrections. Standalone message feedback is available separately from feedback reports.

Signal badges appear with explanations beside the request, evidence, validation, or final answer section where they apply. The broad `knowledge_gap` signal is available as a filter but is not repeated as a badge. Signal filters run on the backend and apply equally to page rows and totals. Gap capture remains unchanged: a recorded signal does not necessarily mean the delivered answer still has a knowledge gap.

Raw diagnostics are excluded from reviewer responses. Missing source or answer information is identified without reconstructing it. User context capture applies to new turns; historical records can lack these fields.

The Next.js `/api/knowledge` route accepts only GET operations `gaps`, `gap`, `feedback`, and `messages`. Credentials are forwarded only to the configured backend, redirects are rejected, and responses are not cached. Promotion, review mutations, and ingestion are not exposed by this route or workspace. Existing backend mutation endpoints are unchanged.

## Submit a reviewed answer

Record Details now includes a reviewed-answer form for knowledge gaps. Submit once;
the page tracks background work and confirms when the answer is available through
RAG retrieval. The server controls the environment. Local testing uses
`KNOWLEDGE_RESOLUTION_ENVIRONMENT=local`; the browser sends only an `answer` attribute in a JSON:API resource document.

The full stage-by-stage implementation and local setup guide is in the sibling
backend repository: [One-step knowledge resolution](../../ai-platform/docs/one-step-knowledge-resolution.md).

The answer form now supports all three tabs: System Detected Gap, User feedback,
and Voting feedback. Each submission preserves its source and question context.
Voting feedback uses the backend's existing `message_feedback` storage; resolving
it does not change the user's vote. `/knowledge` is the default landing page,
and login honors the supported `next` destination.


The knowledge transport uses JSON:API 1.1 (`application/vnd.api+json`) throughout.
Submission data has type `knowledge-resolutions`; responses use resource objects
with IDs and attributes, and errors use an `errors` array. Next.js body parsing is
disabled for this proxy so vendor-type JSON is parsed explicitly with a size cap.
The client adapts standard wire resources to the existing dashboard view shape.


Submission now shows a toast and retains the reviewed answer in the textarea.
Records display a pending clock while processing and a green check only when the
knowledge is available. Review holds and failures use attention indicators. These
states survive refreshes and update while reviewing other records.

A separate, free, backend-hosted operator GUI is available locally at
`http://127.0.0.1:8010/api/v1/ops/queues`. It uses the existing admin allowlist and
is independent of this frontend. See the backend walkthrough for staging and
production rollout URLs, worker lifecycle, and monitoring commands.

Question grouping now appears in System Detected Gap. Equivalent phrasings share
a card. Gap cards carry no status or occurrence badge; open **View original
questions** to inspect each original question and its own status, evidence and
submission. Status badges remain on User feedback and Voting feedback cards.
Grouping preserves all original records. See [the stage-by-stage backend walkthrough](../../ai-platform/docs/one-step-knowledge-resolution.md#stage-8--group-differently-worded-questions-going-forward-and-historically)
for matching rules, local commands and the staging/production backfill runbook.

Gap cards do not label an occurrence that is still awaiting grouping, so a card
on its own does not represent a confirmed single-occurrence group. Historical records
need the backend backfill; verify its final `remaining` count is zero, then use
**Refresh** in the dashboard. Local backfill verification and the Koggenland BSN
example are recorded in the backend walkthrough linked above.

The System Detected Gap list hides records whose only active signal is
`validator_revise` (draft rewritten). Records with additional signals, including
missing knowledge, remain visible. This is a frontend display filter; stored
reports and backend pagination totals are unchanged, so pages can contain fewer
than 25 visible cards. User feedback and Voting feedback are not filtered.


For current submission, extension, conflict replacement, and same-job correction
acceptance checks in both this UI and the backend API, see
[local knowledge submission checks](../../ai-platform/docs/knowledge-submission-local-checks.md).
