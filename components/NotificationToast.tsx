import { useEffect, useRef } from 'react';

export interface ToastNotification {
  id: string;
  title: string;
  body: string;
  action_url?: string;
  category?: string;
}

interface NotificationToastProps {
  notification: ToastNotification | null;
  onDismiss: () => void;
  onAction?: (url: string) => void;
  /** Auto-dismiss after this many ms. Default: 8000 */
  autoDismissMs?: number;
}

export function NotificationToast({
  notification,
  onDismiss,
  onAction,
  autoDismissMs = 8000,
}: NotificationToastProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!notification) return;
    timerRef.current = setTimeout(onDismiss, autoDismissMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [notification, onDismiss, autoDismissMs]);

  if (!notification) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: '1.25rem',
        right: '1.25rem',
        zIndex: 9999,
        maxWidth: '22rem',
        background: '#1e293b',
        color: '#f8fafc',
        borderRadius: '0.75rem',
        boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
        padding: '1rem 1.25rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4rem',
        animation: 'toastIn 0.25s ease',
      }}
      role="alert"
      aria-live="assertive"
    >
      <style>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translateY(-12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
        <span style={{ fontWeight: 600, fontSize: '0.95rem', lineHeight: 1.3 }}>
          🔔 {notification.title}
        </span>
        <button
          onClick={onDismiss}
          aria-label="Dismiss notification"
          style={{
            background: 'none',
            border: 'none',
            color: '#94a3b8',
            cursor: 'pointer',
            fontSize: '1rem',
            lineHeight: 1,
            padding: 0,
            flexShrink: 0,
          }}
        >
          ✕
        </button>
      </div>
      {notification.body && (
        <p style={{ fontSize: '0.85rem', color: '#cbd5e1', margin: 0, lineHeight: 1.4 }}>
          {notification.body}
        </p>
      )}
      {notification.action_url && onAction && (
        <button
          onClick={() => {
            onAction(notification.action_url!);
            onDismiss();
          }}
          style={{
            marginTop: '0.4rem',
            background: '#3b82f6',
            color: '#fff',
            border: 'none',
            borderRadius: '0.5rem',
            padding: '0.4rem 0.85rem',
            fontSize: '0.83rem',
            fontWeight: 600,
            cursor: 'pointer',
            alignSelf: 'flex-start',
          }}
        >
          View →
        </button>
      )}
    </div>
  );
}
