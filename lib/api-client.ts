import type {
  AuthSession,
  LoginPayload,
  RegisterPayload,
  AskPayload,
  AskResponse,
  ConversationListResponse,
  MessageListResponse,
  WelcomeMessage,
  ApiError,
  JsonApiDocument,
  JsonApiErrorDocument,
  JsonApiErrorItem,
  JsonApiRequestDocument,
  OnboardingQuestionsResponse,
  OnboardingAnswers,
  OnboardingNextResponse,
  RoadmapOverview,
  CategoryDetailResponse,
  AnswerStepResponse,
  StepChatResponse,
  StepChatHistoryResponse,
  PostcodeResolutionResponse,
  OnboardingHistoryResponse,
  OnboardingSessionResponse,
} from './types';

const API_BASE_URL = '/api/proxy';

class ApiClient {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private isRefreshing = false;
  private refreshPromise: Promise<void> | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      this.accessToken = localStorage.getItem('accessToken');
      this.refreshToken = localStorage.getItem('refreshToken');
    }
  }

  private async handleUnauthorized(): Promise<void> {
    // If already refreshing, wait for that to complete
    if (this.isRefreshing && this.refreshPromise) {
      await this.refreshPromise;
      return;
    }

    // Start refresh process
    this.isRefreshing = true;
    this.refreshPromise = this.refreshAccessToken();

    try {
      await this.refreshPromise;
    } finally {
      this.isRefreshing = false;
      this.refreshPromise = null;
    }
  }

  private async refreshAccessToken(): Promise<void> {
    if (!this.refreshToken) {
      this.logout();
      throw new Error('No refresh token available');
    }

    try {
      const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: this.wrapBody('refresh', { refreshToken: this.refreshToken }),
      });

      if (!response.ok) {
        throw new Error('Token refresh failed');
      }

      const payload = (await response.json()) as JsonApiDocument<AuthSession> | AuthSession;
      const data = this.unwrapData<AuthSession>(payload);
      this.setTokens(
        data.attributes.accessToken,
        data.attributes.refreshToken
      );
    } catch (error) {
      this.logout();
      throw error;
    }
  }

  private unwrapData<T>(payload: JsonApiDocument<T> | T): T {
    if (
      payload &&
      typeof payload === 'object' &&
      'data' in payload
    ) {
      return (payload as JsonApiDocument<T>).data;
    }
    return payload as T;
  }

  /**
   * Wrap a flat payload in a JSON:API 1.1 request document.
   *
   *   { data: { type: resourceType, attributes: payload } }
   */
  private wrapBody<P extends object>(
    resourceType: string,
    payload: P,
  ): string {
    const doc: JsonApiRequestDocument<P> = {
      data: { type: resourceType, attributes: payload },
    };
    return JSON.stringify(doc);
  }

  private normalizeError(payload: unknown, status: number, statusText: string): ApiError {
    if (payload && typeof payload === 'object') {
      const jsonApiError = payload as JsonApiErrorDocument;
      if (Array.isArray(jsonApiError.errors) && jsonApiError.errors.length > 0) {
        return { errors: jsonApiError.errors };
      }

      // Handle validation-style responses: { type: "...", attributes: { error: "..." } }
      const validationResp = payload as { type?: string; attributes?: { error?: string; suggestion?: string } };
      if (validationResp.attributes?.error) {
        return {
          errors: [{
            status: String(status),
            code: 'validation_error',
            title: 'Validation Error',
            detail: validationResp.attributes.error,
          }],
        };
      }
    }

    const fallback: JsonApiErrorItem = {
      status: String(status),
      code: 'request_failed',
      title: 'Request Failed',
      detail: statusText,
    };

    return { errors: [fallback] };
  }

  private setTokens(accessToken: string, refreshToken: string): void {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;

    if (typeof window !== 'undefined') {
      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('refreshToken', refreshToken);
    }
  }

  private clearTokens(): void {
    this.accessToken = null;
    this.refreshToken = null;

    if (typeof window !== 'undefined') {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
    }
  }

  public logout(): void {
    this.clearTokens();
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
  }

  public isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  public getAccessToken(): string | null {
    return this.accessToken;
  }

  public getUser(): any {
    if (typeof window !== 'undefined') {
      const userStr = localStorage.getItem('user');
      return userStr ? JSON.parse(userStr) : null;
    }
    return null;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    retry = true
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/vnd.api+json',
      ...(options.headers as Record<string, string>),
    };

    if (this.accessToken && !endpoint.includes('/auth/')) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    // Give /ask endpoints extra time (local LLM can take 30s+); all others: 20s
    const timeoutMs = endpoint.includes('/ask') ? 90_000 : 20_000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers,
        signal: controller.signal,
      });
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err?.name === 'AbortError') {
        const timeout: JsonApiErrorItem = {
          status: '504',
          code: 'request_timeout',
          title: 'Request Timed Out',
          detail: 'The server is taking too long to respond. Please try again.',
        };
        throw { errors: [timeout] } as ApiError;
      }
      throw err;
    }
    clearTimeout(timeoutId);

    // Handle 401 with token refresh
    if (response.status === 401 && retry && !endpoint.includes('/auth/')) {
      await this.handleUnauthorized();
      // Retry the request once with new token
      return this.request<T>(endpoint, options, false);
    }

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      if (payload) {
        throw this.normalizeError(payload, response.status, response.statusText);
      }

      const fallbackText = await response.text().catch(() => '');
      const fallback: JsonApiErrorItem = {
        status: String(response.status),
        code: 'request_failed',
        title: 'Request Failed',
        detail: fallbackText || response.statusText || 'Unknown stream error',
      };
      throw { errors: [fallback] } as ApiError;
    }

    if (response.status === 204) {
      return null as T;
    }

    const payload = (await response.json()) as JsonApiDocument<T> | T;
    return this.unwrapData<T>(payload);
  }

  private async streamRequest<T>(
    endpoint: string,
    body: unknown,
    handlers: {
      onDelta?: (chunk: string) => void;
      onFinal?: (payload: T) => void;
      onDone?: () => void;
      onProgress?: (pct: number, message: string) => void;
    },
    retry = true
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/vnd.api+json',
      Accept: 'text/event-stream',
    };

    if (this.accessToken && !endpoint.includes('/auth/')) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (response.status === 401 && retry && !endpoint.includes('/auth/')) {
      await this.handleUnauthorized();
      return this.streamRequest<T>(endpoint, body, handlers, false);
    }

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw this.normalizeError(payload, response.status, response.statusText);
    }

    if (!response.body) {
      throw new Error('Stream response body is missing');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventName = 'message';
    let dataLines: string[] = [];
    let finalPayload: T | null = null;
    let streamError: string | null = null;

    // Some backends may emit SSE delimiters as literal "\\n" characters.
    // Normalize only control boundaries, not JSON content escapes.
    const normalizeEscapedSseControls = (value: string): string => {
      return value
        .replace(/(event:\s*[^\\\n]+?)\\ndata:\s*/g, '$1\ndata: ')
        .replace(/\\n\\n(?=event:\s*)/g, '\n\n')
        .replace(/\\n\\n$/g, '\n\n');
    };

    const flushEvent = () => {
      if (dataLines.length === 0) {
        return;
      }

      const rawData = dataLines.join('\n');
      dataLines = [];

      if (!rawData) {
        return;
      }

      let parsed: any;
      try {
        parsed = JSON.parse(rawData);
      } catch {
        return;
      }

      if (eventName === 'delta') {
        const chunk = typeof parsed?.content === 'string' ? parsed.content : '';
        if (chunk) {
          handlers.onDelta?.(chunk);
        }
      } else if (eventName === 'final') {
        finalPayload = parsed as T;
        handlers.onFinal?.(finalPayload);
      } else if (eventName === 'progress') {
        const pct = typeof parsed?.pct === 'number' ? parsed.pct : 0;
        const message = typeof parsed?.message === 'string' ? parsed.message : '';
        handlers.onProgress?.(pct, message);
      } else if (eventName === 'error') {
        const message =
          (typeof parsed?.detail === 'string' && parsed.detail) ||
          (typeof parsed?.message === 'string' && parsed.message) ||
          (typeof parsed?.error === 'string' && parsed.error) ||
          'Streaming failed';
        streamError = message;
      } else if (eventName === 'done') {
        handlers.onDone?.();
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      buffer = normalizeEscapedSseControls(buffer);

      while (true) {
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex === -1) {
          break;
        }

        const rawLine = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

        if (line === '') {
          flushEvent();
          eventName = 'message';
          continue;
        }

        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim();
          continue;
        }

        if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
    }

    if (buffer.trim().length > 0) {
      buffer = normalizeEscapedSseControls(buffer);
      const trailingLine = buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer;
      if (trailingLine.startsWith('data:')) {
        dataLines.push(trailingLine.slice(5).trimStart());
      }
    }

    flushEvent();

    if (streamError) {
      throw new Error(streamError);
    }

    if (!finalPayload) {
      throw new Error('Stream completed without final payload');
    }

    return finalPayload;
  }

  // Auth endpoints
  async register(payload: RegisterPayload): Promise<AuthSession> {
    const data = await this.request<AuthSession>('/auth/register', {
      method: 'POST',
      body: this.wrapBody('register', payload),
    });

    this.setTokens(
      data.attributes.accessToken,
      data.attributes.refreshToken
    );

    if (typeof window !== 'undefined') {
      localStorage.setItem('user', JSON.stringify(data.attributes.user));
    }

    return data;
  }

  async login(payload: LoginPayload): Promise<AuthSession> {
    const data = await this.request<AuthSession>('/auth/login', {
      method: 'POST',
      body: this.wrapBody('login', payload),
    });

    this.setTokens(
      data.attributes.accessToken,
      data.attributes.refreshToken
    );

    if (typeof window !== 'undefined') {
      localStorage.setItem('user', JSON.stringify(data.attributes.user));
    }

    return data;
  }

  // Conversation endpoints
  async getWelcomeMessage(mode: 'ask' | 'roadmap'): Promise<WelcomeMessage> {
    return this.request<WelcomeMessage>(`/welcome/${mode}`);
  }

  async ask(payload: AskPayload): Promise<AskResponse> {
    return this.request<AskResponse>('/ask', {
      method: 'POST',
      body: this.wrapBody('ask', payload),
    });
  }

  async askStream(
    payload: AskPayload,
    handlers: {
      onDelta?: (chunk: string) => void;
      onFinal?: (response: AskResponse) => void;
      onDone?: () => void;
    } = {}
  ): Promise<AskResponse> {
    const wrapped = { data: { type: 'ask', attributes: payload } };
    return this.streamRequest<AskResponse>('/ask/stream', wrapped, handlers);
  }

  async getConversations(skip = 0, limit = 20): Promise<ConversationListResponse> {
    return this.request<ConversationListResponse>(
      `/conversations?skip=${skip}&limit=${limit}`
    );
  }

  async getConversationMessages(
    conversationId: string,
    skip = 0,
    limit = 100
  ): Promise<MessageListResponse> {
    return this.request<MessageListResponse>(
      `/conversations/${conversationId}/messages?skip=${skip}&limit=${limit}`
    );
  }

  // Roadmap endpoints
  async getRoadmap(): Promise<RoadmapOverview> {
    return this.request<RoadmapOverview>('/roadmap');
  }

  async getOnboardingQuestions(): Promise<OnboardingQuestionsResponse> {
    return this.request<OnboardingQuestionsResponse>('/roadmap/onboarding/questions');
  }

  async submitOnboarding(answers: OnboardingAnswers): Promise<RoadmapOverview> {
    return this.request<RoadmapOverview>('/roadmap/onboarding', {
      method: 'POST',
      body: this.wrapBody('onboarding', { answers }),
    });
  }

  async getNextOnboardingQuestion(answers: Record<string, string>): Promise<OnboardingNextResponse> {
    const encoded = encodeURIComponent(JSON.stringify(answers));
    return this.request<OnboardingNextResponse>(`/roadmap/onboarding/next?answers=${encoded}`);
  }

  async answerOnboardingQuestion(
    questionKey: string,
    answer: string,
    answers: Record<string, string>,
  ): Promise<OnboardingNextResponse> {
    const encoded = encodeURIComponent(JSON.stringify(answers));
    return this.request<OnboardingNextResponse>(`/roadmap/onboarding/answer?answers=${encoded}`, {
      method: 'POST',
      body: this.wrapBody('onboarding-answer', { question_key: questionKey, answer }),
    });
  }

  async resolvePostcode(postcode: string): Promise<PostcodeResolutionResponse> {
    return this.request<PostcodeResolutionResponse>(
      `/roadmap/onboarding/resolve-postcode?postcode=${encodeURIComponent(postcode)}`,
    );
  }

  async getOnboardingHistory(answers: Record<string, string>): Promise<OnboardingHistoryResponse> {
    const encoded = encodeURIComponent(JSON.stringify(answers));
    return this.request<OnboardingHistoryResponse>(`/roadmap/onboarding/history?answers=${encoded}`);
  }

  async getOnboardingSession(): Promise<OnboardingSessionResponse> {
    return this.request<OnboardingSessionResponse>('/roadmap/onboarding/session');
  }

  async deleteOnboardingSession(): Promise<void> {
    await this.request<void>('/roadmap/onboarding/session', { method: 'DELETE' });
  }

  async completeOnboarding(answers: Record<string, string>): Promise<RoadmapOverview> {
    return this.request<RoadmapOverview>('/roadmap/onboarding/complete', {
      method: 'POST',
      body: this.wrapBody('onboarding-complete', { answers }),
    });
  }

  async completeOnboardingStream(
    answers: Record<string, string>,
    handlers: {
      onProgress?: (pct: number, message: string) => void;
      onFinal?: (roadmap: RoadmapOverview) => void;
      onDone?: () => void;
    } = {}
  ): Promise<RoadmapOverview> {
    const wrapped = { data: { type: 'onboarding-complete', attributes: { answers } } };
    return this.streamRequest<RoadmapOverview>(
      '/roadmap/onboarding/complete/stream',
      wrapped,
      handlers,
    );
  }

  async getCategoryDetail(categoryId: string): Promise<CategoryDetailResponse> {
    return this.request<CategoryDetailResponse>(`/roadmap/categories/${categoryId}`);
  }

  async answerStep(stepId: string, answer: string, answerData?: Record<string, any>): Promise<AnswerStepResponse> {
    return this.request<AnswerStepResponse>(`/roadmap/steps/${stepId}/answer`, {
      method: 'POST',
      body: this.wrapBody('step-answer', { answer, answer_data: answerData ?? null }),
    });
  }

  async stepChat(stepId: string, message: string): Promise<StepChatResponse> {
    return this.request<StepChatResponse>(`/roadmap/steps/${stepId}/chat`, {
      method: 'POST',
      body: this.wrapBody('step-chat', { message }),
    });
  }

  async getStepChatHistory(stepId: string): Promise<StepChatHistoryResponse> {
    return this.request<StepChatHistoryResponse>(`/roadmap/steps/${stepId}/chat`);
  }
}

export const apiClient = new ApiClient();
