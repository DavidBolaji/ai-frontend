import { useState, useEffect, useRef, FormEvent } from 'react';
import { useRouter } from 'next/router';
import { apiClient } from '@/lib/api-client';
import { ContentBlockRenderer } from '@/components/ContentBlockRenderer';
import { MessageSkeleton, ConversationSkeleton } from '@/components/Skeleton';
import type { 
  Conversation, 
  Message, 
  ContentBlock,
  AskResponse,
  OnboardingQuestion,
} from '@/lib/types';

type Mode = 'ask' | 'roadmap';

interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  content_blocks?: ContentBlock[];
  sources?: string[];
  isStreaming?: boolean;
  isThinking?: boolean;
}

const SOURCE_TAG_CACHE_KEY = 'sourceTagCacheByConversation';

type SourceTagCache = Record<string, Record<string, string[]>>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function PaperPlaneIcon() {
  return (
    <svg
      viewBox="0 0 512 512"
      width="15"
      height="15"
      fill="currentColor"
      aria-hidden="true"
      style={{ transform: 'rotate(45deg)', display: 'block', flexShrink: 0 }}
    >
      <path d="M498.1 5.6c10.1 7 15.4 19.1 13.5 31.2l-64 416c-1.5 9.7-7.4 18.2-16 23s-18.9 5.4-28 1.6L284 427.7l-68.5 74.1c-8.9 9.7-22.9 12.9-35.2 8.1S160 493.2 160 480V396.4c0-4 1.5-7.9 4.2-10.8L331.8 202.8c5.8-6.3 5.6-16-.4-22s-15.7-6.4-22-.7L106 360.8 17.7 316.6C7.1 311.3 .3 300.7 0 288.9s5.9-22.8 16.1-28.7l448-256c10.7-6.1 23.9-5.5 34 1.4z"/>
    </svg>
  );
}

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
  const [sendError, setSendError] = useState<string | null>(null);
  const chatFormRef = useRef<HTMLFormElement>(null);

  // Roadmap onboarding state
  const [onboardingQuestion, setOnboardingQuestion] = useState<OnboardingQuestion | null>(null);
  const [onboardingAnswers, setOnboardingAnswers] = useState<Record<string, string>>({});
  const onboardingAnswersRef = useRef<Record<string, string>>({});
  const [onboardingActive, setOnboardingActive] = useState(false);
  const [onboardingSubmitting, setOnboardingSubmitting] = useState(false);
  const [onboardingProgress, setOnboardingProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const [onboardingRestartPrompt, setOnboardingRestartPrompt] = useState(false);
  const [roadmapCreating, setRoadmapCreating] = useState(false);
  const [roadmapProgress, setRoadmapProgress] = useState<number>(0);
  const [roadmapProgressMessage, setRoadmapProgressMessage] = useState<string>('Preparing your roadmap...');

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

  const extractSourcesFromRagSources = (ragSources?: AskResponse['attributes']['rag_sources']): string[] => {
    if (!ragSources || ragSources.length === 0) {
      return [];
    }

    const categories = ragSources
      .map((source) => {
        if (source?.category) {
          return String(source.category);
        }

        if (source?.filename) {
          return String(source.filename).replace(/\.[^/.]+$/, '');
        }

        if (source?.title) {
          return String(source.title);
        }

        return undefined;
      })
      .filter(Boolean) as string[];

    return Array.from(new Set(categories));
  };

  const handleSendMessage = async (e: FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() || isSending) return;

    // If onboarding is active and current question is open type, handle as onboarding answer
    if (onboardingActive && onboardingQuestion) {
      if (onboardingQuestion.type === 'open') {
        const answer = inputMessage.trim();
        setInputMessage('');
        handleOnboardingAnswer(answer);
        return;
      }
    }

    const userMessage = inputMessage.trim();
    setInputMessage('');
    setSendError(null);
    setIsSending(true);

    // Add user message immediately
    const tempUserMsg: DisplayMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: userMessage,
    };
    setMessages(prev => [...prev, tempUserMsg]);

    const thinkingId = `thinking-${Date.now()}`;
    setMessages(prev => [
      ...prev,
      { id: thinkingId, role: 'assistant', content: '', isThinking: true },
    ]);

    try {
      const response: AskResponse = await apiClient.ask({
        message: userMessage,
        conversation_id: currentConversationId || undefined,
      });

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
          const extractedFromRagSources = extractSourcesFromRagSources(response.attributes.rag_sources);
          if (extractedFromRagSources.length > 0) {
            return extractedFromRagSources;
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

      setMessages(prev => prev.map(m => m.id === thinkingId ? assistantMsg : m));
    } catch (error) {
      console.error('Failed to send message:', error);
      // Remove optimistic messages on error
      setMessages(prev => prev.filter(m => m.id !== tempUserMsg.id && m.id !== thinkingId));
      setInputMessage(userMessage);
      setSendError(getErrorMessage(error));
    } finally {
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

  const handleModeChange = async (newMode: Mode) => {
    setMode(newMode);
    if (newMode === 'roadmap') {
      // Check if user already has a roadmap
      try {
        await apiClient.getRoadmap();
        // Roadmap exists → go straight to roadmap page
        router.push('/roadmap');
        return;
      } catch {
        // No roadmap yet → start conversational onboarding
      }

      setOnboardingActive(true);
      setOnboardingAnswers({});
      onboardingAnswersRef.current = {};
      setOnboardingQuestion(null);
      setRoadmapCreating(false);
      setOnboardingRestartPrompt(false);
      setMessages([]);

      // Load saved session from backend
      let initialAnswers: Record<string, string> = {};
      let sessionStatus: 'none' | 'in_progress' | 'closed' = 'none';
      try {
        const sessionResp = await apiClient.getOnboardingSession();
        initialAnswers = sessionResp.attributes.answers;
        sessionStatus = sessionResp.attributes.status;
      } catch { /* ignore — start fresh */ }

      // Previously-closed session: show goodbye history + restart prompt
      if (sessionStatus === 'closed') {
        setOnboardingActive(false);
        try {
          const [historyResp, nextResp] = await Promise.all([
            apiClient.getOnboardingHistory(initialAnswers),
            apiClient.getNextOnboardingQuestion(initialAnswers),
          ]);
          const historyMessages: DisplayMessage[] = [];
          for (const item of historyResp.attributes.history) {
            historyMessages.push({
              id: `resume-q-${item.key}`,
              role: 'assistant',
              content: item.question,
              content_blocks: [{ type: 'text', content: item.question }],
            });
            historyMessages.push({ id: `resume-a-${item.key}`, role: 'user', content: item.answer });
          }
          // Show the exit message itself
          const exitQ = nextResp.attributes.question;
          if (exitQ) {
            historyMessages.push({
              id: `onboarding-q-${exitQ.key}`,
              role: 'assistant',
              content: exitQ.question,
              content_blocks: exitQ.content_blocks || [{ type: 'text', content: exitQ.question }],
            });
          }
          // Restart prompt — message comes from backend exit question metadata
          const restartText = exitQ?.metadata?.restart_prompt as string | undefined;
          if (restartText) {
            historyMessages.push({
              id: 'onboarding-restart-prompt',
              role: 'assistant',
              content: restartText,
              content_blocks: [{ type: 'text', content: restartText }],
            });
          }
          setMessages(historyMessages);
        } catch {
          // History fetch failed — clear session and start fresh silently
          try { await apiClient.deleteOnboardingSession(); } catch { /* ignore */ }
          setOnboardingRestartPrompt(false);
          setOnboardingActive(true);
          // fall through to the normal fresh-start flow below
          return;
        }
        setOnboardingRestartPrompt(true);
        return;
      }

      const isResume = sessionStatus === 'in_progress';
      if (isResume) {
        setOnboardingAnswers(initialAnswers);
        onboardingAnswersRef.current = initialAnswers;
      }

      try {
        // For resume: fetch history + next question in parallel
        const [historyResp, resp] = isResume
          ? await Promise.all([
              apiClient.getOnboardingHistory(initialAnswers),
              apiClient.getNextOnboardingQuestion(initialAnswers),
            ])
          : [null, await apiClient.getNextOnboardingQuestion(initialAnswers)];

        const q = resp.attributes.question;
        const progress = resp.attributes.progress;

        setOnboardingProgress({ current: progress.current_index + 1, total: progress.total_questions });

        if (q) {
          setOnboardingQuestion(q);

          if (isResume && historyResp && historyResp.attributes.history.length > 0) {
            // Rebuild the full conversation from saved Q&A pairs + current question
            const historyMessages: DisplayMessage[] = [];
            for (const item of historyResp.attributes.history) {
              historyMessages.push({
                id: `resume-q-${item.key}`,
                role: 'assistant',
                content: item.question,
                content_blocks: [{ type: 'text', content: item.question }],
              });
              historyMessages.push({
                id: `resume-a-${item.key}`,
                role: 'user',
                content: item.answer,
              });
            }
            // Append the current (unanswered) question at the end
            historyMessages.push({
              id: `onboarding-q-${q.key}`,
              role: 'assistant',
              content: q.question,
              content_blocks: q.content_blocks || [{ type: 'text', content: q.question }],
            });
            setMessages(historyMessages);
          } else {
            setMessages([
              {
                id: `onboarding-q-${progress.current_index}`,
                role: 'assistant',
                content: q.question,
                content_blocks: q.content_blocks || [{ type: 'text', content: q.question }],
              },
            ]);
          }
        }
      } catch (error) {
        console.error('Failed to load onboarding:', error);
        setMessages([{
          id: 'onboarding-error',
          role: 'assistant',
          content: 'Failed to load onboarding questions. Please try again.',
          content_blocks: [{ type: 'text', content: 'Failed to load onboarding questions. Please try again.' }],
        }]);
        setOnboardingActive(false);
      }
    } else {
      // Switch back to ask mode
      setOnboardingActive(false);
      setOnboardingRestartPrompt(false);
      setOnboardingQuestion(null);
      setOnboardingAnswers({});
      onboardingAnswersRef.current = {};
      setOnboardingProgress({ current: 0, total: 0 });
      setRoadmapCreating(false);
      setMessages([]);
      loadWelcomeMessage();
    }
  };

  const finishOnboarding = async (answers: Record<string, string>) => {
    setRoadmapCreating(true);
    setRoadmapProgress(0);
    setRoadmapProgressMessage('Preparing your roadmap...');
    setOnboardingQuestion(null);

    try {
      await apiClient.completeOnboardingStream(answers, {
        onProgress: (pct, message) => {
          setRoadmapProgress(pct);
          setRoadmapProgressMessage(message);
        },
      });

      // Backend automatically clears the onboarding session on roadmap creation.
      // Keep showing the progress card and redirect immediately after completion.
      setRoadmapProgress(100);
      setRoadmapProgressMessage('Your roadmap is ready!');
      setTimeout(() => {
        router.push('/roadmap');
      }, 250);
    } catch (error) {
      console.error('Failed to create roadmap:', error);
      setRoadmapCreating(false);
      setMessages(prev => [...prev, {
        id: 'onboarding-error',
        role: 'assistant',
        content: 'Failed to create your roadmap. Please try again.',
        content_blocks: [{ type: 'text', content: 'Failed to create your roadmap. Please try again.' }],
      }]);
    }
  };

  /** Called when the user responds to the "start fresh?" restart prompt. */
  const handleRestartDecision = async (answer: 'yes' | 'no') => {
    setOnboardingRestartPrompt(false);
    if (answer === 'yes') {
      // Clear the closed session so onboarding starts from the first question
      try { await apiClient.deleteOnboardingSession(); } catch { /* ignore */ }
      setOnboardingActive(true);
      setOnboardingAnswers({});
      onboardingAnswersRef.current = {};
      setOnboardingQuestion(null);
      setRoadmapCreating(false);
      setMessages([]);
      try {
        const resp = await apiClient.getNextOnboardingQuestion({});
        const q = resp.attributes.question;
        const progress = resp.attributes.progress;
        setOnboardingProgress({ current: progress.current_index + 1, total: progress.total_questions });
        if (q) {
          setOnboardingQuestion(q);
          setMessages([{
            id: `onboarding-q-${progress.current_index}`,
            role: 'assistant',
            content: q.question,
            content_blocks: q.content_blocks || [{ type: 'text', content: q.question }],
          }]);
        }
      } catch {
        setOnboardingActive(false);
      }
    } else {
      // User declines restart → return to ask mode
      setOnboardingActive(false);
      setOnboardingQuestion(null);
      setOnboardingAnswers({});
      onboardingAnswersRef.current = {};
      setOnboardingProgress({ current: 0, total: 0 });
      setRoadmapCreating(false);
      setMessages([]);
      loadWelcomeMessage();
    }
  };

  const handleOnboardingAnswer = async (answer: string) => {
    if (!onboardingQuestion || onboardingSubmitting) return;

    const currentQ = onboardingQuestion;
    const questionKey = currentQ.key;

    // Add user answer to messages — suffix with timestamp to ensure uniqueness
    // when the same question key is re-asked (e.g. municipality_city after
    // postcode confirm "no").
    const msgTs = Date.now();
    setMessages(prev => [...prev, {
      id: `onboarding-a-${questionKey}-${msgTs}`,
      role: 'user',
      content: answer,
    }]);

    setOnboardingSubmitting(true);

    try {
      // Use ref (always fresh) instead of stale closure state
      const currentAnswers = onboardingAnswersRef.current;

      const resp = await apiClient.answerOnboardingQuestion(
        questionKey,
        answer,
        currentAnswers,
      );

      const { question: nextQ, progress } = resp.attributes;

      // Use backend's authoritative answered dict — it may have mutated keys
      // (e.g. resolved a postcode, cleared fields on confirm "no").
      const updatedAnswers: Record<string, string> = progress.answered ?? { ...currentAnswers, [questionKey]: answer };
      setOnboardingAnswers(updatedAnswers);
      onboardingAnswersRef.current = updatedAnswers;
      // Progress is saved automatically by the backend answer endpoint
      setOnboardingProgress({ current: progress.current_index + 1, total: progress.total_questions });

      if (progress.is_complete) {
        await finishOnboarding(updatedAnswers);
      } else if (nextQ) {
        if (nextQ.type === 'exit') {
          // Graceful close — show the goodbye message but do NOT create a roadmap
          setMessages(prev => [...prev, {
            id: `onboarding-q-${nextQ.key}-${Date.now()}`,
            role: 'assistant',
            content: nextQ.question,
            content_blocks: nextQ.content_blocks || [{ type: 'text', content: nextQ.question }],
          }]);
          // Remove the saved session since the user is closing onboarding
          try { await apiClient.deleteOnboardingSession(); } catch { /* ignore */ }
          setOnboardingQuestion(null);
          setOnboardingActive(false);
          setOnboardingAnswers({});
          onboardingAnswersRef.current = {};
        } else {
          setOnboardingQuestion(nextQ);

          // Handle 'info' type questions — show progress card and complete roadmap
          if (nextQ.type === 'info') {
            // Include the info answer directly, skip the round-trip
            const finalAnswers = { ...updatedAnswers, [nextQ.key]: 'acknowledged' };
            setOnboardingAnswers(finalAnswers);
            onboardingAnswersRef.current = finalAnswers;
            await finishOnboarding(finalAnswers);
          } else {
            setMessages(prev => [...prev, {
              id: `onboarding-q-${nextQ.key}-${Date.now()}`,
              role: 'assistant',
              content: nextQ.question,
              content_blocks: nextQ.content_blocks || [{ type: 'text', content: nextQ.question }],
            }]);
          }
        }
      }
    } catch (error: any) {
      // Handle validation errors from the backend
      // Backend may return { errors: [{ detail }] } (normalized) or 
      // { type: "onboarding-validation-error", attributes: { error } } (raw 422)
      const validationError =
        error?.errors?.[0]?.detail ||
        error?.attributes?.error ||
        (error?.type === 'onboarding-validation-error' && error?.attributes?.error);
      if (validationError && validationError !== 'Unprocessable Entity') {
        setMessages(prev => [...prev, {
          id: `onboarding-validation-${Date.now()}`,
          role: 'assistant',
          content: validationError,
          content_blocks: [{ type: 'text', content: validationError }],
        }]);
      } else {
        console.error('Failed during onboarding:', error);
        setMessages(prev => [...prev, {
          id: `onboarding-error-${Date.now()}`,
          role: 'assistant',
          content: 'Something went wrong. Please try again.',
          content_blocks: [{ type: 'text', content: 'Something went wrong. Please try again.' }],
        }]);
      }
    } finally {
      setOnboardingSubmitting(false);
    }
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
                  {message.isThinking ? (
                    <span className="thinking-dots" aria-label="Thinking">
                      <span /><span /><span />
                    </span>
                  ) : message.content_blocks ? (
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

          {/* Roadmap creation progress card */}
          {roadmapCreating && (
            <div className="roadmap-creating-card">

              <div className="roadmap-creating-subtitle">{roadmapProgressMessage}</div>
              <div className="roadmap-creating-bar-container">
                <div
                  className="roadmap-creating-bar"
                  style={{ width: `${roadmapProgress}%` }}
                />
              </div>
              <div className="roadmap-creating-pct">{roadmapProgress}%</div>
            </div>
          )}

          {/* Restart prompt buttons — shown when session was previously closed */}
          {onboardingRestartPrompt && !onboardingActive && (
            <div className="onboarding-options-wrap">
              <div className="onboarding-options">
                <button className="onboarding-option-btn" onClick={() => handleRestartDecision('yes')}>Yes, start fresh</button>
                <button className="onboarding-option-btn" onClick={() => handleRestartDecision('no')}>No, thanks</button>
              </div>
            </div>
          )}

          {/* Onboarding option buttons — directly under the question */}
          {onboardingActive && !roadmapCreating && onboardingQuestion && (() => {
            if (onboardingQuestion.type === 'yes_no') {
              return (
                <div className="onboarding-options-wrap">
                  <div className="onboarding-options">
                    <button className="onboarding-option-btn" onClick={() => handleOnboardingAnswer('yes')} disabled={onboardingSubmitting}>Yes</button>
                    <button className="onboarding-option-btn" onClick={() => handleOnboardingAnswer('no')} disabled={onboardingSubmitting}>No</button>
                  </div>
                </div>
              );
            }
            if ((onboardingQuestion.type === 'single_choice' || onboardingQuestion.type === 'multi_choice') && onboardingQuestion.options) {
              return (
                <div className="onboarding-options-wrap">
                  <div className="onboarding-options">
                    {onboardingQuestion.options.map((opt) => (
                      <button key={opt.value} className="onboarding-option-btn" onClick={() => handleOnboardingAnswer(opt.value)} disabled={onboardingSubmitting}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            }
            return null;
          })()}

          {/* Onboarding progress indicator */}
          {onboardingActive && !roadmapCreating && onboardingProgress.total > 0 && (
            <div className="onboarding-progress">
              <span>Question {onboardingProgress.current} of {onboardingProgress.total}</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="chat-input-container">
          {/* Mode toggle above input */}
          <div className="input-mode-toggle">
            <button
              className={`mode-button ${mode === 'ask' ? 'active' : ''}`}
              onClick={() => handleModeChange('ask')}
            >
              Ask
            </button>
            <button
              className={`mode-button ${mode === 'roadmap' ? 'active' : ''}`}
              onClick={() => handleModeChange('roadmap')}
            >
              Roadmap
            </button>
          </div>
          {sendError && (
            <div className="submit-error-banner">
              <span>{sendError}</span>
              <button
                type="button"
                className="submit-error-retry"
                onClick={() => { setSendError(null); chatFormRef.current?.requestSubmit(); }}
              >
                Try again
              </button>
            </div>
          )}
          <form ref={chatFormRef} onSubmit={handleSendMessage} className="chat-input-wrapper">
            <textarea
              className="chat-input"
              placeholder={onboardingActive && onboardingQuestion?.metadata?.hint
                ? onboardingQuestion.metadata.hint
                : onboardingActive ? 'Choose above...' : 'Type a message...'}
              value={inputMessage}
              onChange={(e) => { setSendError(null); setInputMessage(e.target.value); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage(e as any);
                }
              }}
              rows={1}
              disabled={isSending || onboardingSubmitting || (onboardingActive && onboardingQuestion?.type !== 'open')}
              readOnly={onboardingActive && onboardingQuestion?.type !== 'open'}
            />
            <button 
              type="submit" 
              className="btn-send"
              disabled={isSending || onboardingSubmitting || !inputMessage.trim() || (onboardingActive && onboardingQuestion?.type !== 'open')}
            >
              <span className="btn-send-icon"><PaperPlaneIcon /></span>
              <span className="btn-send-label">{isSending || onboardingSubmitting ? 'Sending...' : 'Send'}</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
