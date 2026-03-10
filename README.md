# AI Frontend - Chat Application

A Next.js chat application that integrates with the AI Platform backend, featuring authentication, conversation management, and AI-powered responses with content blocks.

## Features

### Authentication
- **Registration**: Collects first name, last name, phone number, and password
- **Login**: Phone number and password authentication
- **Token Management**: Automatic refresh token handling to keep users logged in
- **Secure Storage**: JWT tokens stored in localStorage with automatic refresh on 401 responses

### Chat Interface
- **Mode Toggle**: Switch between "Ask" (enabled) and "Roadmap" (disabled) modes
- **Welcome Messages**: Fetches and displays mode-specific welcome messages on chat load
- **Real-time Messaging**: Send questions and receive AI responses
- **Content Blocks**: Rich response rendering with support for:
  - Text blocks
  - Headings (3 levels)
  - Lists (ordered and unordered)
  - Quotes with optional sources
  - Links
  - Source citations
- **RAG Source Tags**: Displays unique category tags when RAG retrieval is used
- **Conversation History**: Sidebar with scrollable list of past conversations
- **Infinite Scroll**: Automatically loads more conversations as you scroll
- **Conversation Switching**: Click any conversation to load its full message history
- **New Conversation**: Start fresh conversations with a single click

### UI/UX
- **Clean Design**: Modern, consistent styling with gradient accents
- **Loading Skeletons**: Smooth loading states for messages, conversations, and text
- **Fixed Input**: Chat input stays at the bottom for easy access
- **Auto-scroll**: Messages automatically scroll to the latest
- **Responsive**: Adapts to different screen sizes
- **Error Handling**: Clear error messages for failed requests

## Tech Stack

- **Framework**: Next.js 14.2.5 (Pages Router)
- **Language**: TypeScript
- **Styling**: Pure CSS (no external UI libraries)
- **API Integration**: Custom API client with token refresh logic
- **State Management**: React hooks

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn
- AI Platform backend running (default: http://localhost:8080)

### Installation

1. Navigate to the ai-frontend directory:
```bash
cd ai-frontend
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
# Copy and edit .env.local
cp .env.local.example .env.local
```

Edit `.env.local`:
```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8081/api/v1
```

### Development

Run the development server:
```bash
npm run dev
```

The application will be available at [http://localhost:3000](http://localhost:3000)

### Production Build

Build for production:
```bash
npm run build
```

Start production server:
```bash
npm start
```

## API Endpoints Used

### Authentication
- `POST /api/v1/auth/register` - Register new user
- `POST /api/v1/auth/login` - Login with phone and password  
- `POST /api/v1/auth/refresh` - Refresh access token using refresh token
- `GET /api/v1/auth/me` - Get current user info

### Chat & Conversations
- `GET /api/v1/welcome/{mode}` - Get welcome message for mode (ask/roadmap)
- `POST /api/v1/ask` - Send message and get AI response
- `GET /api/v1/conversations?skip={skip}&limit={limit}` - List user conversations (paginated)
- `GET /api/v1/conversations/{conversation_id}/messages?skip={skip}&limit={limit}` - Get conversation messages

## Project Structure

```
ai-frontend/
├── components/
│   ├── ContentBlockRenderer.tsx  # Renders content blocks from AI responses
│   └── Skeleton.tsx              # Loading skeleton components
├── lib/
│   ├── api-client.ts             # API client with token refresh logic
│   └── types.ts                  # TypeScript type definitions
├── pages/
│   ├── _app.tsx                  # App wrapper
│   ├── index.tsx                 # Landing page (redirects)
│   ├── login.tsx                 # Login page
│   ├── register.tsx              # Registration page
│   └── chat.tsx                  # Main chat interface
├── styles/
│   └── globals.css               # Global styles
├── .env.local                    # Environment variables (create from .env.local.example)
├── next.config.js                # Next.js configuration
├── package.json                  # Dependencies
└── tsconfig.json                 # TypeScript configuration
```

## Key Implementation Details

### Token Refresh Strategy

The API client automatically handles token refresh:
1. Stores `accessToken` and `refreshToken` in localStorage
2. Includes `Authorization: Bearer {accessToken}` header in authenticated requests
3. On 401 response, calls `/auth/refresh` with refresh token
4. Updates stored tokens and retries the original request
5. If refresh fails, logs out the user

### Content Block Rendering

The chat renders AI responses using structured content blocks:
- Each block type has a specific UI treatment
- Source blocks are extracted and shown as unique category tags below messages
- Supports rich formatting including headings, lists, quotes, and links

### Conversation Management

- Conversations load on scroll (20 per page)
- Active conversation highlighted in sidebar
- Click conversation to load full message history
- New conversations created automatically on first message
- List refreshes after sending first message in new conversation

## Usage

1. **Register**: Create an account with your details
2. **Login**: Sign in with your phone number and password
3. **Chat**: 
   - Read the welcome message
   - Type your question in the input field at the bottom
   - Press Enter or click "Send"
   - View AI responses with rich content blocks
   - See source tags when RAG retrieval is used
4. **Navigate**: 
   - Click past conversations in the sidebar to resume them
   - Click "New Conversation" to start fresh
   - Scroll the conversation list to load more history

## Development Notes

- The app uses localStorage for token persistence
- Protected routes redirect to `/login` if not authenticated
- All API errors are caught and displayed to users
- Loading states use skeleton components for smooth UX
- The chat input supports Shift+Enter for new lines

## Troubleshooting

**Build fails**: Make sure Node.js 18+ is installed and dependencies are current

**API connection errors**: Verify `NEXT_PUBLIC_API_BASE_URL` in `.env.local` points to your running backend

**Logged out unexpectedly**: Check that refresh token endpoint is working and tokens haven't expired

**Content blocks not rendering**: Verify the backend returns `content_blocks` array with proper structure

## License

Private - Part of FroggyTalk AI Platform
