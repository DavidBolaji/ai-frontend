import React from 'react';

interface SkeletonProps {
  className?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({ className = '' }) => {
  return <div className={`skeleton ${className}`}></div>;
};

export const MessageSkeleton: React.FC = () => {
  return (
    <div className="message assistant">
      <div className="skeleton skeleton-message" style={{ width: '60%' }}></div>
    </div>
  );
};

export const ConversationSkeleton: React.FC = () => {
  return (
    <div style={{ padding: '0.5rem' }}>
      <div className="skeleton skeleton-conversation"></div>
      <div className="skeleton skeleton-conversation"></div>
      <div className="skeleton skeleton-conversation"></div>
    </div>
  );
};

export const TextSkeleton: React.FC<{ lines?: number }> = ({ lines = 3 }) => {
  return (
    <div>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="skeleton skeleton-text"
          style={{
            width: i === lines - 1 ? '70%' : '100%',
          }}
        ></div>
      ))}
    </div>
  );
};
