import { useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { MUNICIPALITIES } from '@/lib/municipalities';
import styles from '@/styles/knowledge.module.css';
import type { ApiError } from '@/lib/types';
import { MAX_SOURCE_URLS, MAX_URL_LENGTH, normaliseSourceUrls, urlProblem } from '@/lib/source-urls';

export type Resolution = { id: string; status: string; attempts: number; question?: string; answer?: string; source_url?: string; source_urls?: string[]; action_url?: string; action_label?: string; error?: string | null; can_correct?: boolean; can_retry?: boolean; issue?: string; applicability?: { scope: string; municipality_code?: string | null }; failure?: { message: string; owner?: string; stage?: string; action?: string; retryable?: boolean; fields?: string[] } | null };
const terminal = new Set(['available', 'review_needed', 'failed', 'superseded', 'deleted']);

export type Notice = { title: string; body: string; variant?: 'error' | 'success' | 'info' };

export default function KnowledgeResolution({ sourceId, source = 'gap', onStatusChange, onSubmitted, onNotice, initialApplicability, initialResolution }: { initialResolution?: Resolution | null; initialApplicability?: { scope: string; municipality?: string; municipality_code?: string | null }; sourceId: string; source?: 'gap' | 'feedback' | 'vote'; onStatusChange?: (resolution: Resolution | null) => void; onSubmitted?: (resolution: Resolution) => void; onNotice?: (notice: Notice) => void }) {
  const [answer, setAnswer] = useState('');
  const [question, setQuestion] = useState('');
  const [scope, setScope] = useState(initialApplicability?.scope || '');
  const [municipality, setMunicipality] = useState(initialApplicability?.municipality_code || '');
  const municipalities = MUNICIPALITIES;
  const [locationError, setLocationError] = useState('');
  const [formError, setFormError] = useState('');
  const [conflict, setConflict] = useState<{existing_record: {record_id: string; row_hash: string; question: string; answer: string}; submitted_answer: string; conflicts?: string[]} | null>(null);
  const [overwriteReason, setOverwriteReason] = useState('');
  const [finalAnswer, setFinalAnswer] = useState('');
  const [overwriteConfirmed, setOverwriteConfirmed] = useState(false);
  useEffect(() => {
    if (initialApplicability?.municipality && !initialApplicability.municipality_code) {
      const found = MUNICIPALITIES.find(place => place.name.toLowerCase() === initialApplicability.municipality!.toLowerCase());
      if (found) { setMunicipality(found.code); setScope('municipality'); }
    }
  }, []);
  const [sourceUrls, setSourceUrls] = useState<string[]>(['']);
  const [actionUrl, setActionUrl] = useState('');
  const [actionLabel, setActionLabel] = useState('');
  const [resolution, setResolution] = useState<Resolution | null>(initialResolution || null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const pollFailing = useRef(false);
  const [pollVersion, setPollVersion] = useState(0);
  const tracking = useRef<string | null>(initialResolution?.id || null);
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
          setQuestion(current.question || '');
          if (current.applicability) {
            setScope(current.applicability.scope);
            setMunicipality(current.applicability.municipality_code || '');
          }
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
            callbacks.current.onNotice?.({ variant: 'error', title: 'Still checking', body: 'Unable to check progress. Checking again shortly.' });
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

  function notify(title: string, body: string) { callbacks.current.onNotice?.({ title, body, variant: 'error' }); }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (resolution?.can_correct === false && ['failed', 'review_needed'].includes(resolution.status)) return;
    if (locked.current || loading || resolution?.status === 'available' || active || !answer.trim()) return;
    if (Array.from(answer).length > 5000) {
      notify('Answer too long', 'The answer exceeds 5,000 characters. Shorten it before submitting. Your full draft is kept.');
      return;
    }
    if (!scope || (scope === 'municipality' && !municipality)) {
      setLocationError('Choose applicability and select a municipality for a local answer.');
      return;
    }
    setLocationError('');
    const sources = normaliseSourceUrls(sourceUrls);
    if (sources.error) {
      notify('Check the links', sources.index >= 0 ? `Source URL ${sources.index + 1}: ${sources.error}` : sources.error);
      return;
    }
    const links = { applicability: { scope, municipality_code: scope === 'municipality' ? municipality : null }, ...(sources.urls.length ? { source_urls: sources.urls } : {}),
      ...(actionUrl.trim() ? { action_url: actionUrl.trim() } : {}),
      ...(actionLabel.trim() ? { action_label: actionLabel.trim() } : {}) };
    if (links.action_label && !links.action_url) { notify('Check the links', 'Add an action URL for this action label.'); return; }
    if (links.action_url) {
      const problem = urlProblem(links.action_url);
      if (problem) { notify('Check the links', `Action URL: ${problem}`); return; }
    }
    setFormError('');
    locked.current = true;
    setSubmitting(true);
    const trimmed = answer.trim();
    const identity = JSON.stringify({ answer: trimmed, ...links, question });
    if (!submission.current || submission.current.answer !== identity) {
      submission.current = { answer: identity, key: crypto.randomUUID() };
    }
    try {
      const data = resolution && ['failed', 'review_needed'].includes(resolution.status)
        ? await apiClient.correctKnowledgeAnswer(resolution.id, { answer: trimmed, ...links, ...(question.trim() ? { question: question.trim() } : {}) }, submission.current.key)
        : await apiClient.submitKnowledgeAnswer(sourceId, trimmed, submission.current.key, source, links);
      if (mounted.current) { tracking.current = data.id; setResolution(data); callbacks.current.onSubmitted?.(data); callbacks.current.onStatusChange?.(data); setAnswer(trimmed); dirty.current = false; submission.current = null; setPollVersion(v => v + 1); }
    } catch (error) {
      const detail = (error as ApiError)?.errors?.[0]?.detail;
      if (mounted.current) setFormError(detail || 'Unable to confirm submission. Your answer is kept.');
      if (mounted.current && detail && /municipality|scope|location/i.test(detail)) setLocationError(detail);
      if (mounted.current) notify('Answer not submitted', detail ? (detail === 'Your answer mentions a different municipality than the question context. Please change it to the correct municipality before submitting.' ? detail : `${detail} Your answer is kept.`) : 'Unable to confirm submission. Your answer is kept; try again.');
    } finally {
      locked.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }

  async function retrySavedSubmission() {
    if (!resolution || locked.current) return;
    locked.current = true; setSubmitting(true); setFormError('');
    try {
      const current = await apiClient.retryKnowledgeSubmission(resolution.id);
      if (mounted.current) {
        tracking.current = resolution.id; setResolution(current);
        callbacks.current.onStatusChange?.(current);
        callbacks.current.onNotice?.({ title: 'Submission restarted', body: 'Your saved answer is being processed again. No new job was created.', variant: 'success' });
        setPollVersion(v => v + 1);
      }
    } catch (error) {
      if (mounted.current) {
        const message = (error as ApiError)?.errors?.[0]?.detail || 'Unable to restart the saved submission. Your answer is kept.';
        setFormError(message); notify('Retry not started', message);
      }
    } finally { locked.current = false; if (mounted.current) setSubmitting(false); }
  }

  async function reviewConflict() {
    if (!resolution || locked.current) return;
    locked.current = true; setSubmitting(true); setFormError('');
    try {
      const data = await apiClient.readKnowledge({ operation: 'conflictReview', id: resolution.id });
      if (mounted.current) { setConflict(data); setFinalAnswer(data.submitted_answer); setOverwriteConfirmed(false); setOverwriteReason(''); }
    } catch (error) {
      if (mounted.current) {
        const message = (error as ApiError)?.errors?.[0]?.detail || 'Unable to load the current record.';
        setFormError(message); notify('Unable to compare answers', message);
      }
    } finally { locked.current = false; if (mounted.current) setSubmitting(false); }
  }

  async function overwriteAnswer() {
    if (!resolution || !conflict || !overwriteConfirmed || !overwriteReason.trim() || !finalAnswer.trim() || finalAnswer.length > 5000 || locked.current) return;
    locked.current = true; setSubmitting(true); setFormError('');
    try {
      const current = await apiClient.overwriteKnowledgeAnswer(resolution.id, conflict.existing_record, overwriteReason.trim(), finalAnswer.trim());
      if (mounted.current) {
        tracking.current = resolution.id; setResolution(current); setConflict(null);
        callbacks.current.onStatusChange?.(current);
        callbacks.current.onNotice?.({title: 'Replacement approved', body: 'The saved job will publish your replacement answer and verify search availability.', variant: 'success'});
        setPollVersion(v => v + 1);
      }
    } catch (error) {
      if (mounted.current) { setFormError((error as ApiError)?.errors?.[0]?.detail || 'Unable to approve replacement. Compare the current record again.'); setConflict(null); }
    } finally { locked.current = false; if (mounted.current) setSubmitting(false); }
  }

  const active = Boolean(resolution && !terminal.has(resolution.status));
  const available = resolution?.status === 'available';
  const correctionBlocked = Boolean(resolution && ['failed', 'review_needed'].includes(resolution.status) && resolution.can_correct === false);
  const fieldsDisabled = loading || submitting || active || available || correctionBlocked;
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
    {resolution && !resolution.failure && resolution.error && <p role="alert">{resolution.issue || 'Processing stopped. Your answer is saved. The cause needs investigation.'} Submission: {resolution.id}</p>}
    {resolution?.failure && <div role="alert">
      <strong>{resolution.failure.owner === 'submitter' ? 'Correction needed' : 'Processing needs attention'}</strong>
      <p>{resolution.failure.message}</p>
      <p>Submission: {resolution.id}{resolution.failure.stage ? ` · Step: ${resolution.failure.stage}` : ''}</p>
      {resolution.failure.owner === 'operator' && !resolution.failure.retryable && <p>No answer edit is known to resolve this issue. Share this submission ID with an operator.</p>}
    </div>}
    {resolution?.status === 'failed' && resolution.can_retry && resolution.failure?.retryable && <div role="alert" className={styles.retryNotice}>
      <strong>Your answer is saved — processing was interrupted.</strong>
      <p>A temporary service error stopped this job. You do not need to ask the question again or submit another answer.</p>
      <button type="button" disabled={submitting || loading} onClick={() => void retrySavedSubmission()}>
        {submitting ? 'Restarting…' : 'Retry saved submission'}
      </button>
    </div>}
    {resolution && active && resolution.attempts > 0 && <p role="status">Processing is retrying automatically after a temporary service error. Your answer is saved; no resubmission is needed.</p>}
    {resolution?.status === 'review_needed' && resolution.failure?.action === 'review_conflict' && <section aria-label="Conflicting answer" className={styles.conflictPanel}>
      <div className={styles.conflictHeader}><span className={styles.conflictBadge}>Review needed</span><h3>Review the document update</h3><p>Your answer is saved. Review the points below, then enter the final version to publish.</p></div>
      <button className={styles.conflictSecondaryButton} type="button" disabled={submitting} onClick={() => void reviewConflict()}>{submitting ? 'Loading claims…' : 'Resolve conflicting claims'}</button>
      {formError && <p role="alert">{formError}</p>}
      {conflict && <>
        <div className={styles.conflictSummary}><h4>What needs your attention</h4><ul className={styles.conflictClaims}>{(conflict.conflicts || []).map((claim, index) => <li key={index}>{claim}</li>)}</ul></div>
        <label htmlFor={`final-answer-${sourceId}`}>Final answer</label><p className={styles.conflictHint}>Enter the complete answer that should replace the existing document.</p>
        <textarea className={styles.finalAnswerInput} rows={6} id={`final-answer-${sourceId}`} value={finalAnswer} maxLength={5000} disabled={submitting} onChange={e => setFinalAnswer(e.target.value)} />
        <label htmlFor={`overwrite-reason-${sourceId}`}>Reason for this update</label>
        <textarea className={styles.replacementReasonInput} rows={3} id={`overwrite-reason-${sourceId}`} value={overwriteReason} maxLength={2000} disabled={submitting} onChange={e => setOverwriteReason(e.target.value)} />
        <label className={styles.overwriteConfirmation}><input type="checkbox" checked={overwriteConfirmed} disabled={submitting} onChange={e => setOverwriteConfirmed(e.target.checked)} /> I confirm that this final answer should replace the existing document.</label>
        <button className={styles.conflictPrimaryButton} type="button" disabled={submitting || !overwriteConfirmed || !overwriteReason.trim() || !finalAnswer.trim() || finalAnswer.length > 5000} onClick={() => void overwriteAnswer()}>Save final answer</button>
        <p className={styles.conflictHint}>The existing document will be updated. Its previous version is kept in the history.</p>
      </>}
    </section>}
    {formError && resolution?.failure?.action !== 'review_conflict' && <p role="alert">{formError}</p>}
    {correctionBlocked && !resolution?.failure?.retryable && <p role="alert">This job cannot be edited because publication has started or it is no longer correctable. Share submission {resolution?.id} with an operator to reconcile its publication.</p>}
    <form onSubmit={submit}>
      <fieldset className={styles.applicability} disabled={fieldsDisabled}>
        <legend>Where does this answer apply?</legend>
        <div className={styles.scopeChoices}>
          {[['national', 'Across the Netherlands'], ['municipality', 'A specific location']].map(([value, label]) =>
            <label key={value} className={`${styles.scopeChoice} ${scope === value ? styles.scopeSelected : ''}`}>
              <input type="radio" name={`scope-${sourceId}`} value={value} checked={scope === value}
                onChange={() => { dirty.current = true; setScope(value); setLocationError(''); }} />
              <span>{label}</span>
            </label>
          )}
        </div>
        {scope === 'municipality' && <div className={styles.municipalityField}>
          <label htmlFor={`municipality-${sourceId}`}>Municipality</label>
          <select id={`municipality-${sourceId}`} value={municipality} disabled={fieldsDisabled}
            aria-invalid={Boolean(locationError)} onChange={e => { dirty.current = true; setMunicipality(e.target.value); setLocationError(''); }}>
            <option value="">Choose a municipality</option>
            {municipalities.map(place => <option key={place.code} value={place.code}>{place.name}</option>)}
          </select>
          <small>All 342 municipalities. Type a name while the list is open to jump to it.</small>
        </div>}
      </fieldset>
      {locationError && <p role="alert">{locationError}</p>}
      {resolution && ['failed', 'review_needed'].includes(resolution.status) && <>
        <label htmlFor={`question-${sourceId}`}>Question</label>
        <input id={`question-${sourceId}`} value={question} maxLength={2000} disabled={fieldsDisabled} onChange={e => { dirty.current = true; setQuestion(e.target.value); }} />
      </>}
      <label htmlFor={`answer-${sourceId}`}>Reviewed answer</label>
      <textarea id={`answer-${sourceId}`} value={answer} onChange={e => { dirty.current = true; setAnswer(e.target.value); }}
        aria-describedby={`answer-count-${sourceId}`} aria-invalid={tooLong} rows={5} required disabled={fieldsDisabled}
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
        <button type="submit" className={styles.submit} disabled={fieldsDisabled || !answer.trim() || tooLong}
          aria-describedby={hint ? `submit-hint-${sourceId}` : undefined}>
          {submitting && <span className={styles.submitSpinner} aria-hidden="true" />}
          {submitting ? 'Submitting…' : active || available ? 'Submitted' : resolution && ['failed', 'review_needed'].includes(resolution.status) ? 'Save corrections and retry' : 'Submit answer'}
        </button>
        {hint && <p className={styles.resolveHint} id={`submit-hint-${sourceId}`}>{hint}</p>}
      </div>
    </form>
  </section>;
}
