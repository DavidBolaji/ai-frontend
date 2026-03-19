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
    rag_sources?: Array<{
      category?: string;
      filename?: string;
      title?: string;
      similarity?: number;
      [key: string]: any;
    }>;
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

// --- Roadmap types ---

export interface StepOption {
  value: string;
  label: string;
}

export interface OnboardingQuestion {
  key: string;
  question: string;
  type: 'open' | 'single_choice' | 'multi_choice' | 'yes_no' | 'info';
  options?: StepOption[];
  metadata?: Record<string, any> | null;
  content_blocks?: ContentBlock[];
}

export interface OnboardingQuestionsResponse {
  type: 'onboarding-questions';
  id: string;
  attributes: {
    questions: OnboardingQuestion[];
  };
}

export interface OnboardingProgress {
  answered: Record<string, string>;
  current_index: number;
  total_questions: number;
  is_complete: boolean;
}

export interface OnboardingNextResponse {
  type: 'onboarding-next';
  id: string;
  attributes: {
    question: OnboardingQuestion | null;
    progress: OnboardingProgress;
  };
}

export interface OnboardingValidationError {
  type: 'onboarding-validation-error';
  id: string;
  attributes: {
    error: string;
    suggestion?: string;
  };
}

export interface OnboardingAnswers {
  arrival_status: string;
  municipality?: string | null;
  has_bsn?: boolean;
  employment_status?: string | null;
  housing_status?: string | null;
  language_level?: string | null;
  children?: boolean | null;
  additional_info?: string | null;
  [key: string]: any;
}

export interface OnboardingAnswerPayload {
  question_key: string;
  answer: string;
}

export interface RoadmapCategoryOverview {
  id: string;
  category: string;
  sequence_no: number;
  status: string;
  progress_pct: number;
  prerequisites_met: boolean;
  total_steps: number;
  completed_steps: number;
}

export interface RoadmapOverview {
  type: 'roadmap-overview';
  id: string;
  attributes: {
    id: string;
    status: string;
    categories: RoadmapCategoryOverview[];
    overall_progress_pct: number;
  };
}

export interface RoadmapStepDetail {
  id: string;
  step_number: number;
  question_key: string;
  question_text: string;
  question_type: 'open' | 'single_choice' | 'multi_choice' | 'yes_no' | 'info';
  options: StepOption[] | null;
  answer: string | null;
  answer_data: Record<string, any> | null;
  status: string;
  is_ai_generated: boolean;
  has_conversation: boolean;
  content_blocks: ContentBlock[];
  metadata_: Record<string, any> | null;
}

export interface CategoryDetailResponse {
  type: 'roadmap-category';
  id: string;
  attributes: {
    category: RoadmapCategoryOverview;
    steps: RoadmapStepDetail[];
  };
}

export interface AnswerStepResponse {
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
    chat_response?: {
      conversation_id: string;
      content: string;
      content_blocks: ContentBlock[];
    };
    validation_error?: string;
  };
}

export interface StepChatResponse {
  type: 'roadmap-step-chat';
  id: string;
  attributes: {
    conversation_id: string;
    content: string;
    content_blocks: ContentBlock[];
  };
}

export interface StepChatHistoryResponse {
  type: 'roadmap-step-chat-history';
  id: string;
  attributes: {
    messages: Array<{
      id: string;
      role: 'user' | 'assistant';
      content: string;
      sequence_no: number;
      created_at: string;
    }>;
  };
}
