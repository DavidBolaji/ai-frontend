import { useRef, useCallback, useEffect, useState } from 'react';
import type { AskResponse } from './types';

export type SocketState = 'disconnected' | 'connecting' | 'authenticating' | 'ready' | 'asking';

export interface AskSocketHandlers {
  onDelta?: (chunk: string) => void;
  onFinal?: (response: AskResponse) => void;
  onDone?: (status: string) => void;
  onError?: (detail: string) => void;
  onStatus?: (stage: string, message: string) => void;
}

export interface Notification {
  id: string;
  category: string;
  title: string;
  body: string;
  action_url?: string;
  created_at?: string;
}

export interface AskSocketOptions {
  getToken: () => string | null;
  onAuthError?: () => void;
  onNotification?: (notification: Notification) => void;
}

// ── JSON:API 1.1 envelope helpers ──

/** Build client→server JSON:API request */
function wsRequest(type: string, attributes?: Record<string, unknown>) {
  const data: Record<string, unknown> = { type };
  if (attributes) data.attributes = attributes;
  return JSON.stringify({ data });
}

export function useAskSocket(options: AskSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<AskSocketHandlers>({});
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [state, setState] = useState<SocketState>('disconnected');
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const pingTimer = useRef<ReturnType<typeof setInterval>>();

  const cleanup = useCallback(() => {
    if (pingTimer.current) clearInterval(pingTimer.current);
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    if (wsRef.current) {
      wsRef.current.onclose = null; // Prevent reconnect on intentional close
      wsRef.current.close(1000);
      wsRef.current = null;
    }
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

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws/ask`);
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

      // ── Handle JSON:API error envelopes ──
      if (envelope.errors) {
        const err = envelope.errors[0];
        const code = err?.code ?? '';
        const detail = err?.detail ?? 'Unknown error';

        if (code.startsWith('auth.') || code === 'ws.auth_timeout') {
          setState('disconnected');
          optionsRef.current.onAuthError?.();
        } else {
          handlersRef.current.onError?.(detail);
        }
        return;
      }

      // ── Handle JSON:API data envelopes ──
      const data = envelope.data;
      if (!data) return;

      const attrs = data.attributes ?? {};

      switch (data.type) {
        case 'ws-auth-ok':
          setState('ready');
          // Start ping interval (every 30s)
          pingTimer.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(wsRequest('ws-ping'));
            }
          }, 30_000);
          break;

        case 'ws-open':
          setState('asking');
          break;

        case 'ws-status':
          handlersRef.current.onStatus?.(attrs.stage ?? '', attrs.message ?? '');
          break;

        case 'ws-delta':
          handlersRef.current.onDelta?.(attrs.content ?? '');
          break;

        case 'ask-response':
          handlersRef.current.onFinal?.(data as AskResponse);
          break;

        case 'ws-done':
          setState('ready');
          handlersRef.current.onDone?.(attrs.status ?? 'completed');
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
          break; // Keep-alive acknowledged
      }
    };

    ws.onclose = (event) => {
      setState('disconnected');
      if (pingTimer.current) clearInterval(pingTimer.current);

      // Don't reconnect on auth failure
      if (event.code === 4001 || event.code === 4008) {
        optionsRef.current.onAuthError?.();
        return;
      }

      // Auto-reconnect with backoff (3s)
      reconnectTimer.current = setTimeout(() => connect(), 3000);
    };

    ws.onerror = () => {
      // onclose will fire after onerror — reconnect handled there
    };
  }, [cleanup]);

  // Connect on mount, cleanup on unmount
  useEffect(() => {
    connect();
    return cleanup;
  }, [connect, cleanup]);

  const ask = useCallback(
    (
      payload: { message: string; conversation_id?: string; max_new_tokens?: number },
      handlers: AskSocketHandlers
    ) => {
      handlersRef.current = handlers;

      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        handlers.onError?.('WebSocket not connected');
        return;
      }

      wsRef.current.send(
        wsRequest('ask', {
          message: payload.message,
          conversation_id: payload.conversation_id ?? null,
          max_new_tokens: payload.max_new_tokens ?? null,
        })
      );
    },
    []
  );

  const cancel = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(wsRequest('ws-cancel'));
    }
  }, []);

  const disconnect = cleanup;

  return { state, ask, cancel, disconnect, reconnect: connect };
}
