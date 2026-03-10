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
} from './types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080/api/v1';

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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
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

  private normalizeError(payload: unknown, status: number, statusText: string): ApiError {
    if (payload && typeof payload === 'object') {
      const jsonApiError = payload as JsonApiErrorDocument;
      if (Array.isArray(jsonApiError.errors) && jsonApiError.errors.length > 0) {
        return { errors: jsonApiError.errors };
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
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.accessToken && !endpoint.includes('/auth/')) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });

    // Handle 401 with token refresh
    if (response.status === 401 && retry && !endpoint.includes('/auth/')) {
      await this.handleUnauthorized();
      // Retry the request once with new token
      return this.request<T>(endpoint, options, false);
    }

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw this.normalizeError(payload, response.status, response.statusText);
    }

    if (response.status === 204) {
      return null as T;
    }

    const payload = (await response.json()) as JsonApiDocument<T> | T;
    return this.unwrapData<T>(payload);
  }

  // Auth endpoints
  async register(payload: RegisterPayload): Promise<AuthSession> {
    const data = await this.request<AuthSession>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
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
      body: JSON.stringify(payload),
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
      body: JSON.stringify(payload),
    });
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
}

export const apiClient = new ApiClient();
