# Hosted knowledge review

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

- `GET /admin/kaya/knowledge/gaps?status=open&limit=25&offset=0`
- `GET /admin/kaya/knowledge/gaps/{gap_id}`
- `GET /admin/kaya/feedback/reports?status=quarantined&limit=25&before=...` (existing)

All paths above are relative to `/api/v1`. Gap statuses are open, researching, answered, and rejected. Feedback uses the existing status filters and cursor pagination. Search covers loaded records. Both lists show 25 records per page with Previous/Next controls. Gaps use an offset; feedback uses cursors. The record list and detail panel scroll independently. User correction claims are explicitly unverified.

The Next.js `/api/knowledge` route accepts only GET operations `gaps`, `gap`, and `feedback`. Credentials are forwarded only to the configured backend, redirects are rejected, and responses are not cached. Promotion, review mutations, and ingestion are not exposed by this route or workspace. Existing backend mutation endpoints are unchanged.
