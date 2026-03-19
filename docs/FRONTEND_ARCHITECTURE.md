# FroggyTalk — Frontend Architecture

> **Audience**: Senior developer handoff document.
> Covers every page, component, API call, state variable, request/response shape, and rendering flow step-by-step.

---

## Table of Contents

1. [Tech Stack & Project Structure](#1-tech-stack--project-structure)
2. [Routing & Auth Guard](#2-routing--auth-guard)
3. [API Client (`lib/api-client.ts`)](#3-api-client)
4. [TypeScript Types (`lib/types.ts`)](#4-typescript-types)
5. [Pages](#5-pages)
   - 5.1 [index.tsx — Entry Redirect](#51-indextsx--entry-redirect)
   - 5.2 [login.tsx — Login](#52-logintsx--login)
   - 5.3 [register.tsx — Registration](#53-registertsx--registration)
   - 5.4 [chat.tsx — Dual-Mode Chat (Ask + Onboarding)](#54-chattsx--dual-mode-chat)
   - 5.5 [roadmap.tsx — Roadmap Dashboard](#55-roadmaptsx--roadmap-dashboard)
6. [Components](#6-components)
   - 6.1 [ContentBlockRenderer.tsx](#61-contentblockrenderertsx)
   - 6.2 [Skeleton.tsx](#62-skeletontsx)
7. [Styling](#7-styling)
8. [Proxy Configuration](#8-proxy-configuration)
9. [End-to-End Flow Walkthroughs](#9-end-to-end-flow-walkthroughs)

---

## 1. Tech Stack & Project Structure

| Layer        | Technology                             |
| ------------ | -------------------------------------- |
| Framework    | Next.js (Pages Router)                 |
| Language     | TypeScript                             |
| Styling      | Global CSS (`styles/globals.css`)      |
| HTTP         | Native `fetch` via singleton `ApiClient` |
| Auth storage | `localStorage` (access + refresh JWT)  |

```
ai-frontend/
├── pages/
│   ├── _app.tsx          # Global layout shell
│   ├── index.tsx         # Auth-aware redirect
│   ├── login.tsx         # Phone + password login
│   ├── register.tsx      # Registration form
│   ├── chat.tsx          # Dual-mode: Ask chat + Roadmap onboarding
│   └── roadmap.tsx       # Roadmap step-by-step dashboard
├── components/
│   ├── ContentBlockRenderer.tsx   # Structured block renderer
│   └── Skeleton.tsx               # Loading skeletons
├── lib/
│   ├── api-client.ts     # Singleton API client (all HTTP calls)
│   └── types.ts          # TypeScript interfaces (mirrors backend schemas)
├── styles/
│   └── globals.css       # All application CSS
├── next.config.js        # Rewrites for /api/proxy → backend
└── package.json
```

---

## 2. Routing & Auth Guard

Every protected page checks authentication on mount:

```ts
useEffect(() => {
  if (!apiClient.isAuthenticated()) {
    router.replace('/login');
    return;
  }
  // ... load user data
}, [router]);
```

- `apiClient.isAuthenticated()` checks for `accessToken` in localStorage.
- Unauthenticated users are redirected to `/login`.
- After login/register, users are redirected to `/chat`.

### Page access matrix

| Page       | Requires auth | Purpose                         |
| ---------- | ------------- | ------------------------------- |
| `/`        | No            | Redirects to `/chat` or `/login` |
| `/login`   | No            | Phone + password sign-in        |
| `/register`| No            | New user registration           |
| `/chat`    | Yes           | Ask AI + Roadmap onboarding     |
| `/roadmap` | Yes           | Roadmap step dashboard          |

---

## 3. API Client

**File**: `lib/api-client.ts`
**Export**: `apiClient` (singleton instance)

### 3.1 Base Configuration

All requests route through a Next.js rewrite proxy:

```
const API_BASE_URL = '/api/proxy';
```

`next.config.js` rewrites `/api/proxy/:path*` → `http://localhost:8081/api/v1/:path*` (the Python backend).

### 3.2 Auth Token Management

| Storage key      | Value                    | Lifespan    |
| ---------------- | ------------------------ | ----------- |
| `accessToken`    | JWT access token         | ~15 minutes |
| `refreshToken`   | JWT refresh token        | ~30 days    |
| `user`           | JSON-serialized user obj | Until logout|

**Token refresh flow:**
1. If any request returns `401`, `handleUnauthorized()` triggers.
2. `POST /api/proxy/auth/refresh` with `{ refreshToken }`.
3. New token pair is saved; original request is retried once.
4. If refresh fails → `logout()` → redirect to `/login`.
5. Concurrent 401s share a single refresh promise (no race conditions).

### 3.3 JSON:API Unwrapping

Backend responses use JSON:API envelope. The client unwraps automatically:

```ts
private unwrapData<T>(payload: JsonApiDocument<T> | T): T {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as JsonApiDocument<T>).data;
  }
  return payload as T;
}
```

All methods return the unwrapped `data` object directly.

### 3.4 Error Normalization

All non-2xx responses are normalized to `ApiError`:

```ts
interface ApiError {
  errors: Array<{
    status: string;
    code: string;
    title: string;
    detail: string;   // <-- user-facing message
  }>;
}
```

Pages read `error.errors[0].detail` for display.

### 3.5 SSE Streaming

Two endpoints use Server-Sent Events:

| Method                       | Endpoint                             | SSE events used           |
| ---------------------------- | ------------------------------------ | ------------------------- |
| `askStream()`                | `POST /ask/stream`                   | `delta`, `final`, `error` |
| `completeOnboardingStream()` | `POST /roadmap/onboarding/complete/stream` | `progress`, `final`, `done`, `error` |

**Stream parsing** (`streamRequest<T>()` method):
1. Opens `fetch` with `Accept: text/event-stream`.
2. Reads `response.body` as `ReadableStream`.
3. Parses SSE lines: `event:` sets event type, `data:` accumulates JSON.
4. Blank line triggers `flushEvent()`:
   - `delta` → calls `onDelta(content)` — token-by-token text
   - `final` → calls `onFinal(payload)` — complete response object
   - `progress` → calls `onProgress(pct, message)` — roadmap creation %
   - `error` → throws with message
   - `done` → calls `onDone()`
5. Returns `finalPayload` as the resolved promise value.

### 3.6 Complete Method Reference

#### Auth

| Method | HTTP | Endpoint | Payload | Response Type | Side Effects |
|--------|------|----------|---------|---------------|--------------|
| `register(payload)` | POST | `/auth/register` | `{ fname, lname, phoneNumber, password }` | `AuthSession` | Saves tokens + user to localStorage |
| `login(payload)` | POST | `/auth/login` | `{ phoneNumber, password }` | `AuthSession` | Saves tokens + user to localStorage |
| `logout()` | — | — | — | — | Clears localStorage, redirects `/login` |

#### Conversations (Ask Mode)

| Method | HTTP | Endpoint | Payload | Response Type |
|--------|------|----------|---------|---------------|
| `getWelcomeMessage(mode)` | GET | `/welcome/{mode}` | — | `WelcomeMessage` |
| `ask(payload)` | POST | `/ask` | `{ message, conversation_id? }` | `AskResponse` |
| `askStream(payload, handlers)` | POST (SSE) | `/ask/stream` | `{ message, conversation_id? }` | `AskResponse` (via final event) |
| `getConversations(skip, limit)` | GET | `/conversations?skip=&limit=` | — | `ConversationListResponse` |
| `getConversationMessages(id)` | GET | `/conversations/{id}/messages` | — | `MessageListResponse` |

#### Roadmap Onboarding

| Method | HTTP | Endpoint | Payload | Response Type |
|--------|------|----------|---------|---------------|
| `getRoadmap()` | GET | `/roadmap` | — | `RoadmapOverview` |
| `getOnboardingQuestions()` | GET | `/roadmap/onboarding/questions` | — | `OnboardingQuestionsResponse` |
| `getNextOnboardingQuestion(answers)` | GET | `/roadmap/onboarding/next?answers=<encoded>` | — | `OnboardingNextResponse` |
| `answerOnboardingQuestion(key, answer, answers)` | POST | `/roadmap/onboarding/answer?answers=<encoded>` | `{ question_key, answer }` | `OnboardingNextResponse` |
| `completeOnboarding(answers)` | POST | `/roadmap/onboarding/complete` | `{ answers }` | `RoadmapOverview` |
| `completeOnboardingStream(answers, handlers)` | POST (SSE) | `/roadmap/onboarding/complete/stream` | `{ answers }` | `RoadmapOverview` (via final event) |

#### Roadmap Steps

| Method | HTTP | Endpoint | Payload | Response Type |
|--------|------|----------|---------|---------------|
| `getCategoryDetail(categoryId)` | GET | `/roadmap/categories/{id}` | — | `CategoryDetailResponse` |
| `answerStep(stepId, answer)` | POST | `/roadmap/steps/{id}/answer` | `{ answer, answer_data? }` | `AnswerStepResponse` |
| `stepChat(stepId, message)` | POST | `/roadmap/steps/{id}/chat` | `{ message }` | `StepChatResponse` |
| `getStepChatHistory(stepId)` | GET | `/roadmap/steps/{id}/chat` | — | `StepChatHistoryResponse` |

---

## 4. TypeScript Types

**File**: `lib/types.ts`  — Mirrors backend JSON:API schemas exactly.

### Key Types

```ts
// Structured content block (universal rendering unit)
interface ContentBlock {
  type: 'text' | 'heading' | 'list' | 'quote' | 'link' | 'source';
  content?: string;     // text, heading, quote
  level?: number;       // heading: 2, 3, 4
  ordered?: boolean;    // list
  items?: string[];     // list items
  source?: string;      // quote attribution
  text?: string;        // link display text
  url?: string;         // link href
  filename?: string;    // source block
  category?: string;    // source block (displayed as tag)
  similarity?: number;  // source block
}

// Auth
interface AuthSession {
  type: 'auth-session';
  id: string;
  attributes: {
    accessToken: string;
    refreshToken: string;
    tokenType: string;
    accessTokenExpiresAt: string;
    refreshTokenExpiresAt: string;
    user: User;
  };
}

// Chat
interface AskResponse {
  type: 'ask-response';
  id: string;
  attributes: {
    conversation_id: string;
    question: string;
    content: string;                 // Full text answer
    content_blocks: ContentBlock[];  // Structured blocks
    rag_used: boolean;
    rag_sources?: Array<{ category?, filename?, title?, similarity? }>;
    model_name: string;
    // ... token counts, timestamps
  };
}

// Roadmap overview (returned after creation or on /roadmap load)
interface RoadmapOverview {
  type: 'roadmap-overview';
  id: string;
  attributes: {
    id: string;
    status: string;
    categories: RoadmapCategoryOverview[];
    overall_progress_pct: number;
  };
}

// Single step in a category (what roadmap.tsx renders)
interface RoadmapStepDetail {
  id: string;
  step_number: number;
  question_key: string;
  question_text: string;
  question_type: 'open' | 'single_choice' | 'multi_choice' | 'yes_no' | 'info';
  options: StepOption[] | null;
  answer: string | null;
  status: string;               // 'active' | 'pending' | 'completed'
  content_blocks: ContentBlock[];
  metadata_: Record<string, any> | null;  // title, content, help, hint, etc.
}

// Answer step response (branch-aware)
interface AnswerStepResponse {
  type: 'roadmap-step-answer';
  id: string;
  attributes: {
    completed_step: RoadmapStepDetail;
    next_step: RoadmapStepDetail | null;
    new_steps_added: RoadmapStepDetail[];
    reset_steps?: RoadmapStepDetail[];
    deleted_step_ids?: string[];
    category_progress_pct: number;
    category_completed: boolean;
    routed_to_chat?: boolean;
    chat_response?: { conversation_id, content, content_blocks };
    validation_error?: string;
  };
}

// Onboarding question (for chat.tsx onboarding flow)
interface OnboardingQuestion {
  key: string;
  question: string;
  type: 'open' | 'single_choice' | 'multi_choice' | 'yes_no' | 'info';
  options?: StepOption[];
  metadata?: Record<string, any> | null;
  content_blocks?: ContentBlock[];
}
```

---

## 5. Pages

### 5.1 `index.tsx` — Entry Redirect

**Purpose**: Landing route; no UI of its own.

**Logic**:
```
Mount → apiClient.isAuthenticated()?
  → YES → router.replace('/chat')
  → NO  → router.replace('/login')
```

Shows "Loading..." during redirect.

---

### 5.2 `login.tsx` — Login

**State**:
| Variable | Type | Purpose |
|----------|------|---------|
| `phoneNumber` | `string` | Phone input value |
| `password` | `string` | Password input value |
| `loading` | `boolean` | Disable form during submission |
| `error` | `string` | Error message display |

**Flow**:
1. User enters phone number + password.
2. `handleSubmit` fires on form submit.
3. `apiClient.login({ phoneNumber, password })` → `POST /auth/login`.
4. On success: tokens + user saved to localStorage → `router.replace('/chat')`.
5. On error: `error.errors[0].detail` displayed in red banner.

**Request**: `POST /api/proxy/auth/login`
```json
{ "phoneNumber": "+31612345678", "password": "secret" }
```

**Response** (unwrapped):
```json
{
  "type": "auth-session",
  "id": "uuid",
  "attributes": {
    "accessToken": "eyJ...",
    "refreshToken": "eyJ...",
    "tokenType": "bearer",
    "user": { "id": "uuid", "fname": "David", "lname": "O", "phone": "+31612345678" }
  }
}
```

---

### 5.3 `register.tsx` — Registration

**State**: Same as login plus `fname`, `lname`.

**Flow**:
1. User fills first name, last name, phone, password (min 6 chars).
2. `apiClient.register({ fname, lname, phoneNumber, password })` → `POST /auth/register`.
3. On success: same as login (tokens saved, redirect to `/chat`).
4. On error: displayed in banner.

**Request**: `POST /api/proxy/auth/register`
```json
{ "fname": "David", "lname": "Ologunleko", "phoneNumber": "+31612345678", "password": "secret123" }
```

---

### 5.4 `chat.tsx` — Dual-Mode Chat

**893 lines**. The most complex page. Operates in two modes:
- **Ask mode** (`mode === 'ask'`): General AI chat with conversation history.
- **Roadmap mode** (`mode === 'roadmap'`): Conversational onboarding to create a roadmap.

#### 5.4.1 Mode Type

```ts
type Mode = 'ask' | 'roadmap';
```

Toggled via sidebar buttons. Default is `'ask'`.

#### 5.4.2 State Variables

**Auth & UI**:
| Variable | Type | Purpose |
|----------|------|---------|
| `user` | `any` | Current user from localStorage |
| `mode` | `Mode` | Active mode (ask/roadmap) |
| `isSidebarCollapsed` | `boolean` | Desktop sidebar collapse |
| `isMobileSidebarOpen` | `boolean` | Mobile sidebar open state |

**Conversations (Ask mode)**:
| Variable | Type | Purpose |
|----------|------|---------|
| `conversations` | `Conversation[]` | Sidebar conversation list |
| `currentConversationId` | `string \| null` | Active conversation |
| `conversationsLoading` | `boolean` | Loading indicator |
| `conversationsPage` | `number` | Pagination cursor |
| `hasMoreConversations` | `boolean` | Infinite scroll flag |

**Messages**:
| Variable | Type | Purpose |
|----------|------|---------|
| `messages` | `DisplayMessage[]` | Chat messages array |
| `messagesLoading` | `boolean` | Messages loading state |
| `inputMessage` | `string` | Textarea input value |
| `isSending` | `boolean` | Disable input during submission |

**Roadmap Onboarding**:
| Variable | Type | Purpose |
|----------|------|---------|
| `onboardingQuestion` | `OnboardingQuestion \| null` | Current onboarding question |
| `onboardingAnswers` | `Record<string, string>` | Accumulated answers |
| `onboardingAnswersRef` | `Ref<Record<string, string>>` | Fresh ref to avoid stale closures |
| `onboardingActive` | `boolean` | Is onboarding in progress |
| `onboardingSubmitting` | `boolean` | Submitting an answer |
| `onboardingProgress` | `{ current, total }` | Progress counter |
| `roadmapCreating` | `boolean` | Shows progress card |
| `roadmapProgress` | `number` | Creation progress % |
| `roadmapProgressMessage` | `string` | Progress status text |

**Display Message shape** (internal, not from API):
```ts
interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  content_blocks?: ContentBlock[];
  sources?: string[];
  isStreaming?: boolean;
}
```

#### 5.4.3 Initialization Flow

```
Mount
  → auth check → if unauthenticated: redirect /login
  → setUser(localStorage user)
  → loadWelcomeMessage()    → GET /welcome/ask
  → loadConversations(0)    → GET /conversations?skip=0&limit=20
```

#### 5.4.4 Ask Mode — Message Send Flow

Triggered by `handleSendMessage()`:

1. Adds user message optimistically to `messages`.
2. Creates a placeholder streaming assistant message (`isStreaming: true`).
3. Calls `apiClient.askStream({ message, conversation_id }, { onDelta })`.
4. `onDelta` chunks are queued in `streamChunkQueue[]`.
5. A 16ms interval timer (`startStreamFlush`) drains up to 20 chunks per frame, appending to the streaming message's `content`.
6. On stream completion, `waitForStreamDrain()` ensures all queued chunks are flushed.
7. `finalPayload` replaces the streaming placeholder with the full `AskResponse`:
   - `content_blocks` for structured rendering
   - Source tags extracted from blocks or `rag_sources`
8. If `conversation_id` was null (new conversation), updates `currentConversationId` and reloads sidebar.

**Request**: `POST /api/proxy/ask/stream`
```json
{ "message": "How do I register at the municipality?", "conversation_id": "uuid-or-null" }
```

**SSE events received**:
```
event: delta
data: {"content": "To register"}

event: delta
data: {"content": " at the municipality"}

event: final
data: {"type":"ask-response","id":"uuid","attributes":{"content":"To register at the municipality...","content_blocks":[...],"rag_used":true,"rag_sources":[...],...}}

event: done
data: {}
```

#### 5.4.5 Source Tag Extraction

Sources appear as colored tags below assistant messages. Extracted from two places:

1. **`content_blocks`**: Blocks with `type === 'source'` → reads `block.category` or `block.filename` (sans extension).
2. **`rag_sources`** (fallback): From `AskResponse.attributes.rag_sources[]` → reads `category`, `filename`, or `title`.
3. **Final fallback**: If `rag_used === true` but no extractable sources → shows `['RAG']`.

Source tags are persisted in `localStorage` keyed by `conv:{conversationId}:msg:{messageId}:sources` so they survive page reloads.

#### 5.4.6 Conversation History

**Sidebar**: Lists conversations with title. Paginated (20 per page) with infinite scroll via `handleConversationsScroll`.

**Loading messages**: `loadConversationMessages(id)` → `GET /conversations/{id}/messages`:
- Maps each `Message` to `DisplayMessage`.
- Extracts sources from `content_blocks` first, then falls back to persisted localStorage tags.

**New conversation**: `startNewConversation()` clears `currentConversationId`, resets messages, loads welcome message.

#### 5.4.7 Roadmap Onboarding Flow

Triggered when user clicks "Roadmap" in mode toggle:

```
handleModeChange('roadmap')
  → apiClient.getRoadmap()
    → SUCCESS: Roadmap exists → router.push('/roadmap')
    → FAIL: No roadmap yet → start onboarding
  → setOnboardingActive(true)
  → apiClient.getNextOnboardingQuestion({})
    → GET /roadmap/onboarding/next?answers={}
    → Returns first question + progress
  → Display question as assistant message
```

**Per-question flow** (`handleOnboardingAnswer`):

1. User answers via option buttons (yes_no, single_choice, multi_choice) or text input (open).
2. Answer appended to messages as user message.
3. `apiClient.answerOnboardingQuestion(key, answer, currentAnswers)` → `POST /roadmap/onboarding/answer`.
4. Response contains `{ question: nextQ, progress }`.
5. Merge answer into `onboardingAnswers` and ref.
6. Artificial delay (`sleep(randomDelay())` — 100-600ms range) for conversational feel.
7. If `progress.is_complete` → call `finishOnboarding()`.
8. If `nextQ.type === 'info'` → auto-acknowledge and finish.
9. Otherwise → display next question as assistant message with option buttons.

**Validation errors**: Backend may return `422` with `{ attributes: { error } }`. Displayed as assistant message so user can retry.

**Onboarding completion** (`finishOnboarding`):

1. Show progress card (roadmapCreating = true).
2. `apiClient.completeOnboardingStream(answers, { onProgress })` → `POST /roadmap/onboarding/complete/stream`.
3. SSE `progress` events update `roadmapProgress` (0-100%) and `roadmapProgressMessage`.
4. On `final` event: set 100%, show "Your roadmap is ready!".
5. After 250ms → `router.push('/roadmap')`.

**Request**: `POST /api/proxy/roadmap/onboarding/complete/stream`
```json
{
  "answers": {
    "arrival_status": "recently_arrived",
    "municipality": "Amsterdam",
    "has_bsn": "no",
    "employment_status": "looking_for_work",
    "housing_status": "temporary",
    "language_level": "A1",
    "children": "yes"
  }
}
```

**SSE events**:
```
event: progress
data: {"pct": 10, "message": "Creating municipality category..."}

event: progress
data: {"pct": 45, "message": "Setting up housing steps..."}

event: progress
data: {"pct": 100, "message": "Roadmap complete!"}

event: final
data: {"type":"roadmap-overview","id":"uuid","attributes":{"categories":[...],"overall_progress_pct":0}}

event: done
data: {}
```

#### 5.4.8 Rendering Decisions

| Condition | Renders |
|-----------|---------|
| `message.content_blocks` exists | `<ContentBlockRenderer blocks={...} />` |
| `message.isStreaming` | Raw `content` text + blinking cursor |
| Neither | Raw `content` text |
| `message.sources.length > 0` | Source tags below message |
| `roadmapCreating === true` | Progress card overlay |
| `onboardingActive && onboardingQuestion` | Option buttons below last message |

#### 5.4.9 Input Behavior

- **Ask mode**: Placeholder "Type your message..."
- **Onboarding mode**: Uses `onboardingQuestion.metadata.hint` if present, else "Type your answer..."
- Enter (without Shift) submits. Shift+Enter for newline.
- Disabled during `isSending` or `onboardingSubmitting`.
- For `open` type onboarding questions, text input submits via `handleOnboardingAnswer`.
- For `yes_no`/`single_choice`/`multi_choice`, option buttons call `handleOnboardingAnswer` directly (text input is not the primary input method).

---

### 5.5 `roadmap.tsx` — Roadmap Dashboard

**775 lines**. Step-by-step walkthrough of the user's personalized integration roadmap.

#### 5.5.1 Layout

```
┌─────────────────────────────────────────┐
│ Sidebar (Categories)  │  Main Content   │
│                       │                 │
│ ↑ User + Logout       │ Step Nav Header │
│ ↑ Progress bar        │ ← Prev | Next →│
│                       │                 │
│ 🏛 Municipality  ●    │ Step Content    │
│ 🔑 BSN           ○    │ (block renderer)│
│ 🏠 Housing        ○    │                 │
│ 💼 Employment     🔒   │ Option Buttons  │
│ 🎓 Integration    🔒   │                 │
│ ...                    │ Chat Messages   │
│                       │                 │
│ ← Back to Chat        │ [Input bar]     │
└─────────────────────────────────────────┘
```

#### 5.5.2 Category Configuration

10 categories with labels, icons, and display order:

```ts
const CATEGORY_LABELS: Record<string, string> = {
  municipality: 'Municipality Registration',
  bsn_digid: 'BSN & DigiD',
  housing: 'Housing',
  health_insurance: 'Health Insurance',
  banking: 'Banking & Finance',
  employment: 'Employment',
  language: 'Language & Education',
  integration_exam: 'Integration Exam',
  transport: 'Transport',
  social_sports: 'Social & Sports',
};

const CATEGORY_ICONS: Record<string, string> = {
  municipality: '🏛️', bsn_digid: '🔑', housing: '🏠',
  health_insurance: '🏥', banking: '🏦', employment: '💼',
  language: '🎓', integration_exam: '📝', transport: '🚲',
  social_sports: '⚽',
};

const STATUS_COLORS: Record<string, string> = {
  locked: '#6b7280',
  not_started: '#9ca3af',
  in_progress: '#3b82f6',
  completed: '#10b981',
};
```

Categories are sorted by `sequence_no` (stable sort preserving backend order).

#### 5.5.3 State Variables

| Variable | Type | Purpose |
|----------|------|---------|
| `user` | `any` | Current user |
| `categories` | `RoadmapCategoryOverview[]` | All categories for sidebar |
| `selectedCategoryId` | `string` | Currently selected category ID |
| `selectedCategoryName` | `string` | Category name (for labels/icons) |
| `steps` | `RoadmapStepDetail[]` | Steps in selected category |
| `currentStepIndex` | `number` | Index of currently displayed step |
| `stepsLoading` | `boolean` | Steps loading state |
| `roadmapLoading` | `boolean` | Initial roadmap load |
| `overallProgress` | `number` | Overall roadmap % (sidebar header) |
| `chatMessages` | `StepChatMessage[]` | In-step conversation messages |
| `chatLoading` | `boolean` | Step chat loading state |
| `selectedAnswers` | `Record<string, string>` | User selections (pending, not yet submitted) |
| `inputMessage` | `string` | Text input value |
| `isSending` | `boolean` | Submitting an answer or chat |
| `isMobileSidebarOpen` | `boolean` | Mobile sidebar state |

#### 5.5.4 Initialization Flow

```
Mount
  → auth check → if unauthenticated: redirect /login
  → loadRoadmap()
    → GET /roadmap
    → Sort categories by sequence_no
    → setCategories(), setOverallProgress()
    → Default selection: 'municipality' (if unlocked) or first unlocked category
    → selectCategory(defaultCat.id, defaultCat.category)
```

If `GET /roadmap` fails (no roadmap exists) → `router.replace('/chat')` (back to onboarding).

#### 5.5.5 Category Selection Flow

`selectCategory(categoryId, categoryName)`:

1. Reset state: `setChatMessages([])`, `setCurrentStepIndex(0)`.
2. `apiClient.getCategoryDetail(categoryId)` → `GET /roadmap/categories/{id}`.
3. Response: `{ attributes: { category, steps: RoadmapStepDetail[] } }`.
4. Find starting step: first `active`, then first `pending`, else index 0.
5. Load step chat history for starting step.

**Request**: `GET /api/proxy/roadmap/categories/uuid`

**Response** (unwrapped):
```json
{
  "type": "roadmap-category",
  "id": "uuid",
  "attributes": {
    "category": { "id": "uuid", "category": "municipality", "progress_pct": 33, ... },
    "steps": [
      {
        "id": "uuid",
        "step_number": 1,
        "question_key": "municipality_city",
        "question_text": "Which municipality will you register in?",
        "question_type": "open",
        "options": null,
        "answer": null,
        "status": "active",
        "content_blocks": [
          { "type": "heading", "content": "Municipality Registration", "level": 2 },
          { "type": "text", "content": "You need to register at your local municipality..." },
          { "type": "list", "ordered": true, "items": ["Visit the gemeente website", "Book an appointment"] }
        ],
        "metadata_": {
          "title": "Municipality Registration",
          "content": "You need to register at your local municipality...",
          "help": "If you're not sure which municipality..."
        }
      },
      ...
    ]
  }
}
```

#### 5.5.6 Step Navigation

`goToStep(index)`:

**Moving forward** (index > currentStepIndex):
1. If current step is not completed:
   - `info` type → auto-submit `'acknowledged'` via `handleAnswerStep`.
   - `open` type → require typed answer in `selectedAnswers` or `inputMessage`.
   - Choice types → require selection in `selectedAnswers`.
2. If current step IS completed and user changed their selection → re-submit.
3. After submission, navigation happens in `handleAnswerStep` response handler (not here).

**Moving backward**: Simply updates `currentStepIndex` and loads step chat.

**Pre-fill**: When `currentStepIndex` changes, if step is `open` type, input is pre-filled with `selectedAnswers[step.id]` or `step.answer` (saved answer).

#### 5.5.7 Answer Submission Flow

`handleAnswerStep(answer)`:

1. `apiClient.answerStep(step.id, answer)` → `POST /roadmap/steps/{id}/answer`.
2. Response: `AnswerStepResponse`.

**Response handling**:

| Field | Action |
|-------|--------|
| `validation_error` | Show as chat message, user retries. No step change. |
| `routed_to_chat && chat_response` | Show chat response as assistant message. Step stays active (answer wasn't a valid step answer). |
| `completed_step` | Replace step in `steps[]` with updated version (status: completed). |
| `deleted_step_ids` | Remove these steps from `steps[]` (branch cleanup for re-answers). |
| `reset_steps` | Replace these steps in `steps[]` with reset versions. Clear their `selectedAnswers`. |
| `new_steps_added` | Insert after `completed_step` in `steps[]` (new branch steps). |
| `next_step` | Update in `steps[]`, navigate to its index, load its chat. |
| `category_progress_pct` | Update sidebar category progress. |
| `category_completed` | If true → reload full roadmap (may unlock new categories). |

**Request**: `POST /api/proxy/roadmap/steps/uuid/answer`
```json
{ "answer": "Amsterdam", "answer_data": null }
```

**Response** (unwrapped):
```json
{
  "type": "roadmap-step-answer",
  "id": "uuid",
  "attributes": {
    "completed_step": { "id": "uuid", "status": "completed", "answer": "Amsterdam", ... },
    "next_step": { "id": "uuid2", "status": "active", ... },
    "new_steps_added": [],
    "reset_steps": [],
    "deleted_step_ids": [],
    "category_progress_pct": 33,
    "category_completed": false
  }
}
```

#### 5.5.8 In-Step Chat

Users can type questions about the current step:

`handleSendMessage(e)`:
1. If step is `info` → submit `'acknowledged'`.
2. Otherwise → normalize answer via `normalizeTypedAnswerForStep`:
   - `yes_no`: "y"→"yes", "n"→"no"
   - `single_choice`/`multi_choice`: fuzzy match against `options[].value` or `options[].label`
3. Select the option and submit via `handleAnswerStep`.

Step chat history loaded via `loadStepChat(stepId)` → `GET /roadmap/steps/{id}/chat`.

#### 5.5.9 Step Content Rendering

For each step, the main content area displays:

1. **Header**: Status badge (✓ ● ○) + question type label.
2. **Title**: From `metadata_.title` if present.
3. **Content**: Priority order:
   - `content_blocks` (from step or `metadata_.content_blocks`) → `<ContentBlockRenderer />`
   - `metadata_.content` as plain preformatted text
   - `question_text` as fallback
4. **Help text**: `metadata_.help` displayed as hint below content.
5. **Interaction widgets** (based on `question_type`):
   - `info` → "Got it, continue →" button
   - `yes_no` → Yes / No buttons
   - `single_choice` / `multi_choice` → Option buttons from `step.options`
   - `open` → Text input (pre-filled)
6. **Chat messages**: Previous step conversations.
7. **Typing indicator**: While `isSending`.

#### 5.5.10 Input Behavior

- `open` step without answer: "Type your answer..."
- `open` step with answer: "Change your answer..."
- Other steps: "Ask a question about this step..."
- Enter submits, Shift+Enter for newline.

---

## 6. Components

### 6.1 `ContentBlockRenderer.tsx`

**188 lines**. Renders `ContentBlock[]` into React elements.

#### Block normalization

Before rendering, `normalizeBlocks()`:
- Merges consecutive list blocks of the same type (ordered/unordered).
- Strips manual numbering prefixes ("1. ", "2) ") from ordered list items to avoid double-numbering.

#### Ordered list counter

Global `orderedCounter` tracks numbering across split `<ol>` elements so numbers continue correctly (e.g., 1-3 in first block, 4-6 in second).

#### Block type rendering

| Block type | HTML output | Features |
|------------|-------------|----------|
| `text` | `<div class="content-block">` | Inline markdown (bold, links) |
| `heading` | `<div class="content-heading level-{N}">` | Levels 2-4, inline markdown |
| `list` | `<ol>` or `<ul>` with `<li>` | Ordered with `start` attr, inline markdown per item |
| `quote` | `<blockquote class="content-quote">` | Optional `— source` attribution |
| `link` | `<a target="_blank" rel="noopener noreferrer">` | External link |
| `source` | `null` (not rendered inline) | Handled as tags by parent component |

#### Inline markdown

`renderInlineMarkdown(text)` supports:
- `**bold text**` → `<strong>`
- `[link text](https://url)` → `<a>`
- `([link text](url))` → `<a>` (parenthesized link variant)
- Newlines → `<br>`

### 6.2 `Skeleton.tsx`

Loading skeletons used during data fetches:
- `MessageSkeleton`: Animated placeholder for chat messages.
- `ConversationSkeleton`: Animated placeholder for sidebar conversation items.

---

## 7. Styling

All styles in `styles/globals.css`. Key class naming:

| Pattern | Usage |
|---------|-------|
| `.auth-*` | Login/Register page |
| `.chat-*` | Chat page layout (sidebar, main, input) |
| `.message`, `.message.user`, `.message.assistant` | Message bubbles |
| `.content-block`, `.content-heading`, `.content-list`, `.content-quote`, `.content-link` | ContentBlockRenderer elements |
| `.roadmap-*` | Roadmap sidebar, categories, progress rings |
| `.step-*` | Step header, nav, content, options |
| `.onboarding-*` | Onboarding option buttons, progress indicator |
| `.roadmap-creating-*` | Roadmap creation progress card |
| `.streaming-cursor` | Blinking cursor during stream |
| `.source-tag` | RAG source tags below messages |

---

## 8. Proxy Configuration

**File**: `next.config.js`

```js
module.exports = {
  async rewrites() {
    return [
      {
        source: '/api/proxy/:path*',
        destination: 'http://localhost:8081/api/v1/:path*',
      },
    ];
  },
};
```

All frontend API calls go to `/api/proxy/...` which Next.js rewrites to the Python backend at `http://localhost:8081/api/v1/...`. This avoids CORS issues and keeps the backend URL configurable.

---

## 9. End-to-End Flow Walkthroughs

### 9.1 New User → First Roadmap

```
1. User visits /
2. Not authenticated → redirect /login
3. User clicks "Sign up" → /register
4. Fills form → POST /auth/register → tokens saved → redirect /chat
5. Default mode: 'ask'. Welcome message loaded.
6. User clicks "Roadmap" mode toggle
7. GET /roadmap → 404 (no roadmap) → start onboarding
8. GET /roadmap/onboarding/next?answers={} → first question displayed
9. User answers questions one by one:
   - Each: POST /roadmap/onboarding/answer → next question
   - Answers accumulated in onboardingAnswers state + ref
10. Last question answered → progress.is_complete = true
11. POST /roadmap/onboarding/complete/stream
12. SSE progress events update the creating card: 10% → 45% → 80% → 100%
13. Final event → "Your roadmap is ready!" → redirect /roadmap
```

### 9.2 Returning User → Continue Roadmap

```
1. User visits / → authenticated → redirect /chat
2. User clicks "Roadmap" mode toggle
3. GET /roadmap → 200 (roadmap exists) → redirect /roadmap
4. Roadmap page loads:
   a. GET /roadmap → categories + overall progress
   b. Default category selected (municipality or first unlocked)
   c. GET /roadmap/categories/{id} → steps loaded
   d. Navigate to first active/pending step
   e. GET /roadmap/steps/{id}/chat → step chat history
5. User interacts with step:
   a. Selects option or types answer
   b. Clicks Next → POST /roadmap/steps/{id}/answer
   c. Response may: complete step, add branch steps, reset steps, unlock next
   d. Auto-navigate to next step
6. When category completes → reload roadmap → new categories may unlock
```

### 9.3 General Chat (Ask Mode)

```
1. User on /chat in ask mode
2. Types message → Enter
3. User message added optimistically to UI
4. Streaming placeholder added (blinking cursor)
5. POST /ask/stream → SSE connection opened
6. delta events → chunks queued → 16ms interval flushes to UI
7. final event → replace placeholder with structured response
8. Content blocks rendered, source tags extracted and displayed
9. Conversation ID saved; sidebar reloaded if new conversation
```

### 9.4 Step Branching Example

```
Step: "Do you have children?" (yes_no)
User answers: "yes"
→ POST /roadmap/steps/{id}/answer
← Response:
  {
    completed_step: { answer: "yes", status: "completed" },
    next_step: { question_key: "children_school_age", status: "active" },
    new_steps_added: [
      { question_key: "children_school_age", ... },
      { question_key: "school_enrollment", ... }
    ],
    deleted_step_ids: []
  }
→ Branch steps inserted after completed step
→ Navigate to first new step

If user goes back and changes to "no":
← Response:
  {
    completed_step: { answer: "no", status: "completed" },
    next_step: { question_key: "next_category_step", status: "active" },
    new_steps_added: [],
    deleted_step_ids: ["children_school_age_id", "school_enrollment_id"],
    reset_steps: []
  }
→ Branch steps removed from list
→ Navigate to next step
```
