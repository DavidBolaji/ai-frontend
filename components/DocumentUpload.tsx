import { useRef, useState } from 'react';
import type { UploadedDocument } from '@/lib/types';

interface Props {
  onComplete: (doc: UploadedDocument) => void;
  onError: (msg: string) => void;
  disabled?: boolean;
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );
}

const ACCEPT = '.pdf,.docx,.jpg,.jpeg,.png,.webp,.gif,.xlsx,.csv';

const STAGE_LABELS: Record<string, string> = {
  validating: 'Validating…',
  uploading: 'Uploading…',
  generating_preview: 'Generating preview…',
  saving_preview: 'Saving…',
};

export function DocumentUpload({ onComplete, onError, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  // The progress bar is always in the DOM — we show/hide it via DOM ref
  // so updates are never blocked by React's render batching.
  const progressWrapRef = useRef<HTMLDivElement>(null);
  const barFillRef = useRef<HTMLDivElement>(null);
  const pctLabelRef = useRef<HTMLSpanElement>(null);
  const stageLabelRef = useRef<HTMLSpanElement>(null);

  const showProgress = () => {
    if (progressWrapRef.current) {
      progressWrapRef.current.style.display = 'flex';
      // Force a reflow so the browser registers the element as painted before
      // we change width — without this, display:none→flex + immediate width
      // change collapses into one frame and the CSS transition never fires.
      void progressWrapRef.current.offsetHeight;
    }
  };
  const hideProgress = () => {
    if (progressWrapRef.current) progressWrapRef.current.style.display = 'none';
    if (barFillRef.current) barFillRef.current.style.width = '0%';
    if (pctLabelRef.current) pctLabelRef.current.textContent = '0%';
    if (stageLabelRef.current) stageLabelRef.current.textContent = 'Validating…';
  };
  const setBarProgress = (pct: number, stage: string) => {
    if (barFillRef.current) barFillRef.current.style.width = `${pct}%`;
    if (pctLabelRef.current) pctLabelRef.current.textContent = `${pct}%`;
    if (stageLabelRef.current) stageLabelRef.current.textContent = STAGE_LABELS[stage] ?? 'Processing…';
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (inputRef.current) inputRef.current.value = '';
    if (!file) return;

    setIsUploading(true);
    showProgress();        // immediately visible — no React render required
    setBarProgress(0, 'validating');

    const token =
      typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;

    const formData = new FormData();
    formData.append('file', file);

    let response: Response;
    try {
      response = await fetch('/api/proxy/documents/upload', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
    } catch {
      setIsUploading(false);
      hideProgress();
      onError('Network error — could not reach upload service.');
      return;
    }

    if (!response.ok || !response.body) {
      setIsUploading(false);
      hideProgress();
      onError(`Upload failed (HTTP ${response.status}).`);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          for (const line of part.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            let event: any;
            try {
              event = JSON.parse(line.slice(6));
            } catch {
              continue;
            }

            if (event.type === 'progress') {
              setBarProgress(event.pct ?? 0, event.stage ?? '');
            } else if (event.type === 'complete') {
              setBarProgress(100, 'saving_preview');
              setTimeout(() => {
                hideProgress();
                setIsUploading(false);
              }, 300);
              const doc: UploadedDocument = {
                document_id: event.document_id,
                s3_url: event.s3_url,
                file_type: event.file_type,
                size_bytes: event.size_bytes,
                preview: event.preview ?? null,
              };
              onComplete(doc);
              return;
            } else if (event.type === 'error') {
              hideProgress();
              setIsUploading(false);
              onError(event.detail || 'Upload failed.');
              return;
            }
          }
        }
      }
    } finally {
      hideProgress();
      setIsUploading(false);
    }
  };

  return (
    <div className="doc-upload-wrap">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        style={{ display: 'none' }}
        onChange={handleFileChange}
        disabled={disabled || isUploading}
      />
      <button
        type="button"
        className="btn-attach"
        title="Attach document"
        aria-label="Attach document"
        disabled={disabled || isUploading}
        onClick={() => inputRef.current?.click()}
      >
        <PlusIcon />
      </button>
      {/* Always in DOM — shown/hidden via ref so updates are never batched */}
      <div
        ref={progressWrapRef}
        className="upload-progress-wrap"
        style={{ display: 'none' }}
        aria-live="polite"
      >
        <span ref={stageLabelRef} className="upload-progress-label">Validating…</span>
        <div className="upload-progress-bar-track">
          <div
            ref={barFillRef}
            className="upload-progress-bar-fill"
            style={{ width: '0%' }}
          />
        </div>
        <span ref={pctLabelRef} className="upload-progress-pct">0%</span>
      </div>
    </div>
  );
}
