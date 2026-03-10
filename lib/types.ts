// TypeScript types matching the backend schemas

export interface ContentBlock {
  type: 'text' | 'heading' | 'list' | 'quote' | 'link' | 'source';
  content?: string;
  level?: number;
  ordered?: boolean;
  items?: string[];
  source?: string;
  text?: string;
  url?: string;
  filename?: string;
  category?: string;
  similarity?: number;
}

export interface User {
  id: string;
  fname: string;
  lname: string;
  phone: string;
  isActive: boolean;
}

export interface AuthSession {
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

export interface RegisterPayload {
  fname: string;
  lname: string;
  phoneNumber: string;
  password: string;
}

export interface LoginPayload {
  phoneNumber: string;
  password: string;
}

export interface AskPayload {
  message: string;
  conversation_id?: string;
  max_new_tokens?: number;
}

export interface AskResponse {
  type: 'ask-response';
  id: string;
  attributes: {
    conversation_id: string;
    question: string;
    content: string;
    content_blocks: ContentBlock[];
    rag_used: boolean;
    summary_used: boolean;
    context_messages_used: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    model_name: string;
    created_at: string;
  };
}

export interface Conversation {
  type: 'conversation';
  id: string;
  attributes: {
    title: string | null;
    summary: string | null;
    status: string;
    context_token_count: number;
    updated_at: string;
    created_at: string;
  };
}

export interface ConversationListResponse {
  type: 'conversation-list';
  id: string;
  attributes: {
    total: number;
    skip: number;
    limit: number;
    items: Conversation[];
  };
}

export interface Message {
  type: 'message';
  id: string;
  attributes: {
    conversation_id: string;
    role: 'user' | 'assistant';
    content: string;
    content_blocks: ContentBlock[] | null;
    sequence_no: number;
    created_at: string;
  };
}

export interface MessageListResponse {
  type: 'message-list';
  id: string;
  attributes: {
    conversation_id: string;
    skip: number;
    limit: number;
    items: Message[];
  };
}

export interface WelcomeMessage {
  type: 'welcome-message';
  id: string;
  attributes: {
    mode: string;
    message: string;
    locale: string;
    metadata: Record<string, any>;
  };
}

export interface ApiError {
  errors: Array<{
    status: string;
    code: string;
    title: string;
    detail: string;
  }>;
}

export interface JsonApiMeta {
  version: string;
}

export interface JsonApiDocument<T> {
  jsonapi?: JsonApiMeta;
  data: T;
}

export interface JsonApiErrorItem {
  status: string;
  code: string;
  title: string;
  detail: string;
}

export interface JsonApiErrorDocument {
  jsonapi?: JsonApiMeta;
  errors: JsonApiErrorItem[];
}
