# AI Frontend — API Flow Reference

> Covers **Ask**, **Onboarding**, and **Roadmap** features.
> Auth endpoints are excluded. All API calls go through the Next.js proxy at `/api/proxy/*`.
> Every request includes `Authorization: Bearer <accessToken>`. On a 401, the client silently calls `POST /auth/refresh` and retries once.

---

## Part 1 — Ask

---

### 1.1 When: Page loads

Two calls fire in parallel.

---

**Call A**
```
GET /api/proxy/welcome/ask
```

Response:
```json
{ "attributes": { "message": "Hello! How can I help you today?" } }
```

Handled: The message string is inserted as the first assistant bubble in the chat. No data is persisted anywhere.

---

**Call B**
```
GET /api/proxy/conversations?skip=0&limit=20
```

Response:
```json
{
  "attributes": {
    "total": 42,
    "items": [
      { "id": "conv-1", "title": "BSN registration", "created_at": "..." },
      { "id": "conv-2", "title": "Housing allowance",  "created_at": "..." }
    ]
  }
}
```

Handled: The `items` array is stored as the conversation list. Shown in the left sidebar.

---

### 1.2 When: User scrolls to the bottom of the sidebar

```
GET /api/proxy/conversations?skip=<page × 20>&limit=20
```

Handled: New items are appended to the existing conversation list. The page counter increments.

---

### 1.3 When: User clicks a conversation in the sidebar

```
GET /api/proxy/conversations/<conversationId>/messages?skip=0&limit=100
```

Response:
```json
{
  "attributes": {
    "items": [
      { "id": "msg-1", "role": "user",      "content": "What is a BSN?" },
      { "id": "msg-2", "role": "assistant", "content": "A BSN is..." }
    ]
  }
}
```

Handled: The `items` array replaces the current chat messages entirely. All previous bubbles are cleared.

---

### 1.4 When: User submits a message

```
POST /api/proxy/ask
Content-Type: application/json

Body: { "message": "What documents do I need?", "conversation_id": "conv-1" }
```

> `conversation_id` is omitted when starting a brand new conversation.

Response:
```json
{
  "attributes": {
    "conversation_id": "conv-1",
    "content": "You will need a passport and...",
    "content_blocks": [
      { "type": "text",   "content": "You will need a passport and..." },
      { "type": "source", "content": "BSN Guide p.4" }
    ],
    "rag_used": true,
    "rag_sources": ["BSN Guide"]
  }
}
```

Handled:
1. The user's message is immediately shown as a chat bubble (before the API responds)
2. A "thinking..." placeholder bubble is added
3. When the response arrives, the placeholder is replaced with the assistant's answer
4. If this was a brand new conversation, `conversation_id` is saved and the sidebar is reloaded
5. Any `content_blocks` with `type: "source"` are extracted and saved to `localStorage` under `sourceTagCacheByConversation[conversationId][messageId]`

---

## Part 2 — Onboarding

Triggered when the user clicks the **Roadmap** button on the chat page.

---

### 2.1 When: User clicks the Roadmap button

```
GET /api/proxy/roadmap
```

Handled:
- **200 OK** — roadmap already exists. Navigate straight to `/roadmap`. Onboarding is skipped entirely.
- **404 / error** — no roadmap yet. Continue to step 2.2.

---

### 2.2 When: No roadmap exists — fetch the first question

```
GET /api/proxy/roadmap/onboarding/next?answers=%7B%7D
```

`%7B%7D` is `encodeURIComponent(JSON.stringify({}))` — an empty object because no questions have been answered yet.

Response:
```json
{
  "attributes": {
    "question": {
      "key": "living_situation",
      "type": "single_choice",
      "question": "What is your current living situation?",
      "options": [
        { "value": "renting",  "label": "Renting" },
        { "value": "owning",   "label": "Owning" },
        { "value": "staying",  "label": "Staying with someone" }
      ]
    },
    "progress": { "current_index": 0, "total_questions": 4, "is_complete": false }
  }
}
```

Handled: The question text is added as an assistant bubble. `allAnswers` is initialised as `{}`. The progress counter shows `1 of 4`.

> This is the **only** time `GET /onboarding/next` is called. All subsequent questions come back inside the answer response below.

---

### 2.3 When: User answers a question

```
POST /api/proxy/roadmap/onboarding/answer?answers=<encodeURIComponent(JSON.stringify(allPreviousAnswers))>
Content-Type: application/json

Body: { "question_key": "living_situation", "answer": "renting" }
```

The query param `answers` is everything answered **before** this question. The body is **only** the current question and answer.

How the query param grows with each round:

| Round | `answers` query param (decoded) | Body |
|-------|--------------------------------|------|
| 1 | `{}` | `{ "question_key": "living_situation", "answer": "renting" }` |
| 2 | `{ "living_situation": "renting" }` | `{ "question_key": "has_bsn", "answer": "no" }` |
| 3 | `{ "living_situation": "renting", "has_bsn": "no" }` | `{ "question_key": "family_size", "answer": "2" }` |
| 4 | `{ "living_situation": "renting", "has_bsn": "no", "family_size": "2" }` | `{ "question_key": "arrival_date", "answer": "less_than_6_months" }` |

`allAnswers` is a plain object — not an array. Each key is a unique question ID so values never overwrite each other:

```json
{
  "living_situation": "renting",
  "has_bsn":          "no",
  "family_size":      "2",
  "arrival_date":     "less_than_6_months"
}
```

Response (same shape every round — returns the **next** question):
```json
{
  "attributes": {
    "question": {
      "key": "has_bsn",
      "type": "yes_no",
      "question": "Do you already have a BSN number?"
    },
    "progress": { "current_index": 1, "total_questions": 4, "is_complete": false }
  }
}
```

Handled:
1. The user's answer is shown as a chat bubble
2. `allAnswers` is updated: `allAnswers["living_situation"] = "renting"`
3. A short delay (300–800ms) is added to feel conversational
4. The next question from the response is shown as an assistant bubble
5. Repeat from 2.3 until `is_complete` is true

What the UI shows depends on the question `type`:

| `type` | UI |
|--------|----|
| `open` | Textarea + send button |
| `yes_no` | "Yes" and "No" buttons |
| `single_choice` | One button per option |
| `multi_choice` | One button per option |
| `info` | No input needed — auto-acknowledged immediately |

**Error (422):** Backend returns `{ errors: [{ detail: "..." }] }`. Displayed as an assistant error bubble. The same question stays active so the user can retry.

---

### 2.4 When: All questions answered (`is_complete: true`)

Three situations trigger the final step:

1. The response returns `"is_complete": true`
2. The next question has `type: "info"` — the frontend adds `{ [nextQ.key]: "acknowledged" }` automatically
3. `question` in the response is `null` and `is_complete` is `true`

In all three cases, `POST /onboarding/complete/stream` is called immediately.

---

### 2.5 When: Onboarding is complete — generate the roadmap

```
POST /api/proxy/roadmap/onboarding/complete/stream
Content-Type: application/json
Accept: text/event-stream

Body: {
  "answers": {
    "living_situation": "renting",
    "has_bsn":          "no",
    "family_size":      "2",
    "arrival_date":     "less_than_6_months"
  }
}
```

This is a **Server-Sent Events** stream. The frontend receives events one by one:

| Event | Data | Handled |
|-------|------|---------|
| `progress` | `{ "pct": 40, "message": "Building your plan..." }` | Progress bar updates to 40%, status text updates |
| `final` | Full roadmap object | Roadmap data ready |
| `done` | _(empty)_ | Progress set to 100%, message: "Your roadmap is ready!" |
| `error` | `{ "detail": "..." }` | Error message shown in chat |

After `done`: wait 250ms → navigate to `/roadmap`.

---

## Part 3 — Roadmap

---

### 3.1 When: `/roadmap` page loads

```
GET /api/proxy/roadmap
```

Response:
```json
{
  "attributes": {
    "overall_progress_pct": 25,
    "categories": [
      { "id": "cat-1", "category": "municipality", "sequence_no": 1, "status": "in_progress", "progress_pct": 50, "total_steps": 6, "completed_steps": 3 },
      { "id": "cat-2", "category": "housing",       "sequence_no": 2, "status": "locked",      "progress_pct": 0,  "total_steps": 4, "completed_steps": 0 },
      { "id": "cat-3", "category": "language",      "sequence_no": 3, "status": "not_started", "progress_pct": 0,  "total_steps": 5, "completed_steps": 0 }
    ]
  }
}
```

Handled:
- **Failure** → redirect to `/chat` which triggers onboarding
- **Success** → `categories` stored, sorted by `sequence_no`. Shown as the left sidebar.
- The first non-locked category (municipality if available) is auto-selected → triggers 3.2

`status` values and what they mean in the sidebar:

| `status` | Sidebar |
|----------|---------|
| `locked` | Greyed out. Click opens a modal showing which categories to complete first. |
| `not_started` | Clickable. No progress shown. |
| `in_progress` | Clickable. Partial progress bar. |
| `completed` | Checkmark. Still clickable. |

---

### 3.2 When: A category is selected (auto or by click)

```
GET /api/proxy/roadmap/categories/<categoryId>
```

Response:
```json
{
  "attributes": {
    "steps": [
      {
        "id": "step-1",
        "step_number": 1,
        "question_key": "has_bsn",
        "question_text": "Do you have a BSN number?",
        "question_type": "yes_no",
        "options": null,
        "answer": null,
        "status": "active"
      },
      {
        "id": "step-2",
        "step_number": 2,
        "question_key": "bsn_type",
        "question_text": "What type of BSN appointment do you need?",
        "question_type": "single_choice",
        "options": [
          { "value": "first",   "label": "First registration" },
          { "value": "renewal", "label": "Renewal" }
        ],
        "answer": null,
        "status": "pending"
      },
      {
        "id": "step-3",
        "step_number": 3,
        "question_key": "address_reg",
        "question_text": "Have you registered your address?",
        "question_type": "yes_no",
        "options": null,
        "answer": null,
        "status": "pending"
      }
    ]
  }
}
```

> For a returning user, completed steps will have their previous answer in the `answer` field (e.g. `"answer": "yes"`). The frontend uses this to show "Your answer: Yes" on completed steps without any extra API call.

Handled:
- `steps` array is stored. Shown as the step list in the main panel.
- The first step with `status: "active"` is selected. Fallback: first `pending`, then index 0.
- Immediately triggers 3.3 for the selected step.

What UI is shown depends on `question_type`:

| `question_type` | UI |
|-----------------|-----|
| `info` | Text only + "Got it, continue →" button. No input. |
| `yes_no` | "Yes" / "No" buttons |
| `single_choice` | One button per option |
| `multi_choice` | One button per option |
| `open` | Active textarea |

---

### 3.3 When: A step becomes active (on load or after answering)

```
GET /api/proxy/roadmap/steps/<stepId>/chat
```

Response:
```json
{
  "attributes": {
    "messages": [
      { "id": "m-1", "role": "assistant", "content": "Let me explain this step..." },
      { "id": "m-2", "role": "user",      "content": "What if I don't have one?"  }
    ]
  }
}
```

Handled: Messages are stored and shown in the chat area below the step question. A 404 means no history yet — treated as an empty chat, not an error.

---

### 3.4 When: User selects a button option

No API call. The selection is stored locally:

```
selectedAnswers["step-1"] = "yes"
```

The user can change this freely. Nothing is sent to the backend until they submit.

---

### 3.5 When: User submits their answer

```
POST /api/proxy/roadmap/steps/<stepId>/answer
Content-Type: application/json

Body: { "answer": "yes", "answer_data": null }
```

Response:
```json
{
  "attributes": {
    "completed_step":       { "id": "step-1", "answer": "yes", "status": "completed" },
    "next_step":            { "id": "step-2", "status": "active" },
    "new_steps_added":      [],
    "reset_steps":          [],
    "deleted_step_ids":     [],
    "category_progress_pct": 33,
    "category_completed":   false,
    "validation_error":     null,
    "routed_to_chat":       false,
    "chat_response":        null
  }
}
```

Handled — the frontend rebuilds the `steps` array in this fixed order:

```
1. Replace completed_step in place (marks it answered)
2. Remove all IDs in deleted_step_ids (cleans up old branch steps)
3. Replace all steps in reset_steps in place, clear their saved answers (wipes downstream answers)
4. Insert new_steps_added immediately after completed_step (adds new branch steps)
5. Replace next_step in place (marks it as active)
```

Then: navigate to `next_step`, load its chat history (3.3).

The sidebar category progress is also updated immediately using `category_progress_pct`.

**Special response cases:**

| Field | Condition | What happens |
|-------|-----------|--------------|
| `validation_error` | Non-null string | Shown as a chat bubble. Same step stays active. No navigation. |
| `routed_to_chat: true` | With `chat_response` | `chat_response.content` shown as a chat bubble. Same step stays active. No navigation. |
| `category_completed: true` | — | See 3.6 below |

---

### 3.6 When: `category_completed` is true in an answer response

1. A celebration banner is shown (e.g. "Municipality Complete!")
2. Immediately call:
    ```
    GET /api/proxy/roadmap
    ```
    Handled: All categories are refreshed. Categories that just unlocked will now show as `not_started` instead of `locked`.
3. After 2800ms: dismiss the banner, auto-select the next non-locked category → triggers 3.2

---

### 3.7 When: User types a message in the step chat

```
POST /api/proxy/roadmap/steps/<stepId>/chat
Content-Type: application/json

Body: { "message": "Can you explain what a BSN is?" }
```

Response:
```json
{
  "attributes": {
    "content": "A BSN is a citizen service number...",
    "content_blocks": [{ "type": "text", "content": "A BSN is a citizen service number..." }]
  }
}
```

Handled: The user's message and the assistant's reply are appended to `chatMessages`.

> This is only available when the step's `question_type` is `open`. All other step types block the text input and show a notice.

---

### 3.8 When: User clicks a locked category

No API call. The frontend checks a hard-coded dependency map:

```
housing             → requires: municipality
health              → requires: municipality
job                 → requires: municipality
education           → requires: municipality
permanent_residency → requires: municipality + language
```

It filters those dependencies to the ones not yet completed, then shows a modal listing them with their current progress (e.g. "Complete Municipality — 3 of 6 steps done").

---

## End-to-End Call Order

```
/chat (Ask mode)
  page load     →  GET /welcome/ask
                   GET /conversations?skip=0&limit=20
  sidebar scroll→  GET /conversations?skip=N&limit=20
  click conv    →  GET /conversations/:id/messages
  send message  →  POST /ask

  click Roadmap button
    →  GET /roadmap
         200  →  navigate to /roadmap
         404  →  GET /onboarding/next?answers={}
                   ↓ loop
                   POST /onboarding/answer?answers=<prev>
                   ↓ is_complete
                 POST /onboarding/complete/stream  (SSE)
                 →  navigate to /roadmap

/roadmap
  page load        →  GET /roadmap
                         →  GET /roadmap/categories/:id
                               →  GET /roadmap/steps/:id/chat
  click category   →  GET /roadmap/categories/:id
                         →  GET /roadmap/steps/:id/chat
  click step       →  GET /roadmap/steps/:id/chat
  submit answer    →  POST /roadmap/steps/:id/answer
                         →  GET /roadmap/steps/:nextId/chat
  category done    →  GET /roadmap
                         →  GET /roadmap/categories/:nextId
                               →  GET /roadmap/steps/:id/chat
  send chat msg    →  POST /roadmap/steps/:id/chat
```
