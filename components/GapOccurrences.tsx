import { useEffect, useState } from 'react';
import ResolutionIndicator from '@/components/ResolutionIndicator';
import type { Resolution } from '@/components/KnowledgeResolution';
import styles from '@/styles/knowledge.module.css';

type Occurrence = { id: string; question?: string; status?: string; created_at?: string; resolution?: Resolution | null };
type Props = {
  groupId: string;
  selectedId: string;
  read: (params: Record<string, string>, signal?: AbortSignal) => Promise<any>;
  onSelect: (record: Occurrence) => void;
};

export default function GapOccurrences({ groupId, selectedId, read, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Occurrence[]>([]);
  const [total, setTotal] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, retry] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true); setError(''); setRows([]);
    read({ operation: 'occurrences', id: groupId, offset: String(page * 25) }, controller.signal)
      .then(data => {
        if (controller.signal.aborted) return;
        setRows(data.gaps); setTotal(data.meta.total); setHasNext(data.meta.has_next);
      })
      .catch(err => { if (!controller.signal.aborted) setError(err.message || 'Unable to load occurrences.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, groupId, page, read, revision]);
  return <section className={styles.occurrences} aria-label="Question occurrences">
    <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}> {open ? '▾' : '▸'} View original questions{total ? ` (${total})` : ''}</button>
    {open && <>
      <p>Each occurrence keeps its own answer, evidence and status. Grouping does not resolve it.</p>
      {loading && <p role="status">Loading occurrences…</p>}
      {error && <p role="alert">{error} <button type="button" onClick={() => retry(value => value + 1)}>Try again</button></p>}
      {rows.map(row => <button type="button" key={row.id} className={styles.occurrence} aria-pressed={row.id === selectedId} onClick={() => onSelect(row)}>
        {row.resolution && <ResolutionIndicator status={row.resolution.status} />}
        <strong>{row.question}</strong><span>{row.status}{row.created_at ? ` · ${new Date(row.created_at).toLocaleString()}` : ''}</span>
      </button>)}
      <nav aria-label="Occurrence pagination">
        <button type="button" disabled={!page || loading} onClick={() => setPage(value => value - 1)}>Previous occurrences</button>
        <span> Page {page + 1} </span>
        <button type="button" disabled={!hasNext || loading || Boolean(error)} onClick={() => setPage(value => value + 1)}>Next occurrences</button>
      </nav>
    </>}
  </section>;
}
