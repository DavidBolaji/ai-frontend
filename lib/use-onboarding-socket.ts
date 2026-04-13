/**
 * useOnboardingSocket
 *
 * WebSocket hook for all conversational onboarding operations.
 * Uses the /api/ws/onboarding endpoint.
 *
 * All methods return Promises (request-response).  For the streaming
 * onboarding-complete-stream operation, progress callbacks are provided
 * alongside a final Promise that resolves when roadmap creation finishes.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Notification } from './use-ask-socket';
import type {
  OnboardingNextResponse,
  OnboardingSessionResponse,
  OnboardingHistoryResponse,
  PostcodeResolutionResponse,
  RoadmapOverview,
} from './types';

export type OnboardingSocketState =
  | 'disconnected'
  | 'connecting'
  | 'authenticating'
  | 'ready';

export interface OnboardingSocketOptions {
  getToken: () => string | null;
  onAuthError?: () => void;
  onNotification?: (notification: Notification) => void;
}

// ── helpers ───────────────────────────────────────────────────────────────────

let _reqCounter = 0;
function nextReqId(): string {
  return `ob-${++_reqCounter}-${Date.now()}`;
}

function wsRequest(type: string, attributes?: Record<string, unknown>): string {
  const data: Record<string, unknown> = { type };
  if (attributes) data.attributes = attributes;
  return JSON.stringify({ data });
}

// ── hook ──────────────────────────────────────────────────────────────────────

export function useOnboardingSocket(options: OnboardingSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [state, setState] = useState<OnboardingSocketState>('disconnected');
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const pingTimer = useRef<ReturnType<typeof setInterval>>();

  /** Standard request-response pending map (keyed by req_id). */
  const pendingRef = useRef<
    Map<string, { resolve: (data: any) => void; reject: (err: Error) => void }>
  >(new Map());

  /**
   * Progress callbacks for onboarding-complete-stream.
   * The key is the req_id of the stream request.
   */
  const progressHandlersRef = useRef<
    Map<string, (pct: number, message: string) => void>
  >(new Map());

  const cleanup = useCallback(() => {
    if (pingTimer.current) clearInterval(pingTimer.current);
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close(1000);
      wsRef.current = null;
    }
    for (const { reject } of pendingRef.current.values()) {
      reject(new Error('WebSocket disconnected'));
    }
    pendingRef.current.clear();
    progressHandlersRef.current.clear();
    setState('disconnected');
  }, []);

  const connect = useCallback(() => {
    cleanup();

    const token = optionsRef.current.getToken();
    if (!token) {
      optionsRef.current.onAuthError?.();
      return;
    }

    setState('connecting');

    const wsBase = process.env.NEXT_PUBLIC_API_WS_URL ||
      `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/ws`;
    const ws = new WebSocket(`${wsBase}/onboarding`);
    wsRef.current = ws;

    ws.onopen = () => {
      setState('authenticating');
      ws.send(wsRequest('ws-auth', { token }));
    };

    ws.onmessage = (event) => {
      let envelope: any;
      try {
        envelope = JSON.parse(event.data);
      } catch {
        return;
      }

      // ── JSON:API error ──
      if (envelope.errors) {
        const err = envelope.errors[0];
        const code = err?.code ?? '';
        const detail = err?.detail ?? 'Unknown error';

        if (code.startsWith('auth.') || code === 'ws.auth_timeout') {
          setState('disconnected');
          optionsRef.current.onAuthError?.();
          return;
        }

        const reqId: string | undefined = err?.meta?.req_id;
        if (reqId && pendingRef.current.has(reqId)) {
          const { reject } = pendingRef.current.get(reqId)!;
          pendingRef.current.delete(reqId);
          progressHandlersRef.current.delete(reqId);
          reject(new Error(detail));
        }
        return;
      }

      // ── JSON:API data ──
      const data = envelope.data;
      if (!data) return;

      const type: string = data.type ?? '';
      const attrs = data.attributes ?? {};
      const reqId: string | undefined = data.req_id;

      switch (type) {
        case 'ws-auth-ok':
          setState('ready');
          pingTimer.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(wsRequest('ws-ping'));
            }
          }, 30_000);
          break;

        case 'ws-notification':
          optionsRef.current.onNotification?.({
            id: data.id ?? '',
            category: attrs.category ?? 'system',
            title: attrs.title ?? '',
            body: attrs.body ?? '',
            action_url: attrs.action_url,
            created_at: attrs.created_at,
          });
          break;

        case 'ws-pong':
          break;

        // Progress events from onboarding-complete-stream — call handler but
        // do NOT resolve the pending request yet (more progress events may follow).
        case 'onboarding-progress':
          if (reqId && progressHandlersRef.current.has(reqId)) {
            progressHandlersRef.current.get(reqId)!(
              attrs.pct ?? 0,
              attrs.message ?? '',
            );
          }
          break;

        // Final completion — resolve the pending promise
        case 'onboarding-complete-ok':
          if (reqId && pendingRef.current.has(reqId)) {
            const { resolve } = pendingRef.current.get(reqId)!;
            pendingRef.current.delete(reqId);
            progressHandlersRef.current.delete(reqId);
            resolve({ type, attributes: attrs, id: data.id });
          }
          break;

        default:
          if (reqId && pendingRef.current.has(reqId)) {
            const { resolve } = pendingRef.current.get(reqId)!;
            pendingRef.current.delete(reqId);
            resolve({ type, attributes: attrs, id: data.id });
          }
          break;
      }
    };

    ws.onclose = (event) => {
      setState('disconnected');
      if (pingTimer.current) clearInterval(pingTimer.current);

      if (event.code === 4001 || event.code === 4008) {
        optionsRef.current.onAuthError?.();
        return;
      }

      reconnectTimer.current = setTimeout(() => connect(), 3000);
    };

    ws.onerror = () => {
      // onclose fires after onerror — reconnect handled there
    };
  }, [cleanup]);

  useEffect(() => {
    connect();
    return cleanup;
  }, [connect, cleanup]);

  // ── request helpers ───────────────────────────────────────────────────────

  const sendRequest = useCallback(
    <T>(type: string, attributes?: Record<string, unknown>): Promise<T> => {
      return new Promise((resolve, reject) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          reject(new Error('WebSocket not connected'));
          return;
        }
        const reqId = nextReqId();
        pendingRef.current.set(reqId, { resolve, reject });
        ws.send(wsRequest(type, { ...(attributes ?? {}), req_id: reqId }));
      });
    },
    [],
  );

  // ── public API ────────────────────────────────────────────────────────────

  const getSession = useCallback(
    (): Promise<{ attributes: OnboardingSessionResponse['attributes'] }> =>
      sendRequest('onboarding-session'),
    [sendRequest],
  );

  const getNextQuestion = useCallback(
    (
      answers: Record<string, string>,
    ): Promise<{ attributes: OnboardingNextResponse['attributes'] }> =>
      sendRequest('onboarding-next', { answers }),
    [sendRequest],
  );

  const answerQuestion = useCallback(
    (
      questionKey: string,
      answer: string,
      answers: Record<string, string>,
    ): Promise<{ attributes: OnboardingNextResponse['attributes'] }> =>
      sendRequest('onboarding-answer', { question_key: questionKey, answer, answers }),
    [sendRequest],
  );

  const getHistory = useCallback(
    (
      answers: Record<string, string>,
    ): Promise<{ attributes: OnboardingHistoryResponse['attributes'] }> =>
      sendRequest('onboarding-history', { answers }),
    [sendRequest],
  );

  const deleteSession = useCallback(
    (): Promise<{ type: string }> => sendRequest('onboarding-delete-session'),
    [sendRequest],
  );

  const resolvePostcode = useCallback(
    (
      postcode: string,
    ): Promise<{ attributes: PostcodeResolutionResponse['attributes'] }> =>
      sendRequest('onboarding-resolve-postcode', { postcode }),
    [sendRequest],
  );

  /**
   * Start onboarding-complete streaming.
   *
   * Fires onProgress for each progress event received from the server,
   * then resolves when onboarding-complete-ok arrives.
   */
  const completeStream = useCallback(
    (
      answers: Record<string, string>,
      onProgress?: (pct: number, message: string) => void,
    ): Promise<{ attributes: { attributes: RoadmapOverview['attributes'] } }> => {
      return new Promise((resolve, reject) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          reject(new Error('WebSocket not connected'));
          return;
        }
        const reqId = nextReqId();
        pendingRef.current.set(reqId, { resolve, reject });
        if (onProgress) {
          progressHandlersRef.current.set(reqId, onProgress);
        }
        ws.send(
          wsRequest('onboarding-complete-stream', { answers, req_id: reqId }),
        );
      });
    },
    [],
  );

  return {
    state,
    getSession,
    getNextQuestion,
    answerQuestion,
    getHistory,
    deleteSession,
    resolvePostcode,
    completeStream,
    reconnect: connect,
  };
}
