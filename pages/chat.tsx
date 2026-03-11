import { useState, useEffect, useRef, FormEvent } from 'react';
import { useRouter } from 'next/router';
import { apiClient } from '@/lib/api-client';
import { ContentBlockRenderer } from '@/components/ContentBlockRenderer';
import { MessageSkeleton, ConversationSkeleton } from '@/components/Skeleton';
import type { 
  Conversation, 
  Message, 
  ContentBlock,
  AskResponse 
} from '@/lib/types';

type Mode = 'ask' | 'roadmap';

interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  content_blocks?: ContentBlock[];
  sources?: string[];
  isStreaming?: boolean;
}

const SOURCE_TAG_CACHE_KEY = 'sourceTagCacheByConversation';

type SourceTagCache = Record<string, Record<string, string[]>>;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (error && typeof error === 'object' && 'errors' in error) {
    const maybeErrors = (error as { errors?: Array<{ detail?: string; title?: string }> }).errors;
    if (Array.isArray(maybeErrors) && maybeErrors.length > 0) {
      return maybeErrors[0].detail || maybeErrors[0].title || 'Request failed';
    }
  }

  return 'Failed to send message. Please try again.';
}

function getSourceTagCache(): SourceTagCache {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = localStorage.getItem(SOURCE_TAG_CACHE_KEY);
    if (!raw) {
      return {};
    }
    return JSON.parse(raw) as SourceTagCache;
  } catch {
    return {};
  }
}

function setSourceTagCache(cache: SourceTagCache): void {
  if (typeof window === 'undefined') {
    return;
  }
  localStorage.setItem(SOURCE_TAG_CACHE_KEY, JSON.stringify(cache));
}

function persistSourceTags(conversationId: string, messageId: string, tags: string[]): void {
  if (!conversationId || !messageId || tags.length === 0) {
    return;
  }

  const cache = getSourceTagCache();
  const conversationCache = cache[conversationId] || {};
  conversationCache[messageId] = Array.from(new Set(tags));
  cache[conversationId] = conversationCache;
  setSourceTagCache(cache);
}

function getPersistedSourceTags(conversationId: string, messageId: string): string[] {
  if (!conversationId || !messageId) {
    return [];
  }

  const cache = getSourceTagCache();
  return cache[conversationId]?.[messageId] || [];
}

export default function Chat() {
  const router = useRouter();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const conversationsRef = useRef<HTMLDivElement>(null);
  const messageLoadRequestIdRef = useRef(0);

  // Auth & User
  const [user, setUser] = useState<any>(null);

  // Mode
  const [mode, setMode] = useState<Mode>('ask');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Conversations
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [conversationsPage, setConversationsPage] = useState(0);
  const [hasMoreConversations, setHasMoreConversations] = useState(true);

  // Messages
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);

  // Input
  const [inputMessage, setInputMessage] = useState('');
  const [isSending, setIsSending] = useState(false);

  // Initialize
  useEffect(() => {
    if (!apiClient.isAuthenticated()) {
      router.replace('/login');
      return;
    }

    const userData = apiClient.getUser();
    setUser(userData);

    // Load welcome message
    loadWelcomeMessage();

    // Load conversations
    loadConversations(0);
  }, [router]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadWelcomeMessage = async () => {
    const requestId = ++messageLoadRequestIdRef.current;
    setMessagesLoading(true);

    try {
      const welcome = await apiClient.getWelcomeMessage(mode);
      if (requestId !== messageLoadRequestIdRef.current) {
        return;
      }

      setMessages([{
        id: 'welcome',
        role: 'assistant',
        content: welcome.attributes.message,
        content_blocks: [{
          type: 'text',
          content: welcome.attributes.message,
        }],
      }]);
    } catch (error) {
      console.error('Failed to load welcome message:', error);
      if (requestId !== messageLoadRequestIdRef.current) {
        return;
      }

      setMessages([
        {
          id: 'welcome-fallback',
          role: 'assistant',
          content: 'Hello. How can I help you today?',
          content_blocks: [
            {
              type: 'text',
              content: 'Hello. How can I help you today?',
            },
          ],
        },
      ]);
    } finally {
      if (requestId === messageLoadRequestIdRef.current) {
        setMessagesLoading(false);
      }
    }
  };

  const loadConversations = async (page: number) => {
    if (conversationsLoading) return;

    setConversationsLoading(true);
    try {
      const response = await apiClient.getConversations(page * 20, 20);
      const newConversations = response.attributes.items;

      if (page === 0) {
        setConversations(newConversations);
      } else {
        setConversations(prev => [...prev, ...newConversations]);
      }

      setHasMoreConversations(newConversations.length === 20);
      setConversationsPage(page);
    } catch (error) {
      console.error('Failed to load conversations:', error);
    } finally {
      setConversationsLoading(false);
    }
  };

  const handleConversationsScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const element = e.currentTarget;
    const isAtBottom = element.scrollHeight - element.scrollTop <= element.clientHeight + 50;

    if (isAtBottom && hasMoreConversations && !conversationsLoading) {
      loadConversations(conversationsPage + 1);
    }
  };

  const loadConversationMessages = async (conversationId: string) => {
    setIsMobileSidebarOpen(false);
    const requestId = ++messageLoadRequestIdRef.current;
    setCurrentConversationId(conversationId);
    setMessagesLoading(true);

    try {
      const response = await apiClient.getConversationMessages(conversationId);
      if (requestId !== messageLoadRequestIdRef.current) {
        return;
      }

      const msgs = response.attributes.items.map((msg: Message) => ({
        sourcesFromBlocks: extractSources(msg.attributes.content_blocks),
        persistedSources: getPersistedSourceTags(conversationId, msg.id),
        id: msg.id,
        role: msg.attributes.role,
        content: msg.attributes.content,
        content_blocks: msg.attributes.content_blocks || undefined,
      })).map((msg) => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        content_blocks: msg.content_blocks,
        sources: msg.sourcesFromBlocks.length > 0 ? msg.sourcesFromBlocks : msg.persistedSources,
      }));
      setMessages(msgs);
    } catch (error) {
      console.error('Failed to load messages:', error);
    } finally {
      if (requestId === messageLoadRequestIdRef.current) {
        setMessagesLoading(false);
      }
    }
  };

  const extractSources = (blocks?: ContentBlock[] | null): string[] => {
    if (!blocks) return [];
    
    const sourceBlocks = blocks.filter(b => b.type === 'source');
    const categories = sourceBlocks
      .map((b) => {
        if (b.category) {
          return b.category;
        }

        if (b.filename) {
          return b.filename.replace(/\.[^/.]+$/, '');
        }

        return undefined;
      })
      .filter(Boolean) as string[];
    
    // Return unique categories
    return Array.from(new Set(categories));
  };

  const handleSendMessage = async (e: FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() || isSending) return;

    const userMessage = inputMessage.trim();
    setInputMessage('');
    setIsSending(true);

    // Add user message immediately
    const tempUserMsg: DisplayMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: userMessage,
    };
    setMessages(prev => [...prev, tempUserMsg]);

    const streamingAssistantId = `stream-${Date.now()}`;
    setMessages(prev => [
      ...prev,
      {
        id: streamingAssistantId,
        role: 'assistant',
        content: '',
        isStreaming: true,
      },
    ]);

    const streamChunkQueue: string[] = [];
    let streamFlushTimer: ReturnType<typeof setInterval> | null = null;
    let streamDrainResolver: (() => void) | null = null;

    const resolveDrainIfIdle = () => {
      if (streamChunkQueue.length === 0 && !streamFlushTimer && streamDrainResolver) {
        const resolve = streamDrainResolver;
        streamDrainResolver = null;
        resolve();
      }
    };

    const stopStreamFlush = () => {
      if (streamFlushTimer) {
        clearInterval(streamFlushTimer);
        streamFlushTimer = null;
      }
      resolveDrainIfIdle();
    };

    const startStreamFlush = () => {
      if (streamFlushTimer) {
        return;
      }

      streamFlushTimer = setInterval(() => {
        const nextChunk = streamChunkQueue.shift();
        if (!nextChunk) {
          stopStreamFlush();
          return;
        }

        setMessages(prev => prev.map((msg) => (
          msg.id === streamingAssistantId
            ? { ...msg, content: `${msg.content}${nextChunk}` }
            : msg
        )));
      }, 70);
    };

    const waitForStreamDrain = async () => {
      if (streamChunkQueue.length === 0 && !streamFlushTimer) {
        return;
      }

      await new Promise<void>((resolve) => {
        streamDrainResolver = resolve;
      });
    };

    try {
      const response: AskResponse = await apiClient.askStream({
        message: userMessage,
        conversation_id: currentConversationId || undefined,
      }, {
        onDelta: (chunk: string) => {
          streamChunkQueue.push(chunk);
          startStreamFlush();
        },
      });

      await waitForStreamDrain();

      // Update conversation ID if new
      if (!currentConversationId) {
        setCurrentConversationId(response.attributes.conversation_id);
        // Reload conversations to show new one
        loadConversations(0);
      }

      // Add assistant response
      const assistantMsg: DisplayMessage = {
        id: response.id,
        role: 'assistant',
        content: response.attributes.content,
        content_blocks: response.attributes.content_blocks,
        sources: (() => {
          const extracted = extractSources(response.attributes.content_blocks);
          if (extracted.length > 0) {
            return extracted;
          }
          if (response.attributes.rag_used) {
            return ['RAG'];
          }
          return [];
        })(),
      };

      const targetConversationId = response.attributes.conversation_id;
      if (assistantMsg.sources && assistantMsg.sources.length > 0) {
        persistSourceTags(targetConversationId, assistantMsg.id, assistantMsg.sources);
      }

      setMessages(prev => prev.map((msg) => (
        msg.id === streamingAssistantId
          ? assistantMsg
          : msg
      )));
    } catch (error) {
      stopStreamFlush();
      console.error('Failed to send message:', error);
      // Remove optimistic messages on error
      setMessages(prev => prev.filter(m => m.id !== tempUserMsg.id && m.id !== streamingAssistantId));
      alert(getErrorMessage(error));
    } finally {
      stopStreamFlush();
      setIsSending(false);
    }
  };

  const handleLogout = () => {
    apiClient.logout();
  };

  const startNewConversation = () => {
    setIsMobileSidebarOpen(false);
    // Invalidate any in-flight conversation message request so stale responses are ignored.
    messageLoadRequestIdRef.current += 1;
    setCurrentConversationId(null);
    setMessages([]);
    loadWelcomeMessage();
  };

  if (!user) {
    return (
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        minHeight: '100vh' 
      }}>
        <div>Loading...</div>
      </div>
    );
  }

  return (
    <div className="chat-container">
      {isMobileSidebarOpen && (
        <div
          className="mobile-sidebar-backdrop"
          onClick={() => setIsMobileSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <div className={`chat-sidebar ${isSidebarCollapsed ? 'collapsed' : ''} ${isMobileSidebarOpen ? 'mobile-open' : ''}`}>
        <div className="chat-header">
          <div className="sidebar-top-row">
            <button
              className="btn-sidebar-toggle"
              onClick={() => setIsSidebarCollapsed((prev) => !prev)}
              aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              type="button"
            >
              {isSidebarCollapsed ? '>' : '<'}
            </button>
          </div>
          <div className="chat-user-info">
            <div>
              <div className="user-name">
                {user.fname} {user.lname}
              </div>
            </div>
            <button className="btn-logout" onClick={handleLogout}>
              Logout
            </button>
          </div>

          <div className="mode-toggle">
            <button
              className={`mode-button ${mode === 'ask' ? 'active' : ''}`}
              onClick={() => setMode('ask')}
            >
              Ask
            </button>
            <button
              className={`mode-button ${mode === 'roadmap' ? 'active' : ''}`}
              disabled
            >
              Roadmap
            </button>
          </div>
        </div>

        <div 
          className="conversations-list" 
          ref={conversationsRef}
          onScroll={handleConversationsScroll}
        >
          <div style={{ padding: '0.5rem 0.5rem 0' }}>
            <button
              onClick={startNewConversation}
              className="btn-new-conversation"
            >
              + New Conversation
            </button>
          </div>

          {conversations.map((conv) => (
            <div
              key={conv.id}
              className={`conversation-item ${
                currentConversationId === conv.id ? 'active' : ''
              }`}
              onClick={() => loadConversationMessages(conv.id)}
            >
              <div className="conversation-title">
                {conv.attributes.title || 'New Conversation'}
              </div>
            </div>
          ))}

          {conversationsLoading && <ConversationSkeleton />}
        </div>
      </div>

      {/* Main Chat */}
      <div className="chat-main">
        <div className="mobile-chat-header">
          <button
            type="button"
            className="btn-mobile-menu"
            onClick={() => setIsMobileSidebarOpen(true)}
            aria-label="Open conversations"
          >
            Menu
          </button>
          <div className="mobile-chat-title">FroggyTalk</div>
        </div>

        <div className="messages-container">
          {messagesLoading ? (
            <>
              <MessageSkeleton />
              <MessageSkeleton />
            </>
          ) : (
            messages.map((message) => (
              <div key={message.id} className={`message ${message.role}`}>
                <div className="message-content">
                  {message.content_blocks ? (
                    <ContentBlockRenderer blocks={message.content_blocks} />
                  ) : (
                    <>
                      {message.content}
                      {message.isStreaming && (
                        <span className="streaming-cursor" aria-hidden="true" />
                      )}
                    </>
                  )}
                </div>
                {message.sources && message.sources.length > 0 && (
                  <div className="message-tags">
                    {message.sources.map((source, idx) => (
                      <span key={idx} className="source-tag">
                        📚 {source}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="chat-input-container">
          <form onSubmit={handleSendMessage} className="chat-input-wrapper">
            <textarea
              className="chat-input"
              placeholder="Type your message..."
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage(e as any);
                }
              }}
              rows={1}
              disabled={isSending}
            />
            <button 
              type="submit" 
              className="btn-send"
              disabled={isSending || !inputMessage.trim()}
            >
              {isSending ? 'Sending...' : 'Send'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
