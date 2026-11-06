import { useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import styles from '@/styles/knowledge.module.css';
import type { ApiError } from '@/lib/types';
import { MAX_SOURCE_URLS, MAX_URL_LENGTH, normaliseSourceUrls, urlProblem } from '@/lib/source-urls';

export type Resolution = { id: string; status: string; attempts: number; answer?: string; source_url?: string; source_urls?: string[]; action_url?: string; action_label?: string; error?: string | null };
const terminal = new Set(['available', 'review_needed', 'failed', 'superseded', 'deleted']);

export type Notice = { title: string; body: string };

export default function KnowledgeResolution({ sourceId, source = 'gap', onStatusChange, onSubmitted, onNotice }: { sourceId: string; source?: 'gap' | 'feedback' | 'vote'; onStatusChange?: (resolution: Resolution | null) => void; onSubmitted?: (resolution: Resolution) => void; onNotice?: (notice: Notice) => void }) {
  const [answer, setAnswer] = useState('');
  const [sourceUrls, setSourceUrls] = useState<string[]>(['']);
  const [actionUrl, setActionUrl] = useState('');
  const [actionLabel, setActionLabel] = useState('');
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const pollFailing = useRef(false);
  const [pollVersion, setPollVersion] = useState(0);
  const tracking = useRef<string | null>(null);
  const submission = useRef<{ answer: string; key: string } | null>(null);
  const locked = useRef(false);
  const dirty = useRef(false);
  const mounted = useRef(true);
  const callbacks = useRef({ onStatusChange, onSubmitted, onNotice });
  callbacks.current = { onStatusChange, onSubmitted, onNotice };

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const data = await apiClient.readKnowledge(tracking.current ? { operation: 'resolution', id: tracking.current } : { operation: 'resolutionLatest', id: sourceId, source });
        if (cancelled) return;
        const current: Resolution | null = tracking.current ? data : data.resolution;
        if (current) tracking.current = current.id;
        if (current?.answer && !dirty.current) {
          setAnswer(current.answer);
          const stored = current.source_urls?.length ? current.source_urls : current.source_url ? [current.source_url] : [];
          setSourceUrls(stored.length ? stored : ['']);
          setActionUrl(current.action_url || ''); setActionLabel(current.action_label || '');
        }
        setResolution(current);
        callbacks.current.onStatusChange?.(current);
        pollFailing.current = false;
        if (current && !terminal.has(current.status)) timer = setTimeout(poll, 2000);
      } catch {
        if (!cancelled) {
          if (!pollFailing.current) {
            pollFailing.current = true;
            callbacks.current.onNotice?.({ title: 'Still checking', body: 'Unable to check progress. Checking again shortly.' });
          }
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

  function notify(title: string, body: string) { callbacks.current.onNotice?.({ title, body }); }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (locked.current || loading || resolution?.status === 'available' || active || !answer.trim()) return;
    if (Array.from(answer).length > 5000) {
      notify('Answer too long', 'The answer exceeds 5,000 characters. Shorten it before submitting. Your full draft is kept.');
      return;
    }
    const sources = normaliseSourceUrls(sourceUrls);
    if (sources.error) {
      notify('Check the links', sources.index >= 0 ? `Source URL ${sources.index + 1}: ${sources.error}` : sources.error);
      return;
    }
    const links = { ...(sources.urls.length ? { source_urls: sources.urls } : {}),
      ...(actionUrl.trim() ? { action_url: actionUrl.trim() } : {}),
      ...(actionLabel.trim() ? { action_label: actionLabel.trim() } : {}) };
    if (links.action_label && !links.action_url) { notify('Check the links', 'Add an action URL for this action label.'); return; }
    if (links.action_url) {
      const problem = urlProblem(links.action_url);
      if (problem) { notify('Check the links', `Action URL: ${problem}`); return; }
    }
    locked.current = true;
    setSubmitting(true);
    const trimmed = answer.trim();
    const identity = JSON.stringify({ answer: trimmed, ...links });
    if (!submission.current || submission.current.answer !== identity) {
      submission.current = { answer: identity, key: crypto.randomUUID() };
    }
    try {
      const data = await apiClient.submitKnowledgeAnswer(sourceId, trimmed, submission.current.key, source, links);
      if (mounted.current) { tracking.current = data.id; setResolution(data); callbacks.current.onSubmitted?.(data); callbacks.current.onStatusChange?.(data); setAnswer(trimmed); dirty.current = false; submission.current = null; setPollVersion(v => v + 1); }
    } catch (error) {
      const detail = (error as ApiError)?.errors?.[0]?.detail;
      if (mounted.current) notify('Answer not submitted', detail ? `${detail} Your answer is kept.` : 'Unable to confirm submission. Your answer is kept; try again.');
    } finally {
      locked.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }

  const active = Boolean(resolution && !terminal.has(resolution.status));
  const available = resolution?.status === 'available';
  const fieldsDisabled = loading || submitting || active || available;
  const written = Array.from(answer).length;
  const tooLong = written > 5000;
  // The button is disabled for several different reasons; say which one applies,
  // except while the status line below is already explaining the wait.
  const hint = submitting || active || available ? '' : loading ? 'Checking for an existing answer…'
    : tooLong ? 'Shorten your answer to 5,000 characters or fewer.'
    : !answer.trim() ? ''
    : written >= 4000 ? `${5000 - written} characters left` : '';
  return <section aria-label="Resolve knowledge record">
    <h3>Provide the correct answer</h3>
    <form onSubmit={submit}>
      <label htmlFor={`answer-${sourceId}`}>Reviewed answer</label>
      <textarea id={`answer-${sourceId}`} value={answer} onChange={e => { dirty.current = true; setAnswer(e.target.value); }}
        aria-describedby={`answer-count-${sourceId}`} aria-invalid={tooLong} rows={5} required disabled={loading || submitting || active || available}
        className={styles.reviewedAnswer}
        style={{ width: '100%', boxSizing: 'border-box', margin: '8px 0', padding: 12, borderRadius: 8, font: 'inherit' }} />
      <p id={`answer-count-${sourceId}`} role={tooLong ? 'alert' : undefined}>
        {written.toLocaleString()} / 5,000 characters{tooLong ? ' — shorten your answer before submitting; your full draft is kept.' : ''}
      </p>
      <fieldset className={styles.links} disabled={fieldsDisabled}>
        <legend className={styles.linksLegend}>Links (optional)</legend>
        <p id={`links-hint-${sourceId}`} className={styles.linksHint}>
          The first source URL is shown with the answer; the rest are kept for review.
        </p>
        {sourceUrls.map((value, index) => {
          const problem = value.trim() ? urlProblem(value) : '';
          return <div key={index} className={styles.linkField}>
            <label htmlFor={`source-url-${sourceId}-${index}`} className={index === 0 ? undefined : styles.visuallyHidden}>
              {index === 0 ? 'Source URL' : `Source URL ${index + 1}`}
            </label>
            <div className={styles.sourceUrlRow}>
              <input id={`source-url-${sourceId}-${index}`} type="url" inputMode="url" value={value}
                maxLength={MAX_URL_LENGTH} placeholder="https://" aria-describedby={`links-hint-${sourceId}`}
                aria-invalid={Boolean(problem)} disabled={fieldsDisabled}
                onChange={e => { dirty.current = true; setSourceUrls(rows => rows.map((row, at) => at === index ? e.target.value : row)); }} />
              {sourceUrls.length > 1 && <button type="button" className={styles.linkButton} disabled={fieldsDisabled}
                onClick={() => { dirty.current = true; setSourceUrls(rows => rows.filter((_, at) => at !== index)); }}>
                Remove<span className={styles.visuallyHidden}> source URL {index + 1}</span>
              </button>}
            </div>
            {problem && <p role="alert" className={styles.linkProblem}>{problem}</p>}
          </div>;
        })}
        {sourceUrls.length < MAX_SOURCE_URLS && <button type="button" className={styles.linkAdd} disabled={fieldsDisabled}
          onClick={() => { dirty.current = true; setSourceUrls(rows => [...rows, '']); }}>Add another source URL</button>}
        <div className={styles.linkField}>
          <label htmlFor={`action-label-${sourceId}`}>Action label</label>
          <input id={`action-label-${sourceId}`} value={actionLabel} maxLength={200}
            placeholder="Find a Vodafone shop" disabled={fieldsDisabled}
            onChange={e => { dirty.current = true; setActionLabel(e.target.value); }} />
        </div>
        <div className={styles.linkField}>
          <label htmlFor={`action-url-${sourceId}`}>Action URL</label>
          <input id={`action-url-${sourceId}`} type="url" inputMode="url" value={actionUrl} maxLength={MAX_URL_LENGTH}
            placeholder="https://" disabled={fieldsDisabled}
            onChange={e => { dirty.current = true; setActionUrl(e.target.value); }} />
        </div>
      </fieldset>
      <div className={styles.resolveActions}>
        <button type="submit" className={styles.submit} disabled={loading || submitting || active || available || !answer.trim() || tooLong}
          aria-describedby={hint ? `submit-hint-${sourceId}` : undefined}>
          {submitting && <span className={styles.submitSpinner} aria-hidden="true" />}
          {submitting ? 'Submitting…' : active || available ? 'Submitted' : 'Submit answer'}
        </button>
        {hint && <p className={styles.resolveHint} id={`submit-hint-${sourceId}`}>{hint}</p>}
      </div>
    </form>
  </section>;
}
