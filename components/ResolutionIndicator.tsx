/** Persistent attendance marker: accepted work is distinct from available knowledge. */
export default function ResolutionIndicator({ status }: { status?: string }) {
  if (!status) return null;
  const available = status === 'available';
  const failed = status === 'failed';
  const review = status === 'review_needed';
  const superseded = status === 'superseded' || status === 'deleted';
  const label = status === 'deleted' ? 'Processing job deleted' : available ? 'Answer ingested and available' : failed ? 'Answer processing failed' : review ? 'Answer needs review' : superseded ? 'Answer superseded by a newer update' : 'Answer submitted — pending ingestion';
  const color = available ? '#18754e' : failed ? '#b42318' : superseded ? '#718078' : '#9a6700';
  return <span role="img" aria-label={label} title={label} data-resolution-state={status}
    style={{ display: 'inline-flex', color, width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: '50%', background: `${color}15` }}>
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {available ? <path d="m5 12 4 4L19 6" /> : failed || review ? <><path d="M12 7v6" /><path d="M12 17h.01" /></> : superseded ? <path d="M6 12h12" /> : <><circle cx="12" cy="12" r="8" /><path d="M12 8v5l3 2" /></>}
    </svg>
  </span>;
}
