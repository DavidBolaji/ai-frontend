# Frontend Implementation Guide

This document covers three features that require correct frontend implementation. Each section describes when and how to communicate with the backend, what the response looks like, and what actions to take.

---

## 1. Save PDF Button on Summary Steps

### When to Show the Button

Every step response includes a `metadata_` object. If `metadata_.is_summary === true`, the step is a summary step and a **Save PDF** button must be rendered.

```ts
// Show button when:
step.metadata_?.is_summary === true
```

This flag is set server-side on specific steps (e.g. municipality registration guides, school checklists). You do not control which steps are summaries — you just read the flag and render a button that calls the endpoint below.

---

### Calling the Export Endpoint

PDF export uses **HTTP**, not WebSocket.

**Request**

```
POST /api/v1/roadmap/export/step-pdf
Content-Type: application/json
Authorization: Bearer <access_token>
```

```json
{
  "title": "Step title here",
  "content": "## Markdown content here\n\nFull markdown string from step.content"
}
```

Both fields come directly from the current step object.

**Response**

- `Content-Type: application/pdf`
- `Content-Disposition: attachment; filename="<slug>.pdf"`
- Body: raw binary PDF bytes

The server renders the markdown, applies styling, and returns a ready-to-download PDF. You do not need to do any markdown processing.

---

### Handling the Download

Convert the response to a Blob and trigger a browser download:

```ts
const response = await fetch('/api/v1/roadmap/export/step-pdf', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
  },
  body: JSON.stringify({
    title: currentStep.title,
    content: currentStep.content,
  }),
});

if (!response.ok) {
  // Show error to user
  return;
}

const blob = await response.blob();
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = `${currentStep.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.pdf`;
a.click();
URL.revokeObjectURL(url);
```

Use a loading state (`isPdfLoading`) to disable the button while the request is in flight.

---

## 2. Preventing Navigation Once a Step Is Completed

### Step Statuses

Each step has a `status` field:

| Status | Meaning |
|--------|---------|
| `pending` | Not yet reached — not visible/clickable to the user |
| `active` | Current step the user should answer |
| `completed` | Already answered — cannot be re-answered |
| `skipped` | Bypassed programmatically |

Only one step per category is `active` at a time.

---

### Submitting an Answer via WebSocket

All step answers go through the same `answer-step` WebSocket message:

```json
{
  "data": {
    "type": "answer-step",
    "attributes": {
      "req_id": "rm-3-1700000000000",
      "step_id": "<step_uuid>",
      "answer": "<answer_value>",
      "answer_data": null
    }
  }
}
```

### Answer Submission Response

The server responds with `roadmap-step-answer`. The full `attributes` shape:

```json
{
  "completed_step": {
    "id": "uuid",
    "step_number": 3,
    "question_key": "some_key",
    "title": "Step Title",
    "content": "Markdown content...",
    "question_type": "single_choice",
    "status": "completed",
    "answer": "chosen_option",
    "metadata_": { "is_summary": false }
  },
  "next_step": {
    "id": "uuid",
    "step_number": 4,
    "question_key": "next_key",
    "title": "Next Step",
    "question_type": "info",
    "status": "active",
    "answer": null,
    "metadata_": {}
  },
  "new_steps_added": [],
  "reset_steps": [],
  "deleted_step_ids": [],
  "category_progress_pct": 75,
  "category_completed_steps": 3,
  "category_completed": false,
  "gate_blocked": false,
  "gate_message": null,
  "validation_error": null,
  "routed_to_chat": false
}
```



If `next_step` is `null` and `category_completed` is `true` — the category is done. 
