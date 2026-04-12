import React from 'react';
import type { ContentBlock } from '@/lib/types';

interface ContentBlockRendererProps {
  blocks: ContentBlock[];
}

export const ContentBlockRenderer: React.FC<ContentBlockRendererProps> = ({ blocks }) => {
  const normalizedBlocks = normalizeBlocks(blocks);

  let orderedCounter = 1;
  // Track whether the ordered counter should carry over to the next
  // ordered list.  A bullet list between two ordered lists should NOT
  // reset the counter (e.g. "1. Step\n  - sub\n2. Step" pattern).
  // Only a non-list block (heading, text, hr…) resets it.
  let orderedGroupActive = false;
  return (
    <>
      {normalizedBlocks.map((block, index) => {
        if (block.type === 'list' && block.ordered) {
          if (!orderedGroupActive) orderedCounter = 1;
          const start = orderedCounter;
          orderedCounter += block.items?.length || 0;
          orderedGroupActive = true;
          return <ContentBlockItem key={index} block={block} orderedStart={start} />;
        }
        // Bullet lists keep the group alive; any other block type closes it.
        if (block.type !== 'list') {
          orderedGroupActive = false;
        }
        return <ContentBlockItem key={index} block={block} />;
      })}
    </>
  );
};

function normalizeBlocks(blocks: ContentBlock[]): ContentBlock[] {
  const normalized: ContentBlock[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.type !== 'list') {
      // Suppress a text block when the very next block is a link with the same text
      // (prevents duplicate rendering of lone URL lines like "**[url](url)**")
      if (block.type === 'text') {
        const next = blocks[i + 1];
        const textContent = (block.content || '').replace(/\*+/g, '').trim();
        if (next?.type === 'link' && textContent === (next.text || '').trim()) {
          continue;
        }
      }
      normalized.push(block);
      continue;
    }

    const cleanedItems = (block.items || []).map((item) => {
      if (!block.ordered) {
        return item;
      }

      // If backend already included manual numbering, strip it so HTML numbering stays correct.
      return item.replace(/^\s*\d+[.)]\s+/, '');
    });

    const prev = normalized[normalized.length - 1];
    if (prev && prev.type === 'list' && prev.ordered === block.ordered) {
      prev.items = [...(prev.items || []), ...cleanedItems];
      continue;
    }

    normalized.push({ ...block, items: cleanedItems });
  }

  return normalized;
}

/**
 * Derive a human-readable label from a bare URL.
 * e.g. "https://www.amsterdam.nl/en/civil-affairs/first-registration"
 *    → "Amsterdam – Civil Affairs · First Registration"
 */
function descriptiveLinkText(url: string): string {
  try {
    const parsed = new URL(url);
    let host = parsed.hostname;
    if (host.startsWith('www.')) host = host.slice(4);
    const domainLabel = host.split('.')[0].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    const path = parsed.pathname.replace(/^\/|\/$/g, '');
    if (path) {
      const skip = new Set(['en', 'nl', 'index', 'index.html']);
      const segments = path.split('/').filter(s => s && !skip.has(s.toLowerCase()));
      if (segments.length > 0) {
        const labels = segments.slice(-2).map(s =>
          s.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
        );
        return `${domainLabel} – ${labels.join(' · ')}`;
      }
    }
    return domainLabel || url;
  } catch {
    return url;
  }
}

function renderInlineMarkdown(text?: string): React.ReactNode {
  if (!text) {
    return null;
  }

  const nodes: React.ReactNode[] = [];
  const pattern = /\(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)\)|\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(...renderPlainWithBreaks(text.slice(lastIndex, match.index), `plain-${lastIndex}`));
    }

    if (match[1] && match[2] && match[3]) {
      nodes.push(
        <a
          key={`link-wrap-${match.index}`}
          href={match[3]}
          target="_blank"
          rel="noopener noreferrer"
          className="content-link"
        >
          {match[2]}
        </a>
      );
    } else if (match[3]) {
      nodes.push(
        <strong key={`strong-${match.index}`}>
          {match[3]}
        </strong>
      );
    } else if (match[4] && match[5]) {
      nodes.push(
        <a
          key={`link-${match.index}`}
          href={match[5]}
          target="_blank"
          rel="noopener noreferrer"
          className="content-link"
        >
          {match[4]}
        </a>
      );
    } else if (match[6]) {
      // Bare URL — derive a descriptive label
      const bareUrl = match[6].replace(/[.,;:!?]+$/, '');
      nodes.push(
        <a
          key={`bare-link-${match.index}`}
          href={bareUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="content-link"
        >
          {descriptiveLinkText(bareUrl)}
        </a>
      );
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(...renderPlainWithBreaks(text.slice(lastIndex), `plain-${lastIndex}`));
  }

  return nodes;
}

function renderPlainWithBreaks(value: string, keyBase: string): React.ReactNode[] {
  const parts = value.split('\n');
  const nodes: React.ReactNode[] = [];

  parts.forEach((part, idx) => {
    nodes.push(<React.Fragment key={`${keyBase}-${idx}`}>{part}</React.Fragment>);
    if (idx < parts.length - 1) {
      nodes.push(<br key={`${keyBase}-br-${idx}`} />);
    }
  });

  return nodes;
}

const ContentBlockItem: React.FC<{ block: ContentBlock; orderedStart?: number }> = ({ block, orderedStart }) => {
  switch (block.type) {
    case 'text':
      return <div className="content-block">{renderInlineMarkdown(block.content)}</div>;

    case 'heading':
      return (
        <div className={`content-block content-heading level-${block.level || 2}`}>
          {renderInlineMarkdown(block.content)}
        </div>
      );

    case 'list': {
      const ListTag = block.ordered ? 'ol' : 'ul';
      const listProps = block.ordered && orderedStart !== undefined ? { start: orderedStart } : {};
      return (
        <div className="content-block">
          <ListTag className={`content-list ${block.ordered ? 'ordered' : 'unordered'}`} {...listProps}>
            {block.items?.map((item, i) => (
              <li key={i}>{renderInlineMarkdown(item)}</li>
            ))}
          </ListTag>
        </div>
      );
    }

    case 'quote':
      return (
        <div className="content-block">
          <blockquote className="content-quote">
            {renderInlineMarkdown(block.content)}
            {block.source && (
              <div style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
                — {block.source}
              </div>
            )}
          </blockquote>
        </div>
      );

    case 'link':
      return (
        <div className="content-block">
          <a
            href={block.url}
            target="_blank"
            rel="noopener noreferrer"
            className="content-link"
          >
            {block.text || block.url}
          </a>
        </div>
      );

    case 'table': {
      const headers = block.headers || [];
      const rows = block.rows || [];
      if (headers.length === 0) return null;
      return (
        <div className="content-block content-table-wrapper">
          <table className="content-table">
            <thead>
              <tr>
                {headers.map((h, i) => (
                  <th key={i}>{renderInlineMarkdown(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci}>{renderInlineMarkdown(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    case 'hr':
      return <hr className="content-divider" />;

    case 'source':
      // Source blocks are handled separately as tags
      return null;

    default:
      return null;
  }
};
