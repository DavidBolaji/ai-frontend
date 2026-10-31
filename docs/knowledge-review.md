# Easumi knowledge review

The Next.js workspace at `/knowledge` reads through a same-origin Next.js API route, which forwards the signed-in user's bearer token to FastAPI. Python subprocesses, database profiles, and database tunnels are not needed by the frontend.

## Configuration

Set `API_BASE_URL` in Vercel's environment settings, including the API prefix, for example `https://your-backend.example/api/v1`. This is a server-only variable. Configure Preview and Production separately to select their respective backends. Redeploy after changing it; existing auth proxy rewrites also use this variable at build time.

On the backend, add each authorized staff user's ID to the existing `ADMIN_USER_IDS` setting. Requests use normal account authentication; there is no shared admin API key. Backend staff authorization rejects guests, inactive accounts, and users outside the allowlist.

Sign in at `/login?next=/knowledge`. All successful logins return to the workspace. The home page opens knowledge review; former chat and roadmap URLs redirect there. Existing session refresh is reused. Anonymous visitors see a sign-in message and receive no review records.

For local development, set `API_BASE_URL=http://127.0.0.1:8081/api/v1` in `.env.local`, run the backend, then:

```bash
npm run dev -- --hostname 127.0.0.1 --port 3015
```

Visit http://127.0.0.1:3015/knowledge.

## Read endpoints

- `GET /admin/kaya/knowledge/gaps?status=open&limit=25&offset=0&signal=missing_knowledge`
- `GET /admin/kaya/knowledge/gaps/{gap_id}`
- `GET /admin/kaya/feedback/reports?status=quarantined&limit=25&before=...`
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
