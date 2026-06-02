import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Props {
    content: string;
}

export const MarkdownRenderer: React.FC<Props> = ({ content }) => {
    return (
        <div className="markdown-body">
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    a: ({ href, children }) => (
                        <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="content-link"
                        >
                            {children}
                        </a>
                    ),
                    // Keep tables scrollable on small screens
                    table: ({ children }) => (
                        <div className="content-table-wrapper">
                            <table className="content-table">{children}</table>
                        </div>
                    ),
                }}
            >
                {content}
            </ReactMarkdown>
        </div>
    );
};
