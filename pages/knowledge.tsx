import Head from 'next/head';
import { useRouter } from 'next/router';
import { apiClient } from '@/lib/api-client';
import { useEffect, useRef, useState } from 'react';
import styles from '@/styles/knowledge.module.css';

type ValidationCheck = { tool: string; stage?: string; reviewed_answer?: string; passed?: boolean; reason?: string; explanation?: string; knowledge_gap_details?: string };
type Cause = { limitation_cause?: string | null; verdict?: string | null; reason_code?: string | null; explanation?: string | null; knowledge_gap_details?: string | null; missing?: string[] };
type Rating = { rating?: number; comment?: string | null; source?: string | null; signal_type?: string | null; created_at?: string | null };
type Served = { web_urls?: string[]; review_context?: Record<string, string>; user_question?: string; question_resolved?: string; answer_text?: string; answer_language?: string; answer_source?: string; municipality?: string; category?: string; validator?: { verdict?: string; reason?: string } | null; evidence?: { record_id?: string; freshness?: string }[] };
type RecordData = { review_context?: Record<string, string>; validation_history?: ValidationCheck[]; final_quality_passed?: boolean; id: string; question?: string; reason?: string; status?: string; municipality?: string; category?: string; language?: string; priority?: number; created_at?: string; confirmed?: boolean; kind?: string; gap_id?: string; answer_text?: string | null; cause?: Cause; message_feedback?: Rating | null; claim_type?: string | null; assessment?: { verdict?: string | null; reason?: string | null; status?: string }; review?: { note?: string | null; reviewer_outcome?: string | null }; served?: Served; claim?: { what_wrong?: string; what_right?: string }; [key: string]: unknown };
async function read(params: Record<string, string>, signal?: AbortSignal) {
  try {
    if (!apiClient.hasValidSession()) {
      apiClient.logout();
      throw new DOMException('Redirecting to login', 'AbortError');
    }
    const data = await apiClient.readKnowledge(params);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return data;
  } catch (error: any) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (!apiClient.isAuthenticated() || error.errors?.[0]?.status === '401') {
      apiClient.logout();
      throw new DOMException('Redirecting to login', 'AbortError');
    }
    throw new Error(error.errors?.[0]?.detail || error.message || 'Unable to load records.');
  }
}
function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  const day = date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${day} · ${time}`;
}
function words(value: string): string {
  return value.replaceAll('_', ' ');
}
function Missing({ children }: { children: string }) {
  return <p className={styles.missing}>{children}</p>;
}
// Short, closed-set labels — a verdict, a claim type, a signal name. The prose
// that explains the record lives in its own paragraph, never in a chip.
function Labels({ values }: { values: (string | null | undefined)[] }) {
  // Deduplicated: a validator gap and the signal recorded from it carry the
  // same name, and the same chip twice is both noise and a repeated key.
  const shown = [...new Set(values.filter((value): value is string => Boolean(value)))];
  if (!shown.length) return null;
  return <p className={styles.labels}>{shown.map(value => <span className={styles.badge} key={value}>{words(value)}</span>)}</p>;
}
const issueDescriptions: Record<string, string> = {
  groundedness: 'The automated check found claims that the available sources did not support.',
  scope: 'The answer may apply to the wrong place, audience, or time.',
  refusal: 'The answer may have guessed about information it could not verify.',
  tone: 'The answer may be confusing or alarming for the reader.',
  evidence_gap: 'Supporting evidence is missing.',
  knowledge_gap: 'Information needed to answer the question is missing.',
  action_gap: 'The answer does not give a sufficiently supported next step.',
};
function issueText(value?: string | null): string | undefined {
  const label = value?.match(/\bvalue=['"]([^'"]+)['"]/)?.[1] || value;
  return label ? issueDescriptions[label.toLowerCase()] : undefined;
}
type SignalArea = 'question' | 'retrieval' | 'validation' | 'answer';
const signalDetails: Record<string, { area: SignalArea; label: string; explanation: string }> = {
  low_confidence: { area: 'question', label: 'Low confidence', explanation: 'During request classification, the system was uncertain about the scope or intent.' },
  missing_knowledge: { area: 'retrieval', label: 'Missing knowledge', explanation: 'During retrieval or answer preparation, no usable internal information was available.' },
  empty_retrieval: { area: 'retrieval', label: 'No internal results', explanation: 'The retrieval step returned no internal results.' },
  insufficient_retrieval: { area: 'retrieval', label: 'Insufficient evidence', explanation: 'During answer preparation or validation, the available evidence was judged insufficient. This flag can remain after recovery.' },
  conflicting_evidence: { area: 'retrieval', label: 'Conflicting evidence', explanation: 'During answer preparation, the retrieved information was found to conflict.' },
  validator_revise: { area: 'validation', label: 'Draft revision', explanation: 'A validator requested changes or a rewrite occurred before delivery. The checks below show the recorded outcomes.' },
  unresolved_request: { area: 'answer', label: 'Request unresolved', explanation: 'At the end of processing, the request was recorded as unresolved.' },
  answered_by_external: { area: 'answer', label: 'External sources used', explanation: 'External web sources were used to prepare the answer. Their recorded URLs are listed in the sources section.' },
  answered_by_rag: { area: 'answer', label: 'Internal knowledge used', explanation: 'The recorded answer source was the internal retrieval path.' },
  answered_by_bedrock: { area: 'answer', label: 'Model-assisted answer', explanation: 'The recorded answer source was the model assistance path rather than internal retrieval alone.' },
  answered_by_unresolved: { area: 'answer', label: 'No supported resolution', explanation: 'The recorded answer source was unresolved.' },
};
function SignalNotes({ record, area }: { record: RecordData; area: SignalArea }) {
  const entries = activeSignals(record).filter(name => signalDetails[name]?.area === area);
  if (!entries.length) return null;
  return <ul className={styles.signalNotes} aria-label="Recorded signals">{entries.map(name => <li key={name}>
    <span className={styles.badge}>{signalDetails[name].label}</span>
    <p>{signalDetails[name].explanation}</p>
  </li>)}</ul>;
}
const contextNames: Record<string, string> = { stay_duration: 'Expected stay', audience: 'User situation', residence_status: 'Residence situation', passport_group: 'Passport group' };
const contextValues: Record<string, string> = { up_to_four_months: 'Four months or less', more_than_four_months: 'More than four months', eu_eea_swiss: 'EU, EEA or Swiss', permit_holder: 'Residence permit holder', application_pending: 'Application pending', prefer_not_to_say: 'Not shared', not_sure: 'Not sure', worker: 'Worker', student: 'Student', parent: 'Parent', family: 'Family', new_arrival: 'New arrival', asylum_status_holder: 'Asylum status holder', other: 'Other situation' };
function Context({ record, feedback }: { record: RecordData; feedback: boolean }) {
  const served = record.served || {};
  const asked = served.user_question || record.question;
  const retrieval = served.question_resolved;
  const userContext = record.review_context || served.review_context || {};
  // A report carries its own place and topic in the snapshot; a gap carries them
  // on the row itself.
  const fields = [
    ['Municipality', (feedback ? served.municipality : record.municipality) || record.municipality],
    ['Category', (feedback ? served.category : record.category) || record.category],
    ['Language', record.language || served.answer_language],
    ...Object.entries(contextNames).map(([key, label]) => [label, contextValues[userContext[key]]]),
  ].filter(([, value]) => typeof value === 'string' && value);
  return <section className={styles.context} aria-label="Question and context">
    <p className={styles.stepLabel}>THE REQUEST</p><h3>Question understood in context</h3>
    <SignalNotes record={record} area="question" />
    {retrieval || asked ? <p>{retrieval || asked}</p> : <Missing>The question was not recorded.</Missing>}
    {fields.length > 0 && <dl className={styles.contextFields}>{fields.map(([label, value]) => <div key={String(label)}><dt>{String(label)}</dt><dd>{String(value)}</dd></div>)}</dl>}
  </section>;
}
function Answer({ record, feedback, pending }: { record: RecordData; feedback: boolean; pending: boolean }) {
  const text = feedback ? record.served?.answer_text : record.answer_text;
  return <><p className={styles.stepLabel}>DELIVERED TO THE USER</p><h3>Final answer</h3>
    <SignalNotes record={record} area="answer" />
    {pending ? <p role="status">Loading the answer…</p> : text ? <p className={styles.answer}>{text}</p> : <Missing>No stored answer is available for this turn. It is not reconstructed.</Missing>}</>;
}
function documents(record: RecordData, feedback: boolean): { id: string; freshness?: string }[] {
  if (feedback) {
    return (record.served?.evidence || []).filter(item => item?.record_id).map(item => ({ id: String(item.record_id), freshness: item.freshness }));
  }
  const ids = Array.isArray(record.retrieved_record_ids) ? (record.retrieved_record_ids as unknown[]) : [];
  return ids.filter(Boolean).map(id => ({ id: String(id) }));
}
function externalSources(record: RecordData): string[] {
  const urls = record.served?.web_urls;
  if (!Array.isArray(urls)) return [];
  return [...new Set(urls.slice(0, 10).filter((value): value is string => {
    if (typeof value !== 'string') return false;
    try {
      const url = new URL(value);
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
    } catch { return false; }
  }))];
}
function Documents({ record, feedback, pending }: { record: RecordData; feedback: boolean; pending: boolean }) {
  const found = documents(record, feedback);
  const external = externalSources(record);
  const signals = record.signals as Record<string, unknown> | undefined;
  return <><p className={styles.stepLabel}>THE EVIDENCE</p><h3>What information was available</h3>
    <SignalNotes record={record} area="retrieval" />
    {pending ? <p role="status">Loading sources…</p> : <>
      {found.length > 0 && <><h4>Internal knowledge sources</h4><ul className={styles.docs}>{found.map(item => <li key={item.id}><code>{item.id}</code>{item.freshness && <span className={styles.badge}>{words(item.freshness)}</span>}</li>)}</ul></>}
      {external.length > 0 && <><h4>External web sources</h4><ul className={styles.docs}>{external.map(url => <li key={url}><a href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{url}</a></li>)}</ul></>}
      {external.length === 0 && signals?.answered_by_external === true && <Missing>External sources were used, but their URLs were not recorded.</Missing>}
      {found.length === 0 && external.length === 0 && signals?.answered_by_external !== true && <Missing>No source references were recorded for this turn.</Missing>}
    </>}</>;
}
// The signal names on a record say a rewrite or a gap happened; they do not say
// what was wrong. Lead with the recorded prose and keep the names as labels.
function GapReason({ record, pending }: { record: RecordData; pending: boolean }) {
  const cause = record.cause || {};
  const checks = record.validation_history || [];
  if (pending) return <p role="status">Loading the recorded checks…</p>;
  return <>
    <p className={styles.toolLabel}>Tool: Validator</p>
    <SignalNotes record={record} area="validation" />
    {checks.length ? checks.map((check, index) => <section className={styles.validationCheck} key={index}>
      <h4>{index === 0 ? 'Initial draft check' : `Later check ${index}`} · {check.passed === true ? 'Passed' : check.passed === false ? 'Changes requested' : 'Outcome not recorded'}</h4>
      <p><strong>Reason:</strong> {check.explanation || issueText(check.reason) || 'No explanation was recorded.'}</p>
      {check.knowledge_gap_details && <><h4>Information the validator said was needed</h4><p>{check.knowledge_gap_details}</p></>}
    </section>) : <p><strong>Reason:</strong> {cause.explanation || issueText(cause.reason_code) || 'No detailed validator feedback was saved.'}</p>}
    {typeof record.final_quality_passed === 'boolean' && <p><strong>Final recorded validation:</strong> {record.final_quality_passed ? 'Passed' : 'Did not pass'}</p>}
    {!checks.length && cause.knowledge_gap_details && <p>{cause.knowledge_gap_details}</p>}
  </>;
}

function ReportReason({ record }: { record: RecordData }) {
  const judge = record.assessment || {};
  const validator = record.served?.validator;
  return <>
    {record.confirmed ? <>
      {record.claim?.what_wrong ? <><h4>What the reader said was wrong</h4><p className={styles.answer}>{record.claim.what_wrong}</p></> : null}
      {record.claim?.what_right ? <><h4>Correction the reader proposed</h4><p className={styles.answer}>{record.claim.what_right}</p></> : null}
      {!record.claim?.what_wrong && !record.claim?.what_right && <Missing>The reader rated this answer without describing the problem.</Missing>}
    </> : <p className={styles.notice}>The reader never confirmed this report, so their text was not captured. Treat this as an unconfirmed lead.</p>}
    {judge.reason && <><h4>Automated assessment</h4><p>{judge.reason}</p></>}
    {record.review?.note && <><h4>Reviewer note</h4><p>{record.review.note}</p></>}
    {issueText(validator?.reason) && <><h4>Automated check</h4><p>{issueText(validator?.reason)}</p></>}

  </>;
}
function Reader({ value, pending }: { value: Rating | null | undefined; pending: boolean }) {
  if (pending) return <><h3>Reader rating</h3><p role="status">Loading the rating…</p></>;
  const rating = value?.rating;
  return <><h3>{value?.source === 'implicit' ? 'Feedback detected in the conversation' : 'Reader rating'}</h3>
    {!value || typeof rating !== 'number' ? <Missing>No rating was left on this answer.</Missing> : <>
      <Labels values={[rating > 0 ? 'thumbs up' : rating < 0 ? 'thumbs down' : 'neutral', value.source, value.signal_type]} />
      {value.comment ? <p className={styles.answer}>{value.comment}</p> : <Missing>The rating carried no comment.</Missing>}
    </>}</>;
}
// Only what someone needs to write a knowledge record that answers the
// question: what was asked, what was answered, what it was answered from, and
// why that answer was not good enough.
function activeSignals(record: RecordData): string[] {
  if (!record.signals || typeof record.signals !== 'object' || Array.isArray(record.signals)) return [];
  return Object.entries(record.signals).filter(([, value]) => value === true).map(([name]) => name);
}
const gapSignals = ['knowledge_gap', 'missing_knowledge', 'insufficient_retrieval', 'conflicting_evidence', 'empty_retrieval', 'unresolved_request', 'validator_revise', 'low_confidence', 'answered_by_rag', 'answered_by_bedrock', 'answered_by_external', 'answered_by_unresolved'];
function Detail({ record, feedback, pending }: { record: RecordData; feedback: boolean; pending: boolean }) {
  return <>
    <p className={styles.eyebrow}>RECORD DETAILS</p>
    {feedback && record.kind !== 'message_feedback' && <><h3>Claim to review</h3><p>{record.confirmed ? record.claim?.what_wrong || record.claim?.what_right || 'No specific claim was recorded.' : 'An unconfirmed problem was reported with this answer.'}</p></>}
    <Context record={record} feedback={feedback} />
    {record.kind !== 'message_feedback' && <section className={styles.storySection}><p className={styles.stepLabel}>{feedback ? 'THE REPORT' : 'DRAFT CHECKS'}</p><h3>{feedback ? 'Why it needs attention' : 'Validator review of the drafts'}</h3>
    {feedback ? <ReportReason record={record} /> : <GapReason record={record} pending={pending} />}</section>}
    <section className={styles.storySection}><Documents record={record} feedback={feedback} pending={pending} /></section>
    <section className={styles.storySection}><Answer record={record} feedback={feedback} pending={pending} /></section>
    <section className={styles.storySection}><p className={styles.stepLabel}>AFTER THE ANSWER</p><Reader value={record.message_feedback} pending={pending} /></section>

  </>;
}
export default function Knowledge() {
  const router = useRouter();
  const [authReady, setAuthReady] = useState(false);
  useEffect(() => {
    if (!apiClient.hasValidSession()) {
      void router.replace('/login?next=/knowledge');
      return;
    }
    setAuthReady(true);
  }, [router]);
  const [tab, setTab] = useState<'gaps' | 'feedback' | 'messages'>('gaps');
  const [status, setStatus] = useState('open');
  const [sort, setSort] = useState('newest');
  const [signal, setSignal] = useState('');
  const [query, setQuery] = useState('');
  const [records, setRecords] = useState<RecordData[]>([]);
  const [selected, setSelected] = useState<RecordData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [revision, refresh] = useState(0);
  const [before, setBefore] = useState('');
  const [next, setNext] = useState('');
  const [page, setPage] = useState(0);
  const [cursors, setCursors] = useState<string[]>(['']);
  const [hasNext, setHasNext] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const listScroll = useRef<HTMLDivElement>(null);
  const selectionVersion = useRef(0);
  useEffect(() => {
    if (!authReady) return;
    selectionVersion.current++;
    setSelected(null); setDetailLoading(false); setRecords([]); setNext('');
    const controller = new AbortController();
    setLoading(true); setError('');
    read({ operation: tab, ...(tab === 'gaps' && signal ? { signal } : {}), ...(tab === 'messages' ? {} : { status }), sort, before, offset: String(page * 25) }, controller.signal).then(data => { setRecords(data.gaps || data.reports || []); setNext(data.meta?.next_before || ''); setTotal(typeof data.meta?.total === 'number' ? data.meta.total : null); setHasNext(tab === 'gaps' ? Boolean(data.meta?.has_next) : Boolean(data.meta?.next_before)); listScroll.current?.scrollTo(0, 0); }).catch(err => { if (err.name !== 'AbortError') { setError(err.message); setTotal(null); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [authReady, tab, status, sort, revision, before, page, signal]);
  async function inspect(record: RecordData) {
    const version = ++selectionVersion.current;
    setSelected(record); setError(''); setDetailLoading(tab === 'gaps');
    if (tab !== 'gaps') return;
    try { const detail = await read({ operation: 'gap', id: record.id }); if (version === selectionVersion.current) setSelected(detail); }
    catch (err) { if (version === selectionVersion.current) setError((err as Error).message); }
    finally { if (version === selectionVersion.current) setDetailLoading(false); }
  }
  const filtered = records.filter(record => JSON.stringify(record).toLowerCase().includes(query.toLowerCase()));
  const statuses = tab === 'messages' ? ['recorded'] : tab === 'gaps' ? ['open', 'researching', 'answered', 'rejected'] : ['quarantined', 'ignored', 'promoted', 'merged', 'closed'];
  const pages = total === null ? null : Math.max(1, Math.ceil(total / 25));
  if (!authReady) return <main className={styles.workspace}><p role="status">Redirecting to sign in…</p></main>;
  return <div className={styles.workspace}>
    <Head><title>Knowledge review · Easumi</title><meta name="robots" content="noindex,nofollow" /></Head>
    <aside className={styles.sidebar}>
      <a className={styles.brand} href="/">easumi<span> / review</span></a>
      <p className={styles.eyebrow}>KNOWLEDGE WORKSPACE</p>
      <nav aria-label="Review views">{(['gaps', 'feedback', 'messages'] as const).map(view => <button key={view} aria-current={tab === view ? 'page' : undefined} className={tab === view ? styles.active : ''} onClick={() => { setTab(view); setSignal(''); setStatus(view === 'gaps' ? 'open' : view === 'messages' ? 'recorded' : 'quarantined'); setQuery(''); setBefore(''); setPage(0); setCursors(['']); setTotal(null); }}>{view === 'gaps' ? '◌  Knowledge gaps' : view === 'messages' ? '☰  Message feedback' : '☰  Feedback reports'}</button>)}</nav>
      <div className={styles.environment}><p><span className={styles.dot} /> Read-only workspace</p><small>Connected through the backend API. Staff access is required.</small><p><button type="button" className={styles.signOut} onClick={() => apiClient.logout()}>Sign out</button></p></div>
    </aside>
    <main className={styles.main}>
      <header className={styles.header}><div><p className={styles.eyebrow}>EASUMI / QUALITY & INSIGHTS</p><h1>{tab === 'gaps' ? 'Knowledge gaps' : 'User feedback'}</h1><p>{tab === 'gaps' ? 'See where answers fall short and understand the evidence.' : 'Understand reported answers and the feedback behind them.'}</p></div><button className={styles.refresh} onClick={() => refresh(value => value + 1)} disabled={loading}>↻ Refresh</button></header>
      <div className={styles.summary}><div><strong>{total === null ? '—' : total.toLocaleString('en-GB')}</strong><span>{status} records in total</span></div><div><strong>{filtered.length}</strong><span>{query ? 'Matching your search' : 'Shown on this page'}</span></div><div><strong>API</strong><span>Backend connection</span></div></div>
      <div className={styles.toolbar}><label className={styles.search}>Search loaded records<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search questions, IDs, or topics…" /></label><label>Status<select value={status} onChange={e => { setStatus(e.target.value); setBefore(''); setPage(0); setCursors(['']); setTotal(null); }}>{statuses.map(s => <option key={s}>{s}</option>)}</select></label>{tab === 'gaps' && <label>Signal<select value={signal} onChange={e => { setSignal(e.target.value); setPage(0); setBefore(''); setCursors(['']); setTotal(null); }}><option value="">All signals</option>{[...new Set([...gapSignals, ...records.flatMap(activeSignals), ...(signal ? [signal] : [])])].sort().map(name => <option value={name} key={name}>{words(name)}</option>)}</select></label>}<label>Created at<select value={sort} onChange={e => { setSort(e.target.value); setBefore(''); setPage(0); setCursors(['']); }}>{['newest', 'oldest'].map(order => <option key={order} value={order}>{order === 'newest' ? 'Newest first' : 'Oldest first'}</option>)}</select></label></div>
      {error && <div role="alert" className={styles.error}>{error}</div>}
      <div className={styles.content}>
        <section className={styles.list} aria-label="Records" aria-busy={loading}>
          <div className={styles.listHeading}>{tab === 'gaps' ? 'QUESTIONS TO INVESTIGATE' : 'REPORTED ANSWERS'}<span>{filtered.length}</span></div>
          <nav className={styles.footer} aria-label="Pagination"><span>{pages === null ? `Page ${page + 1} · 25 per page` : `Page ${page + 1} of ${pages} · 25 per page`}</span><button disabled={page === 0 || loading} onClick={() => { setPage(page - 1); if (tab !== 'gaps') setBefore(cursors[page - 1]); }}>← Previous</button><button disabled={!hasNext || loading || Boolean(error)} onClick={() => { if (tab !== 'gaps') { setCursors([...cursors.slice(0, page + 1), next]); setBefore(next); } setPage(page + 1); }}>Next →</button></nav>
          <div className={styles.recordsScroll} ref={listScroll}>{loading ? <p className={styles.empty} role="status">Loading records…</p> : filtered.length === 0 ? <p className={styles.empty}>{query ? 'No loaded records match your search.' : 'No records available for this status.'}</p> : filtered.map(record => <button className={`${styles.record} ${selected?.id === record.id ? styles.selected : ''}`} key={record.id} onClick={() => inspect(record)}><span className={styles.badge}>{record.status}</span><h2>{record.question || record.served?.user_question || 'Question unavailable'}</h2><p>{record.kind === 'message_feedback' ? record.message_feedback?.source === 'implicit' ? 'Detected conversation feedback' : 'Reader rating' : record.reason ? issueText(record.reason) || 'Answer needs review' : record.claim_type ? words(record.claim_type) : record.kind ? words(record.kind) : 'Feedback report'}</p><div className={styles.cardFooter}><small>{[record.municipality, record.category].filter(Boolean).join(' · ')}</small>{record.created_at && <time className={styles.timestamp} dateTime={record.created_at} title={new Date(record.created_at).toString()}>{formatTimestamp(record.created_at)}</time>}</div></button>)}
          </div>

        </section>
        <section className={styles.detail} aria-label="Record details" aria-busy={detailLoading}>
          {!selected ? <div className={styles.placeholder}><span>◎</span><h2>A closer look</h2><p>Select a record to see the question, the answer<br /> it was given, and why that answer fell short.</p></div>
            : <Detail record={selected} feedback={tab !== 'gaps'} pending={detailLoading} />}
        </section>
      </div>
    </main>
  </div>;
}
