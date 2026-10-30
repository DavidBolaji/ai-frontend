import Head from 'next/head';
import { useRouter } from 'next/router';
import { apiClient } from '@/lib/api-client';
import { useEffect, useRef, useState } from 'react';
import styles from '@/styles/knowledge.module.css';

type RecordData = { id: string; question?: string; reason?: string; status?: string; municipality?: string; category?: string; priority?: number; created_at?: string; confirmed?: boolean; kind?: string; gap_id?: string; served?: { user_question?: string; question_resolved?: string; answer_text?: string }; claim?: { what_wrong?: string; what_right?: string }; [key: string]: unknown };
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
function Json({ label, value }: { label: string; value: unknown }) {
  return <details className={styles.json}><summary>{label}</summary><pre>{JSON.stringify(value, null, 2)}</pre></details>;
}
function Context({ record, feedback }: { record: RecordData; feedback: boolean }) {
  const served = (record.served || {}) as Record<string, unknown>;
  const source = feedback ? served : record;
  const fields = [
    ['Municipality', source.municipality],
    ['Category', source.category],
    ['Language', record.language || served.answer_language],
    ['Answer source', served.answer_source],
    ['Route', served.route],
    ['Validation mode', served.validation_mode],
    ['Trace ID', record.trace_id],
  ].filter(([, value]) => typeof value === 'string' && value);
  return <section className={styles.context} aria-label="Recorded context">
    <h3>Context</h3>
    <h4>Original question</h4><p>{record.question || record.served?.user_question || 'Not recorded.'}</p>
    {feedback && <><h4>Question used for retrieval</h4><p>{record.served?.question_resolved || 'Not recorded.'}</p></>}
    <dl className={styles.contextFields}>{fields.map(([label, value]) => <div key={String(label)}><dt>{String(label)}</dt><dd>{String(value)}</dd></div>)}</dl>
    {feedback && <><Json label="Retrieved evidence and freshness" value={served.evidence || []} /><Json label="Validation and missing facts" value={{ validator: served.validator, missing_facts: served.missing_facts }} /><Json label="Related reports and review" value={{ cluster: record.cluster, assessment: record.assessment, review: record.review }} /></>}
    <small>Only recorded context is shown. Earlier conversation turns are not included in this view.</small>
  </section>;
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
  const [tab, setTab] = useState<'gaps' | 'feedback'>('gaps');
  const [status, setStatus] = useState('open');
  const [sort, setSort] = useState('newest');
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
  const listScroll = useRef<HTMLDivElement>(null);
  const selectionVersion = useRef(0);
  useEffect(() => {
    if (!authReady) return;
    selectionVersion.current++;
    setSelected(null); setDetailLoading(false); setRecords([]); setNext('');
    const controller = new AbortController();
    setLoading(true); setError('');
    read({ operation: tab, status, sort, before, offset: String(page * 25) }, controller.signal).then(data => { setRecords(data.gaps || data.reports || []); setNext(data.meta?.next_before || ''); setHasNext(tab === 'gaps' ? Boolean(data.meta?.has_next) : Boolean(data.meta?.next_before)); listScroll.current?.scrollTo(0, 0); }).catch(err => { if (err.name !== 'AbortError') setError(err.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [authReady, tab, status, sort, revision, before, page]);
  async function inspect(record: RecordData) {
    const version = ++selectionVersion.current;
    setSelected(record); setError(''); setDetailLoading(tab === 'gaps');
    if (tab !== 'gaps') return;
    try { const detail = await read({ operation: 'gap', id: record.id }); if (version === selectionVersion.current) setSelected(detail); }
    catch (err) { if (version === selectionVersion.current) setError((err as Error).message); }
    finally { if (version === selectionVersion.current) setDetailLoading(false); }
  }
  const filtered = records.filter(record => JSON.stringify(record).toLowerCase().includes(query.toLowerCase()));
  const statuses = tab === 'gaps' ? ['open', 'researching', 'answered', 'rejected'] : ['quarantined', 'ignored', 'promoted', 'merged', 'closed'];
  if (!authReady) return <main className={styles.workspace}><p role="status">Redirecting to sign in…</p></main>;
  return <div className={styles.workspace}>
    <Head><title>Knowledge review · Kaya</title><meta name="robots" content="noindex,nofollow" /></Head>
    <aside className={styles.sidebar}>
      <a className={styles.brand} href="/">kaya<span> / review</span></a>
      <p className={styles.eyebrow}>KNOWLEDGE WORKSPACE</p>
      <nav aria-label="Review views">{(['gaps', 'feedback'] as const).map(view => <button key={view} aria-current={tab === view ? 'page' : undefined} className={tab === view ? styles.active : ''} onClick={() => { setTab(view); setStatus(view === 'gaps' ? 'open' : 'quarantined'); setQuery(''); setBefore(''); setPage(0); setCursors(['']); }}>{view === 'gaps' ? '◌  Knowledge gaps' : '☰  User feedback'}</button>)}</nav>
      <div className={styles.environment}><p><span className={styles.dot} /> Read-only workspace</p><small>Connected through the backend API. Staff access is required.</small><p><button type="button" className={styles.signOut} onClick={() => apiClient.logout()}>Sign out</button></p></div>
    </aside>
    <main className={styles.main}>
      <header className={styles.header}><div><p className={styles.eyebrow}>KAYA / QUALITY & INSIGHTS</p><h1>{tab === 'gaps' ? 'Knowledge gaps' : 'User feedback'}</h1><p>{tab === 'gaps' ? 'See where answers fall short and understand the evidence.' : 'Understand reported answers and the feedback behind them.'}</p></div><button className={styles.refresh} onClick={() => refresh(value => value + 1)} disabled={loading}>↻ Refresh</button></header>
      <div className={styles.summary}><div><strong>{records.length}</strong><span>Loaded records</span></div><div><strong>{filtered.length}</strong><span>Matching your search</span></div><div><strong>API</strong><span>Backend connection</span></div></div>
      <div className={styles.toolbar}><label className={styles.search}>Search loaded records<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search questions, IDs, or topics…" /></label><label>Status<select value={status} onChange={e => { setStatus(e.target.value); setBefore(''); setPage(0); setCursors(['']); }}>{statuses.map(s => <option key={s}>{s}</option>)}</select></label><label>Created at<select value={sort} onChange={e => { setSort(e.target.value); setBefore(''); setPage(0); setCursors(['']); }}>{['newest', 'oldest'].map(order => <option key={order} value={order}>{order === 'newest' ? 'Newest first' : 'Oldest first'}</option>)}</select></label></div>
      {error && <div role="alert" className={styles.error}>{error}</div>}
      <div className={styles.content}>
        <section className={styles.list} aria-label="Records" aria-busy={loading}>
          <div className={styles.listHeading}>{tab === 'gaps' ? 'QUESTIONS TO INVESTIGATE' : 'REPORTED ANSWERS'}<span>{filtered.length}</span></div>
          <nav className={styles.footer} aria-label="Pagination"><span>Page {page + 1} · 25 per page</span><button disabled={page === 0 || loading} onClick={() => { setPage(page - 1); if (tab === 'feedback') setBefore(cursors[page - 1]); }}>← Previous</button><button disabled={!hasNext || loading || Boolean(error)} onClick={() => { if (tab === 'feedback') { setCursors([...cursors.slice(0, page + 1), next]); setBefore(next); } setPage(page + 1); }}>Next →</button></nav>
          <div className={styles.recordsScroll} ref={listScroll}>{loading ? <p className={styles.empty} role="status">Loading records…</p> : filtered.length === 0 ? <p className={styles.empty}>{query ? 'No loaded records match your search.' : 'No records available for this status.'}</p> : filtered.map(record => <button className={`${styles.record} ${selected?.id === record.id ? styles.selected : ''}`} key={record.id} onClick={() => inspect(record)}><span className={styles.badge}>{record.status}</span><h2>{record.question || record.served?.user_question || 'Question unavailable'}</h2><p>{record.reason || record.kind?.replaceAll('_', ' ') || 'Feedback report'}</p><div className={styles.cardFooter}><small>{[record.municipality, record.category].filter(Boolean).join(' · ')}</small>{record.created_at && <time className={styles.timestamp} dateTime={record.created_at} title={new Date(record.created_at).toString()}>{formatTimestamp(record.created_at)}</time>}</div></button>)}
          </div>

        </section>
        <section className={styles.detail} aria-label="Record details" aria-busy={detailLoading}>
          {!selected ? <div className={styles.placeholder}><span>◎</span><h2>A closer look</h2><p>Select a record to inspect the question,<br /> evidence, and available context.</p></div> : <><p className={styles.eyebrow}>RECORD DETAILS</p><h2>{selected.question || selected.served?.user_question || 'Question unavailable'}</h2><code className={styles.id}>{selected.id}</code><p>Created at: {selected.created_at ? <time dateTime={selected.created_at}>{formatTimestamp(selected.created_at)}</time> : 'Not recorded'}</p><Context record={selected} feedback={tab === 'feedback'} />{detailLoading ? <p role="status">Loading failure details…</p> : tab === 'gaps' ? <><h3>Logged reason</h3><p>{selected.reason || 'Not recorded.'}</p><Json label="Recorded signals" value={selected.signals} />{selected.served_failure_available === false && <p className={styles.notice}>No stored assistant response is available. Missing details are not inferred.</p>}<Json label="Served validation and failure" value={selected.served_failure} /><Json label="Pipeline stages (execution order)" value={selected.stages} /><Json label="Retrieved record IDs" value={selected.retrieved_record_ids} /></> : <><h3>Answer being reported</h3><p className={styles.answer}>{selected.served?.answer_text || 'Answer unavailable.'}</p><h3>User feedback <span className={styles.badge}>Unverified</span></h3>{selected.confirmed ? <><h4>What was wrong</h4><p>{selected.claim?.what_wrong || 'Not supplied.'}</p><h4>Proposed correction</h4><p>{selected.claim?.what_right || 'Not supplied.'}</p></> : <p className={styles.notice}>The user has not confirmed this report. Feedback text is not captured until confirmation.</p>}<Json label="Resolved retrieval question" value={selected.served?.question_resolved || 'Not recorded.'} />{selected.gap_id && <p>Linked gap: <code>{selected.gap_id}</code></p>}</>}<Json label="Full record" value={selected} /></>}
        </section>
      </div>
    </main>
  </div>;
}
