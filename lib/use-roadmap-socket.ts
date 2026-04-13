/**
 * useRoadmapSocket
 *
 * WebSocket hook for all roadmap operations (get overview, category detail,
 * answer steps, step chat).  Mirrors the shape of useAskSocket but uses
 * the /api/ws/roadmap endpoint and request-response semantics instead of
 * token streaming.
 *
 * Each method returns a Promise that resolves when the server echoes back the
 * corresponding response type.  Requests include a `req_id` that the server
 * echoes back, so concurrent calls of different types are safely correlated.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Notification } from './use-ask-socket';
import type {
  RoadmapOverview,
  CategoryDetailResponse,
  AnswerStepResponse,
  StepChatResponse,
  StepChatHistoryResponse,
} from './types';

export type RoadmapSocketState =
  | 'disconnected'
  | 'connecting'
  | 'authenticating'
  | 'ready';

export interface RoadmapSocketOptions {
  getToken: () => string | null;
  onAuthError?: () => void;
  onNotification?: (notification: Notification) => void;
}

// ── helpers ──────────────────────────────────────────────────────────────────

let _reqCounter = 0;
function nextReqId(): string {
  return `rm-${++_reqCounter}-${Date.now()}`;
}

function wsRequest(
  type: string,
  attributes?: Record<string, unknown>,
): string {
  const data: Record<string, unknown> = { type };
  if (attributes) data.attributes = attributes;
  return JSON.stringify({ data });
}

// ── hook ─────────────────────────────────────────────────────────────────────

export function useRoadmapSocket(options: RoadmapSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [state, setState] = useState<RoadmapSocketState>('disconnected');
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const pingTimer = useRef<ReturnType<typeof setInterval>>();

  /**
   * Pending requests map: req_id → { resolve, reject }
   * Also handles error routing — on a JSON:API error envelope,
   * we check the meta.req_id to find the matching pending request.
   */
  const pendingRef = useRef<
    Map<string, { resolve: (data: any) => void; reject: (err: Error) => void }>
  >(new Map());

  const cleanup = useCallback(() => {
    if (pingTimer.current) clearInterval(pingTimer.current);
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close(1000);
      wsRef.current = null;
    }
    // Reject all pending requests
    for (const { reject } of pendingRef.current.values()) {
      reject(new Error('WebSocket disconnected'));
    }
    pendingRef.current.clear();
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
    const ws = new WebSocket(`${wsBase}/roadmap`);
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

      // ── JSON:API error envelope ──
      if (envelope.errors) {
        const err = envelope.errors[0];
        const code = err?.code ?? '';
        const detail = err?.detail ?? 'Unknown error';

        if (code.startsWith('auth.') || code === 'ws.auth_timeout') {
          setState('disconnected');
          optionsRef.current.onAuthError?.();
          return;
        }

        // Route error to pending request if req_id is present
        const reqId: string | undefined = err?.meta?.req_id;
        if (reqId && pendingRef.current.has(reqId)) {
          const { reject } = pendingRef.current.get(reqId)!;
          pendingRef.current.delete(reqId);
          reject(new Error(detail));
        }
        return;
      }

      // ── JSON:API data envelope ──
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

        default:
          // Route to pending request by req_id
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

  // ── request helper ──────────────────────────────────────────────────────

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

  // ── public API ──────────────────────────────────────────────────────────

  const getRoadmap = useCallback(
    (): Promise<{ type: string; attributes: RoadmapOverview['attributes']; id: string }> =>
      sendRequest('get-roadmap'),
    [sendRequest],
  );

  const getCategory = useCallback(
    (categoryId: string): Promise<{ type: string; attributes: CategoryDetailResponse['attributes']; id: string }> =>
      sendRequest('get-category', { category_id: categoryId }),
    [sendRequest],
  );

  const answerStep = useCallback(
    (
      stepId: string,
      answer: string,
      answerData?: Record<string, any>,
    ): Promise<{ type: string; attributes: AnswerStepResponse['attributes']; id: string }> =>
      sendRequest('answer-step', {
        step_id: stepId,
        answer,
        answer_data: answerData ?? null,
      }),
    [sendRequest],
  );

  const stepChat = useCallback(
    (
      stepId: string,
      message: string,
    ): Promise<{ type: string; attributes: StepChatResponse['attributes']; id: string }> =>
      sendRequest('step-chat', { step_id: stepId, message }),
    [sendRequest],
  );

  const getStepChat = useCallback(
    (
      stepId: string,
    ): Promise<{ type: string; attributes: StepChatHistoryResponse['attributes']; id: string }> =>
      sendRequest('get-step-chat', { step_id: stepId }),
    [sendRequest],
  );

  return {
    state,
    getRoadmap,
    getCategory,
    answerStep,
    stepChat,
    getStepChat,
    reconnect: connect,
  };
}
