import { useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import type { ApiError } from '@/lib/types';

export type Resolution = { id: string; status: string; attempts: number; answer?: string; error?: string | null };
const terminal = new Set(['available', 'review_needed', 'failed', 'superseded', 'deleted']);
const messages: Record<string, string> = {
  accepted: 'Answer received. Processing will continue in the background.',
  processing: 'Preparing your reviewed answer…',
  publishing: 'Saving your reviewed answer…',
  ingesting: 'Adding your answer to the knowledge system…',
  verifying: 'Checking that your answer can be retrieved…',
  available: 'Answer is available in the system.',
  review_needed: 'Your answer is saved and needs review before it can become available.',
  failed: 'Processing could not finish. Your answer is saved; an operator can retry it.',
  deleted: 'This processing job was deleted. You can submit a new answer.',
  superseded: 'A newer knowledge update replaced this version.',
};

export default function KnowledgeResolution({ sourceId, source = 'gap', onStatusChange, onSubmitted }: { sourceId: string; source?: 'gap' | 'feedback' | 'vote'; onStatusChange?: (resolution: Resolution | null) => void; onSubmitted?: (resolution: Resolution) => void }) {
  const [answer, setAnswer] = useState('');
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pollError, setPollError] = useState('');
  const [pollVersion, setPollVersion] = useState(0);
  const tracking = useRef<string | null>(null);
  const submission = useRef<{ answer: string; key: string } | null>(null);
  const locked = useRef(false);
  const dirty = useRef(false);
  const mounted = useRef(true);
  const callbacks = useRef({ onStatusChange, onSubmitted });
  callbacks.current = { onStatusChange, onSubmitted };

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const data = await apiClient.readKnowledge(tracking.current ? { operation: 'resolution', id: tracking.current } : { operation: 'resolutionLatest', id: sourceId, source });
        if (cancelled) return;
        const current: Resolution | null = tracking.current ? data : data.resolution;
        if (current) tracking.current = current.id;
        if (current?.answer && !dirty.current) setAnswer(current.answer);
        setResolution(current);
        callbacks.current.onStatusChange?.(current);
        setPollError('');
        if (current && !terminal.has(current.status)) timer = setTimeout(poll, 2000);
      } catch {
        if (!cancelled) {
          setPollError('Unable to check progress. Checking again shortly.');
          timer = setTimeout(poll, 5000);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [sourceId, source, pollVersion]);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (locked.current || !answer.trim()) return;
    locked.current = true;
    setSubmitting(true);
    setError('');
    const trimmed = answer.trim();
    if (!submission.current || submission.current.answer !== trimmed) {
      submission.current = { answer: trimmed, key: crypto.randomUUID() };
    }
    try {
      const data = await apiClient.submitKnowledgeAnswer(sourceId, trimmed, submission.current.key, source);
      if (mounted.current) { tracking.current = data.id; setResolution(data); callbacks.current.onSubmitted?.(data); callbacks.current.onStatusChange?.(data); setAnswer(trimmed); dirty.current = false; submission.current = null; setPollVersion(v => v + 1); }
    } catch (error) {
      const detail = (error as ApiError)?.errors?.[0]?.detail;
      if (mounted.current) setError(detail ? `${detail} Your answer is kept.` : 'Unable to confirm submission. Your answer is kept; try again.');
    } finally {
      locked.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }

  const active = resolution && !terminal.has(resolution.status);
  return <section aria-label="Resolve knowledge record">
    <h3>Provide the correct answer</h3>
    <form onSubmit={submit}>
      <label htmlFor={`answer-${sourceId}`}>Reviewed answer</label>
      <textarea id={`answer-${sourceId}`} value={answer} onChange={e => { dirty.current = true; setAnswer(e.target.value); }}
        maxLength={5000} rows={5} required disabled={submitting || Boolean(active)}
        style={{ width: '100%', boxSizing: 'border-box', margin: '8px 0', padding: 12, borderRadius: 8, font: 'inherit' }} />
      <button type="submit" disabled={loading || submitting || Boolean(active) || !answer.trim()}>
        {submitting ? 'Submitting…' : 'Submit'}
      </button>
    </form>
    {resolution && <p role="status">{messages[resolution.status] || 'Processing…'}{resolution.attempts > 0 && !terminal.has(resolution.status) ? ' Retrying automatically.' : ''}</p>}
    {error && <p role="alert">{error}</p>}
    {pollError && <p role="status">{pollError}</p>}
  </section>;
}
