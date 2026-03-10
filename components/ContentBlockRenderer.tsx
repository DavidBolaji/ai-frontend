import React from 'react';
import type { ContentBlock } from '@/lib/types';

interface ContentBlockRendererProps {
  blocks: ContentBlock[];
}

export const ContentBlockRenderer: React.FC<ContentBlockRendererProps> = ({ blocks }) => {
  const normalizedBlocks = normalizeBlocks(blocks);

  let orderedCounter = 1;
  return (
    <>
      {normalizedBlocks.map((block, index) => {
        if (block.type === 'list' && block.ordered) {
          const start = orderedCounter;
          orderedCounter += block.items?.length || 0;
          return <ContentBlockItem key={index} block={block} orderedStart={start} />;
        }
        return <ContentBlockItem key={index} block={block} />;
      })}
    </>
  );
};

function normalizeBlocks(blocks: ContentBlock[]): ContentBlock[] {
  const normalized: ContentBlock[] = [];

  for (const block of blocks) {
    if (block.type !== 'list') {
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

function renderInlineMarkdown(text?: string): React.ReactNode {
  if (!text) {
    return null;
  }

  const nodes: React.ReactNode[] = [];
  const pattern = /\(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)\)|\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
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

    case 'source':
      // Source blocks are handled separately as tags
      return null;

    default:
      return null;
  }
};
