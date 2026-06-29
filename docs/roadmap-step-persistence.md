# Roadmap Step Persistence & Resume

How the frontend remembers where a user was and resumes from that point.

---

## Overview

All roadmap and onboarding state is **server-driven** — there is no localStorage for step position. The frontend always fetches the current state from the backend on load, then rebuilds the UI from the server response.

---

## Onboarding Session (chat.tsx)

### Session lifecycle

On page load, `wsGetOnboardingSession()` is called. The backend returns one of three states:

| `sessionStatus` | Meaning |
|----------------|---------|
| `none` | No session exists — start fresh |
| `in_progress` | Session exists, user didn't finish — resume |
| `closed` | Session complete — show restart option |

### Resume flow (`in_progress`)

**File:** [pages/chat.tsx](../pages/chat.tsx) — lines 752–798

```
Page load
  └── wsGetOnboardingSession()
        ├── sessionStatus = 'in_progress'
        │     ├── initialAnswers = sessionResp.attributes.answers   ← saved Q&A pairs
        │     ├── wsGetOnboardingHistory(initialAnswers)             ← rebuild past messages
        │     └── wsGetNextQuestion(initialAnswers)                  ← fetch next unanswered Q
        │
        └── Rebuild chat UI
              ├── Past Q messages  → id: "resume-q-{key}"
              ├── Past A messages  → id: "resume-a-{key}"
              └── Current question → shown as new message
```

The `initialAnswers` array (loaded from the server) drives everything. Each element is a `{key, answer}` pair representing one completed onboarding question. The frontend reconstructs the full conversation history from this array, then asks the backend for the next unanswered question.

### Closed session handling

When `sessionStatus === 'closed'`, the frontend displays the goodbye history and offers a "restart" button. The user's completed answers are not lost — they live in the database.

---

## Roadmap Steps (roadmap.tsx)

### Step state

**File:** [pages/roadmap.tsx](../pages/roadmap.tsx) — lines 206–410

Each roadmap step has a persistent `answer` field in the database. On load:

```
Page load
  └── Fetch roadmap with all categories + steps
        └── For each step:
              ├── step.answer       ← persisted answer from DB
              ├── step.completed    ← whether step is marked done
              └── wsGetStepChat(stepId) ← load chat history for this specific step
```

The `currentStepIndex` in component state tracks which step is active within a category, but this is derived from the server data (e.g. the first incomplete step), not stored locally.

### Checklist selections

Checklist-type steps (multiple-choice answers) use a `selectedAnswers` map in component state (line 223), populated from `step.answer` on load. Selections are saved back to the server on change.

---

## Authentication persistence

**File:** [lib/api-client.ts](../lib/api-client.ts) — lines 154–166

```
localStorage keys:
  accessToken   ← JWT, used on every API call
  refreshToken  ← used to get new accessToken on 401
  user          ← cached user object
```

These are the only keys stored in localStorage. Tokens are refreshed automatically on 401 responses. All roadmap/step state lives in the database, not the browser.

---

## What happens on browser refresh

1. Auth tokens are read from localStorage → user stays logged in
2. `wsGetOnboardingSession()` fetches server state → session status determined
3. If `in_progress` → history rebuilt from `initialAnswers`, next question fetched
4. Roadmap page fetches all steps fresh → `step.answer` and `step.completed` restore UI state
5. Source tags for chat messages are cached in localStorage per `(conversationId, messageId)` — these are cosmetic only and do not affect step state

---

## Summary

| State | Where stored | How restored |
|-------|-------------|--------------|
| Onboarding progress | Database (`answers` array) | `wsGetOnboardingSession()` on load |
| Current question | Derived from `answers` | `wsGetNextQuestion(answers)` |
| Step answers | Database (`step.answer`) | Fetched with roadmap on load |
| Step chat history | Database | `wsGetStepChat(stepId)` per step |
| Auth tokens | localStorage | Read on every page load |
| Message source tags | localStorage (cache only) | `getPersistedSourceTags()` |
