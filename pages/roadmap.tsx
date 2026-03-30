import { useState, useEffect, useRef, FormEvent } from 'react';
import { useRouter } from 'next/router';
import { apiClient } from '@/lib/api-client';
import { ContentBlockRenderer } from '@/components/ContentBlockRenderer';
import { MessageSkeleton } from '@/components/Skeleton';
import type {
  RoadmapCategoryOverview,
  RoadmapStepDetail,
  ContentBlock,
} from '@/lib/types';

const CATEGORY_LABELS: Record<string, string> = {
  municipality: 'Municipality',
  health: 'Health',
  housing: 'Housing',
  language: 'Language',
  social: 'Sports',
  african_diaspora: 'African Diaspora',
  transportation: 'Transportation',
  education: 'Schooling',
  permanent_residency: 'Permanent Residency',
  job: 'Job & Employment',
};

const CATEGORY_ICONS: Record<string, string> = {
  municipality: '🏛️',
  health: '🏥',
  housing: '🏠',
  language: '🗣️',
  social: '⚽',
  african_diaspora: '🌍',
  transportation: '🚌',
  education: '📚',
  permanent_residency: '📋',
  job: '💼',
};

// category key → keys it depends on (must all be completed to unlock)
const CATEGORY_DEPENDENCIES: Record<string, string[]> = {
  health: ['municipality'],
  housing: ['municipality'],
  job: ['municipality'],
  education: ['municipality'],
  permanent_residency: ['municipality', 'language'],
};

const STATUS_COLORS: Record<string, string> = {
  locked: '#9ca3af',
  not_started: '#6b7280',
  in_progress: '#f59e0b',
  completed: '#10b981',
};

const sortCategoriesStable = (cats: RoadmapCategoryOverview[]): RoadmapCategoryOverview[] => {
  return [...cats].sort((a, b) => {
    const ai = Number.isFinite(a.sequence_no) ? a.sequence_no : Number.MAX_SAFE_INTEGER;
    const bi = Number.isFinite(b.sequence_no) ? b.sequence_no : Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return a.category.localeCompare(b.category);
  });
};

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

interface StepChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  content_blocks?: ContentBlock[];
}

export default function Roadmap() {
  const router = useRouter();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auth
  const [user, setUser] = useState<any>(null);

  // Roadmap data
  const [categories, setCategories] = useState<RoadmapCategoryOverview[]>([]);
  const [overallProgress, setOverallProgress] = useState(0);
  const [roadmapLoading, setRoadmapLoading] = useState(true);

  // Selected category
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedCategoryName, setSelectedCategoryName] = useState('');

  // Monotonically increasing counter — each selectCategory call increments it.
  // After any await, we check the counter still matches; if not, the response
  // is stale (a newer selectCategory call has started) and we discard it.
  const categoryLoadGenRef = useRef(0);

  // Steps
  const [steps, setSteps] = useState<RoadmapStepDetail[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [stepsLoading, setStepsLoading] = useState(false);

  // Step chat
  const [chatMessages, setChatMessages] = useState<StepChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);

  // Input
  const [inputMessage, setInputMessage] = useState('');
  const [isSending, setIsSending] = useState(false);

  // Local answer selections (step id → selected value) — lets users pick before submitting
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>({});

  // Sidebar — desktop starts expanded, mobile always shows icon rail (CSS-driven)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // "Not open" tap notice for non-open steps
  const [showNotOpenNotice, setShowNotOpenNotice] = useState(false);
  const notOpenNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Submit error + retry
  const [submitError, setSubmitError] = useState<string | null>(null);
  const lastFailedAnswerRef = useRef<string>('');

  // Checklist selections (step id → set of selected values)
  const [checklistSelections, setChecklistSelections] = useState<Record<string, Set<string>>>({});

  // BSN gate state (municipality Step 5 only)
  const [bsnPromptVisible, setBsnPromptVisible] = useState(false);
  const [bsnFrozen, setBsnFrozen] = useState(false);
  const [bsnGateMessage, setBsnGateMessage] = useState<string | null>(null);
  const [bsnCountdownSec, setBsnCountdownSec] = useState<number | null>(null);
  const bsnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bsnCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Category completed banner
  const [categoryCompletedBanner, setCategoryCompletedBanner] = useState<{
    label: string;
    icon: string;
  } | null>(null);

  // Initialize
  useEffect(() => {
    if (!apiClient.isAuthenticated()) {
      router.replace('/login');
      return;
    }

    const userData = apiClient.getUser();
    setUser(userData);

    loadRoadmap();
  }, [router]);

  // Auto-scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Pre-fill input for open questions when navigating to a step
  useEffect(() => {
    const step = steps[currentStepIndex];
    if (!step) return;
    if (step.question_type === 'open') {
      const localAnswer = selectedAnswers[step.id];
      setInputMessage(localAnswer || step.answer || '');
    } else {
      setInputMessage('');
    }

    // Pre-populate checklist selections from saved answer when revisiting a completed multi_choice step
    if (step.question_type === 'multi_choice' && step.metadata_?.input_mode === 'checklist' && step.answer && step.answer !== 'none') {
      setChecklistSelections(prev => {
        if (prev[step.id] && prev[step.id].size > 0) return prev; // already populated
        const saved = new Set(step.answer!.split(',').map(v => v.trim()).filter(Boolean));
        return { ...prev, [step.id]: saved };
      });
    }

    // Reset BSN gate UI when navigating off step 5
    if (step.question_key !== 'post_registration_info') {
      if (bsnTimerRef.current) clearTimeout(bsnTimerRef.current);
      if (bsnCountdownRef.current) clearInterval(bsnCountdownRef.current);
      setBsnPromptVisible(false);
      setBsnFrozen(false);
      setBsnGateMessage(null);
      setBsnCountdownSec(null);
    }
  }, [currentStepIndex, steps]);

  // BSN timer: driven by server-side first_viewed_at — survives page refresh / re-navigation
  useEffect(() => {
    if (bsnTimerRef.current) clearTimeout(bsnTimerRef.current);
    if (bsnCountdownRef.current) clearInterval(bsnCountdownRef.current);

    const step = steps[currentStepIndex];
    if (!step || step.question_key !== 'post_registration_info') return;
    if (step.answer === 'bsn_received') return;

    const meta = step.metadata_ as any;
    // Server already confirmed the delay has elapsed
    if (meta?.bsn_gate_ready) {
      setBsnPromptVisible(true);
      setBsnCountdownSec(null);
      return;
    }
    // Compute remaining time from absolute server timestamp
    if (meta?.bsn_gate_opens_at) {
      const opensAt = new Date(meta.bsn_gate_opens_at).getTime();
      const remaining = opensAt - Date.now();
      if (remaining <= 0) {
        setBsnPromptVisible(true);
        setBsnCountdownSec(null);
      } else {
        setBsnCountdownSec(Math.ceil(remaining / 1000));
        bsnCountdownRef.current = setInterval(() => {
          const left = Math.ceil((opensAt - Date.now()) / 1000);
          if (left <= 0) {
            if (bsnCountdownRef.current) clearInterval(bsnCountdownRef.current);
            setBsnCountdownSec(null);
            setBsnPromptVisible(true);
          } else {
            setBsnCountdownSec(left);
          }
        }, 1000);
        bsnTimerRef.current = setTimeout(() => {
          if (bsnCountdownRef.current) clearInterval(bsnCountdownRef.current);
          setBsnCountdownSec(null);
          setBsnPromptVisible(true);
        }, remaining);
      }
    }

    return () => {
      if (bsnTimerRef.current) clearTimeout(bsnTimerRef.current);
      if (bsnCountdownRef.current) clearInterval(bsnCountdownRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStepIndex, steps]);

  const reloadCategoriesData = async (): Promise<RoadmapCategoryOverview[]> => {
    const roadmap = await apiClient.getRoadmap();
    const cats = sortCategoriesStable(roadmap.attributes.categories);
    setCategories(cats);
    setOverallProgress(roadmap.attributes.overall_progress_pct);
    return cats;
  };

  const loadRoadmap = async () => {
    setRoadmapLoading(true);
    try {
      const cats = await reloadCategoriesData();

      // Default to municipality or first available category
      const municipality = cats.find(c => c.category === 'municipality');
      const defaultCat = municipality || cats[0];

      if (defaultCat) {
        await selectCategory(defaultCat.id, defaultCat.category);
      }
    } catch (error) {
      console.error('Failed to load roadmap:', error);
      // No roadmap → redirect to chat for onboarding
      router.replace('/chat');
    } finally {
      setRoadmapLoading(false);
    }
  };

  const selectCategory = async (categoryId: string, categoryName: string) => {
    // Claim this load generation — any earlier in-flight calls become stale.
    const gen = ++categoryLoadGenRef.current;

    // Clear BSN timer and gate state when switching categories
    if (bsnTimerRef.current) clearTimeout(bsnTimerRef.current);
    setBsnPromptVisible(false);
    setBsnFrozen(false);
    setBsnGateMessage(null);

    setSelectedCategoryId(categoryId);
    setSelectedCategoryName(categoryName);
    setStepsLoading(true);
    setChatMessages([]);
    setCurrentStepIndex(0);

    try {
      const detail = await apiClient.getCategoryDetail(categoryId);

      // Discard if a newer selectCategory call has already started.
      if (gen !== categoryLoadGenRef.current) return;

      const loadedSteps = detail.attributes.steps;
      setSteps(loadedSteps);

      // Find the first active/pending step to start at
      const activeIdx = loadedSteps.findIndex(s => s.status === 'active');
      const pendingIdx = loadedSteps.findIndex(s => s.status === 'pending');
      const startIdx = activeIdx >= 0 ? activeIdx : (pendingIdx >= 0 ? pendingIdx : 0);
      setCurrentStepIndex(startIdx);

      // Load chat history for the starting step
      if (loadedSteps[startIdx]) {
        loadStepChat(loadedSteps[startIdx].id);
      }
    } catch (error) {
      if (gen === categoryLoadGenRef.current) {
        console.error('Failed to load category:', error);
      }
    } finally {
      if (gen === categoryLoadGenRef.current) {
        setStepsLoading(false);
      }
    }
  };

  const loadStepChat = async (stepId: string) => {
    setChatLoading(true);
    try {
      const history = await apiClient.getStepChatHistory(stepId);
      const msgs: StepChatMessage[] = history.attributes.messages.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        content_blocks: [{ type: 'text' as const, content: m.content }],
      }));
      setChatMessages(msgs);
    } catch {
      // No chat history yet — that's fine
      setChatMessages([]);
    } finally {
      setChatLoading(false);
    }
  };

  const selectOption = (stepId: string, value: string) => {
    setSelectedAnswers(prev => ({ ...prev, [stepId]: value }));
    // Auto-advance for yes_no and single_choice — fire answer immediately
    const step = steps[currentStepIndex];
    if (step && step.id === stepId && !isSending) {
      if (step.question_type === 'yes_no' || step.question_type === 'single_choice') {
        // Small tick so state update flushes before handleAnswerStep reads it
        setTimeout(() => handleAnswerStep(value), 0);
      }
    }
  };

  const getSelectedAnswer = (stepId: string): string | undefined => {
    return selectedAnswers[stepId];
  };

  const normalizeTypedAnswerForStep = (step: RoadmapStepDetail, raw: string): string => {
    const typed = raw.trim();
    if (!typed) {
      return typed;
    }

    if (step.question_type === 'yes_no') {
      const lower = typed.toLowerCase();
      if (lower === 'y' || lower === 'yes') return 'yes';
      if (lower === 'n' || lower === 'no') return 'no';
      return typed;
    }

    if ((step.question_type === 'single_choice' || step.question_type === 'multi_choice') && step.options) {
      const lower = typed.toLowerCase();
      const exactValue = step.options.find((opt) => opt.value.toLowerCase() === lower);
      if (exactValue) {
        return exactValue.value;
      }

      const exactLabel = step.options.find((opt) => opt.label.toLowerCase() === lower);
      if (exactLabel) {
        return exactLabel.value;
      }
    }

    return typed;
  };

  const goToStep = async (index: number) => {
    if (index < 0 || index > steps.length) return;

    // Allow clicking Next on the last step to submit it.
    // `index === steps.length` is a submit-only sentinel, not a real step index.
    if (index === steps.length && currentStepIndex !== steps.length - 1) return;

    // When moving forward, submit selected answer if the current step needs it
    if (index > currentStepIndex) {
      const current = steps[currentStepIndex];
      if (current && current.status !== 'completed') {
        const q = current.question_type;
        if (q === 'info') {
          // Info steps don't require answers — auto-acknowledge
          await handleAnswerStep('acknowledged');
          return;
        } else if (q === 'open') {
          const openAnswer = getSelectedAnswer(current.id) || inputMessage.trim();
          if (!openAnswer) {
            alert('Please type your answer before moving to the next step.');
            return;
          }
          await handleAnswerStep(openAnswer);
          return;
        } else {
          const selected = getSelectedAnswer(current.id);
          if (!selected) {
            alert('Please select an answer before moving to the next step.');
            return;
          }
          await handleAnswerStep(selected);
          return;
        }
      }
      // If completed but user changed their selection, re-submit
      const current2 = steps[currentStepIndex];
      if (current2 && current2.status === 'completed') {
        const selected = getSelectedAnswer(current2.id);
        if (selected && selected !== current2.answer) {
          await handleAnswerStep(selected);
          return;
        }
      }
    }

    // Last-step submit path: answer was handled above, do not navigate out of bounds.
    if (index === steps.length) return;

    setCurrentStepIndex(index);
    setInputMessage('');
    setChatMessages([]);
    loadStepChat(steps[index].id);
  };

  const handleAnswerStep = async (answer: string) => {
    const step = steps[currentStepIndex];
    if (!step) return;

    lastFailedAnswerRef.current = answer;
    setSubmitError(null);
    setIsSending(true);
    try {
      const resp = await apiClient.answerStep(step.id, answer);
      const { completed_step, next_step, new_steps_added, reset_steps, deleted_step_ids, category_progress_pct, category_completed_steps, category_completed, routed_to_chat, chat_response, validation_error, gate_blocked, gate_message } = resp.attributes;

      // BSN gate: blocked answer — show gate message inline, stay on step
      if (gate_blocked) {
        if (answer === 'bsn_not_yet') {
          setBsnFrozen(true);
        }
        setBsnGateMessage(gate_message || 'Please confirm your BSN status.');
        setIsSending(false);
        return;
      }

      // If the answer failed data validation (e.g. invalid municipality),
      // show a helpful message and let the user correct their input.
      if (validation_error) {
        setChatMessages(prev => [
          ...prev,
          { id: `user-${Date.now()}`, role: 'user', content: answer },
          {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: validation_error,
          },
        ]);
        setInputMessage('');
        setIsSending(false);
        return;
      }

      // If the backend determined this wasn't a valid answer, show as chat
      // and let the user re-try — keep the step active.
      if (routed_to_chat && chat_response) {
        setChatMessages(prev => [
          ...prev,
          { id: `user-${Date.now()}`, role: 'user', content: answer },
          {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: chat_response.content,
            content_blocks: chat_response.content_blocks.length > 0 ? chat_response.content_blocks : undefined,
          },
        ]);
        setInputMessage('');
        setIsSending(false);
        return;
      }

      // Update steps list with completed step, reset subsequent steps, and any new branch steps
      setSteps(prev => {
        let updated = prev.map(s => s.id === completed_step.id ? completed_step : s);

        // Remove deleted branch steps (re-answer scenario)
        if (deleted_step_ids && deleted_step_ids.length > 0) {
          const deletedSet = new Set(deleted_step_ids);
          updated = updated.filter(s => !deletedSet.has(s.id));
        }

        // Apply reset steps: replace each reset step in the list
        if (reset_steps && reset_steps.length > 0) {
          const resetMap = new Map(reset_steps.map(rs => [rs.id, rs]));
          updated = updated.map(s => resetMap.has(s.id) ? resetMap.get(s.id)! : s);
          // Clear selectedAnswers for reset steps
          setSelectedAnswers(prev => {
            const next = { ...prev };
            reset_steps.forEach(rs => { delete next[rs.id]; });
            return next;
          });
        }

        // Insert new branch steps after the completed step
        if (new_steps_added.length > 0) {
          const completedIdx = updated.findIndex(s => s.id === completed_step.id);
          updated = [
            ...updated.slice(0, completedIdx + 1),
            ...new_steps_added,
            ...updated.slice(completedIdx + 1),
          ];
        }

        // Update next step if present
        if (next_step) {
          updated = updated.map(s => s.id === next_step.id ? next_step : s);
        }

        return updated;
      });

      // Update category progress in sidebar
      setCategories(prev => prev.map(c =>
        c.id === selectedCategoryId
          ? { ...c, progress_pct: category_progress_pct, status: category_completed ? 'completed' : 'in_progress', completed_steps: category_completed_steps ?? Math.round((category_progress_pct / 100) * c.total_steps) }
          : c
      ));

      // Move to next step
      if (next_step) {
        // Find the index of next_step in the updated steps
        let withNewSteps = steps.map(s => s.id === completed_step.id ? completed_step : s);
        // Remove deleted branch steps
        if (deleted_step_ids && deleted_step_ids.length > 0) {
          const deletedSet = new Set(deleted_step_ids);
          withNewSteps = withNewSteps.filter(s => !deletedSet.has(s.id));
        }
        // Apply reset steps
        if (reset_steps && reset_steps.length > 0) {
          const resetMap = new Map(reset_steps.map(rs => [rs.id, rs]));
          withNewSteps = withNewSteps.map(s => resetMap.has(s.id) ? resetMap.get(s.id)! : s);
        }
        if (new_steps_added.length > 0) {
          const completedIdx = withNewSteps.findIndex(s => s.id === completed_step.id);
          withNewSteps = [
            ...withNewSteps.slice(0, completedIdx + 1),
            ...new_steps_added,
            ...withNewSteps.slice(completedIdx + 1),
          ];
        }
        withNewSteps = withNewSteps.map(s => s.id === next_step.id ? next_step : s);
        const nextIdx = withNewSteps.findIndex(s => s.id === next_step.id);
        setSteps(withNewSteps);
        if (nextIdx >= 0) {
          setCurrentStepIndex(nextIdx);
          setChatMessages([]);
          loadStepChat(next_step.id);
        }
      }

      // If category completed, show banner and auto-navigate to next unlocked category
      if (category_completed) {
        const completedLabel = CATEGORY_LABELS[selectedCategoryName] || selectedCategoryName;
        const completedIcon = CATEGORY_ICONS[selectedCategoryName] || '📌';
        setCategoryCompletedBanner({ label: completedLabel, icon: completedIcon });
        try {
          const freshCats = await reloadCategoriesData();
          const currentCatIdx = freshCats.findIndex(c => c.id === selectedCategoryId);
          const nextCat = freshCats.slice(currentCatIdx + 1).find(c => c.status !== 'locked');
          setTimeout(() => {
            setCategoryCompletedBanner(null);
            if (nextCat) {
              selectCategory(nextCat.id, nextCat.category);
            }
          }, 2800);
        } catch {
          setTimeout(() => setCategoryCompletedBanner(null), 3000);
        }
      }
    } catch (error) {
      console.error('Failed to answer step:', error);
      setSubmitError('Failed to submit your answer. Please try again.');
    } finally {
      setIsSending(false);
    }
  };

  const handleSendMessage = async (e: FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() || isSending) return;

    const step = steps[currentStepIndex];
    if (!step) return;

    const message = inputMessage.trim();
    setInputMessage('');

    if (step.question_type === 'info') {
      await handleAnswerStep('acknowledged');
      return;
    }

    const normalizedAnswer = normalizeTypedAnswerForStep(step, message);
    selectOption(step.id, normalizedAnswer);
    await handleAnswerStep(normalizedAnswer);
  };

  const handleLogout = () => {
    apiClient.logout();
  };

  if (!user || roadmapLoading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
      }}>
        <div>Loading your roadmap...</div>
      </div>
    );
  }

  const currentStep = steps[currentStepIndex] || null;
  const currentStepBlocks =
    (currentStep?.content_blocks && currentStep.content_blocks.length > 0
      ? currentStep.content_blocks
      : (currentStep?.metadata_?.content_blocks as ContentBlock[] | undefined)) || [];

  return (
    <div className="chat-container roadmap-page">
      {/* Category Sidebar */}
      <div className={`chat-sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="chat-header">
          <div className="sidebar-top-row">
            <button
              className="btn-sidebar-toggle"
              onClick={() => setIsSidebarCollapsed((prev) => !prev)}
              aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              type="button"
            >
              {isSidebarCollapsed ? '›' : '‹'}
            </button>
          </div>
          <div className="chat-user-info">
            <div>
              <div className="user-name">{user.fname} {user.lname}</div>
            </div>
            <button className="btn-logout" onClick={handleLogout}>Logout</button>
          </div>

          <div className="roadmap-progress-header">
            <div className="roadmap-progress-label">Roadmap Progress</div>
            <div className="roadmap-progress-bar-container">
              <div className="roadmap-progress-bar" style={{ width: `${overallProgress}%` }} />
            </div>
            <div className="roadmap-progress-pct">{overallProgress}%</div>
          </div>
        </div>

        <div className="conversations-list">
          <div style={{ padding: '0.5rem 0.5rem 0' }}>
            <button onClick={() => router.push('/chat')} className="btn-new-conversation">
              ← Back to Chat
            </button>
          </div>

          {categories.map((cat) => (
            <div
              key={cat.id}
              title={CATEGORY_LABELS[cat.category] || cat.category}
              className={`conversation-item roadmap-category-item ${selectedCategoryId === cat.id ? 'active' : ''} ${cat.status === 'locked' ? 'locked' : ''}`}
              onClick={() => {
                selectCategory(cat.id, cat.category);
              }}
            >
              <div className="roadmap-category-row">
                <span className="roadmap-category-icon" style={{ position: 'relative' }}>
                  {CATEGORY_ICONS[cat.category] || '📌'}
                  <span
                    className="roadmap-status-dot roadmap-category-icon-badge"
                    style={{ background: STATUS_COLORS[cat.status] || '#6b7280' }}
                  />
                </span>
                <div className="roadmap-category-info">
                  <div className="conversation-title">{CATEGORY_LABELS[cat.category] || cat.category}</div>
                  <div className="roadmap-category-meta">
                    <span className="roadmap-category-status">
                      {`${cat.completed_steps}/${cat.total_steps} steps`}
                    </span>
                  </div>
                </div>
                <div className="roadmap-category-progress-mini">
                  <svg viewBox="0 0 36 36" className="roadmap-ring">
                    <path
                      className="roadmap-ring-bg"
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    />
                    <path
                      className="roadmap-ring-fill"
                      strokeDasharray={`${cat.progress_pct}, 100`}
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      style={{ stroke: STATUS_COLORS[cat.status] || '#6b7280' }}
                    />
                  </svg>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div className="chat-main">
        <div className="mobile-chat-header">
          <div className="mobile-chat-title">
            {CATEGORY_ICONS[selectedCategoryName]} {CATEGORY_LABELS[selectedCategoryName] || 'Roadmap'}
          </div>
        </div>

        {/* Step Navigation Header */}
        {steps.length > 0 && currentStep && (
          <div className="step-nav-header">
            <button
              className="step-nav-btn"
              onClick={() => goToStep(currentStepIndex - 1)}
              disabled={currentStepIndex === 0}
            >
              <span className="step-nav-arrow" aria-hidden="true">←</span>
              <span className="step-nav-label">Previous</span>
            </button>

            <div className="step-nav-info">
              <span className="step-nav-counter">
                Step {currentStepIndex + 1} / {steps.length}
              </span>
              <span className="step-nav-category">
                {CATEGORY_ICONS[selectedCategoryName]} {CATEGORY_LABELS[selectedCategoryName]}
              </span>
            </div>

            <button
              className="step-nav-btn"
              onClick={() => goToStep(currentStepIndex + 1)}
              disabled={isSending || steps.length === 0}
            >
              {currentStepIndex >= steps.length - 1
                ? (<><span className="step-nav-label">Submit</span><span className="step-nav-arrow" aria-hidden="true">→</span></>)
                : (<><span className="step-nav-label">Next</span><span className="step-nav-arrow" aria-hidden="true">→</span></>)
              }
            </button>
          </div>
        )}

        {/* Category Completed Banner */}
        {categoryCompletedBanner && (
          <div className="category-completed-banner">
            <span className="category-completed-icon">{categoryCompletedBanner.icon}</span>
            <div>
              <div className="category-completed-title">🎉 {categoryCompletedBanner.label} Complete!</div>
              <div className="category-completed-sub">Moving to your next category...</div>
            </div>
          </div>
        )}

        {/* Step Content */}
        <div className="messages-container">
          {stepsLoading ? (
            <>
              <MessageSkeleton />
              <MessageSkeleton />
            </>
          ) : currentStep ? (
            <>
              {/* Step question */}
              <div className="message assistant">
                <div className="message-content">
                  <div className="step-question-header">
                    <span className={`step-status-badge ${currentStep.status}`}>
                      {currentStep.status === 'completed' ? '✓' : currentStep.status === 'active' ? '●' : '○'}
                    </span>
                    <span className="step-question-type">{currentStep.question_type}</span>
                  </div>
                  {currentStep.metadata_?.title ? (
                    <h3 className="step-title">{currentStep.metadata_.title}</h3>
                  ) : null}
                  {currentStep.metadata_?.content ? (
                    <div
                      className="step-content-text"
                      style={
                        currentStepBlocks.length > 0
                          ? { marginTop: '0.5rem' }
                          : { whiteSpace: 'pre-line', marginTop: '0.5rem' }
                      }
                    >
                      {currentStepBlocks.length > 0 ? (
                        <ContentBlockRenderer blocks={currentStepBlocks} />
                      ) : (
                        currentStep.metadata_.content
                      )}
                    </div>
                  ) : (
                    <div className="step-question-text" style={
                      currentStepBlocks.length > 0
                        ? { marginTop: '0.5rem' }
                        : { whiteSpace: 'pre-line', marginTop: '0.5rem' }
                    }>
                      {currentStepBlocks.length > 0 ? (
                        <ContentBlockRenderer blocks={currentStepBlocks} />
                      ) : (
                        currentStep.question_text
                      )}
                    </div>
                  )}
                  {currentStep.metadata_ && currentStep.metadata_.help && (
                    <div className="step-help-text">{currentStep.metadata_.help}</div>
                  )}
                </div>
              </div>

              {/* BSN Gate for Step 5 (post_registration_info) */}
              {currentStep.question_type === 'info' && currentStep.question_key === 'post_registration_info' && currentStep.status !== 'completed' && (
                <div className="step-options-inline" style={{ flexDirection: 'column' }}>
                  {/* PDF download shortcut */}
                  <button
                    type="button"
                    className="onboarding-option-btn"
                    style={{ alignSelf: 'flex-start', marginBottom: '0.5rem', background: '#f0fdf4', color: '#15803d', border: '1px solid #86efac' }}
                    onClick={() => window.print()}
                  >
                    🖨️ Download / Print this guide as PDF
                  </button>
                  {bsnGateMessage && (
                    <div style={{ color: '#b45309', background: '#fffbeb', padding: '0.75rem', borderRadius: '0.5rem', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                      {bsnGateMessage}
                    </div>
                  )}
                  {!bsnPromptVisible && !bsnFrozen && (
                    <button className="onboarding-option-btn" disabled style={{ opacity: 0.5, cursor: 'not-allowed' }}>
                      {bsnCountdownSec !== null
                        ? `⏳ Checking your appointment status${bsnCountdownSec > 60 ? ` — ${Math.ceil(bsnCountdownSec / 60)}m remaining` : ` — ${bsnCountdownSec}s`}`
                        : '⏳ Waiting — confirm BSN when received...'}
                    </button>
                  )}
                  {bsnPromptVisible && !bsnFrozen && (
                    <>
                      <p style={{ marginBottom: '0.5rem', fontWeight: 500 }}>Have you received your BSN?</p>
                      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <button
                          className="onboarding-option-btn"
                          onClick={() => { setBsnGateMessage(null); handleAnswerStep('bsn_received'); }}
                          disabled={isSending}
                        >
                          ✅ Yes, I have my BSN
                        </button>
                        <button
                          className="onboarding-option-btn"
                          onClick={() => { setBsnGateMessage(null); handleAnswerStep('bsn_not_yet'); }}
                          disabled={isSending}
                        >
                          ⏳ Not yet
                        </button>
                      </div>
                    </>
                  )}
                  {bsnFrozen && (
                    <div style={{ color: '#6b7280', fontStyle: 'italic', padding: '0.5rem' }}>
                      🔒 You must have your BSN before continuing. Select &quot;Yes, I have my BSN&quot; once it arrives.
                      <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <button
                          className="onboarding-option-btn selected"
                          onClick={() => { setBsnFrozen(false); setBsnGateMessage(null); handleAnswerStep('bsn_received'); }}
                          disabled={isSending}
                        >
                          ✅ Yes, I have my BSN
                        </button>
                        <button className="onboarding-option-btn" disabled style={{ opacity: 0.5 }}>
                          ⏳ Not yet
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Acknowledge button for all other info steps (except BSN gate and summary steps) */}
              {currentStep.question_type === 'info' && currentStep.question_key !== 'post_registration_info' && !currentStep.metadata_?.is_summary && currentStep.status !== 'completed' && (
                <div className="step-options-inline">
                  <button
                    className="onboarding-option-btn"
                    onClick={() => handleAnswerStep('acknowledged')}
                    disabled={isSending}
                  >
                    Got it, continue →
                  </button>
                </div>
              )}

              {/* Print + continue for health/housing summary steps */}
              {currentStep.question_type === 'info' && currentStep.metadata_?.is_summary === true && currentStep.question_key !== 'post_registration_info' && currentStep.status !== 'completed' && (
                <div className="step-options-inline" style={{ flexDirection: 'column', gap: '0.5rem' }}>
                  <button
                    type="button"
                    className="onboarding-option-btn"
                    style={{ alignSelf: 'flex-start', background: '#f0fdf4', color: '#15803d', border: '1px solid #86efac' }}
                    onClick={() => window.print()}
                  >
                    🖨️ Download / Save as PDF
                  </button>
                  <button
                    className="onboarding-option-btn"
                    onClick={() => handleAnswerStep('acknowledged')}
                    disabled={isSending}
                  >
                    Got it, continue →
                  </button>
                </div>
              )}

              {/* Show saved open answer if completed */}
              {currentStep.question_type === 'open' && currentStep.answer && !getSelectedAnswer(currentStep.id) && (
                <div className="step-open-answer">
                  <span className="step-open-answer-label">Your answer:</span>
                  <span className="step-open-answer-text">{currentStep.answer}</span>
                </div>
              )}

              {/* Option buttons — always visible, toggle selection */}
              {currentStep.question_type === 'yes_no' && (
                <div className="step-options-inline">
                  {['yes', 'no'].map((val) => {
                    const isSelected = (getSelectedAnswer(currentStep.id) || currentStep.answer) === val;
                    return (
                      <button
                        key={val}
                        className={`onboarding-option-btn${isSelected ? ' selected' : ''}`}
                        onClick={() => selectOption(currentStep.id, val)}
                        disabled={isSending}
                      >
                        {val === 'yes' ? 'Yes' : 'No'}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Checklist render for multi_choice steps with input_mode=checklist */}
              {currentStep.question_type === 'multi_choice' && currentStep.metadata_?.input_mode === 'checklist' && currentStep.options && (
                <div className="step-options-inline" style={{ flexDirection: 'column', gap: '0.5rem' }}>
                  {currentStep.options.map((opt) => {
                    const savedSet = checklistSelections[currentStep.id] || new Set();
                    const isChecked = savedSet.has(opt.value);
                    return (
                      <label
                        key={opt.value}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', padding: '0.5rem 0.75rem', borderRadius: '0.5rem', background: isChecked ? '#f0fdf4' : 'transparent', border: '1px solid', borderColor: isChecked ? '#86efac' : '#e5e7eb' }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {
                            setChecklistSelections(prev => {
                              const existing = new Set(prev[currentStep.id] || []);
                              if (existing.has(opt.value)) existing.delete(opt.value);
                              else existing.add(opt.value);
                              return { ...prev, [currentStep.id]: new Set(existing) };
                            });
                          }}
                          disabled={isSending}
                          style={{ width: '1rem', height: '1rem', accentColor: '#16a34a', flexShrink: 0 }}
                        />
                        {opt.label}
                      </label>
                    );
                  })}
                  <button
                    className="onboarding-option-btn"
                    onClick={() => {
                      const selected = checklistSelections[currentStep.id];
                      const answer = selected && selected.size > 0 ? Array.from(selected).join(',') : 'none';
                      handleAnswerStep(answer);
                    }}
                    disabled={isSending}
                    style={{ marginTop: '0.75rem' }}
                  >
                    {currentStep.status === 'completed' ? 'Update →' : 'Continue →'}
                  </button>
                </div>
              )}

              {/* Option buttons for single_choice and non-checklist multi_choice */}
              {(currentStep.question_type === 'single_choice' || (currentStep.question_type === 'multi_choice' && currentStep.metadata_?.input_mode !== 'checklist')) && currentStep.options && (
                <div className="step-options-inline">
                  {currentStep.options.map((opt) => {
                    const isSelected = (getSelectedAnswer(currentStep.id) || currentStep.answer) === opt.value;
                    return (
                      <button
                        key={opt.value}
                        className={`onboarding-option-btn${isSelected ? ' selected' : ''}`}
                        onClick={() => selectOption(currentStep.id, opt.value)}
                        disabled={isSending}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Chat messages for this step */}
              {chatLoading ? (
                <MessageSkeleton />
              ) : (
                chatMessages.map((msg) => (
                  <div key={msg.id} className={`message ${msg.role}`}>
                    <div className="message-content">
                      {msg.content_blocks ? (
                        <ContentBlockRenderer blocks={msg.content_blocks} />
                      ) : (
                        msg.content
                      )}
                    </div>
                  </div>
                ))
              )}

              {/* Typing / fetching indicator */}
              {isSending && (
                <div className="message assistant">
                  <div className="typing-indicator">
                    <div className="typing-dots">
                      <span /><span /><span />
                    </div>
                    Fetching information…
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="message assistant">
              <div className="message-content">
                Select a category from the sidebar to begin.
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Chat Input */}
        <div className="chat-input-container">
          {/* Mode toggle */}
          <div className="input-mode-toggle">
            <button className="mode-button" onClick={() => router.push('/chat')}>Ask</button>
            <button className="mode-button active">Roadmap</button>
          </div>
          {showNotOpenNotice && (
            <div className="not-open-notice">
              This question has fixed options — use the buttons above to answer.
              To ask a free-form question, switch to the <strong>Ask</strong> tab.
            </div>
          )}
          {submitError && (
            <div className="submit-error-banner">
              <span>{submitError}</span>
              <button
                type="button"
                className="submit-error-retry"
                onClick={() => { setSubmitError(null); handleAnswerStep(lastFailedAnswerRef.current); }}
              >
                Try again
              </button>
            </div>
          )}
          <form onSubmit={handleSendMessage} className="chat-input-wrapper">
            <textarea
              className="chat-input"
              placeholder={currentStep && currentStep.question_type === 'open'
                ? (currentStep.answer ? 'Update answer...' : 'Your answer...')
                : 'Use the buttons above to answer...'
              }
              value={inputMessage}
              onChange={(e) => {
                if (currentStep && currentStep.question_type !== 'open') return;
                setInputMessage(e.target.value);
              }}
              onClick={() => {
                if (currentStep && currentStep.question_type !== 'open') {
                  if (notOpenNoticeTimer.current) clearTimeout(notOpenNoticeTimer.current);
                  setShowNotOpenNotice(true);
                  notOpenNoticeTimer.current = setTimeout(() => setShowNotOpenNotice(false), 3500);
                }
              }}
              onKeyDown={(e) => {
                if (currentStep && currentStep.question_type !== 'open') {
                  e.preventDefault();
                  return;
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage(e as any);
                }
              }}
              rows={1}
              disabled={isSending}
              readOnly={!!(currentStep && currentStep.question_type !== 'open')}
              style={currentStep && currentStep.question_type !== 'open' ? { cursor: 'pointer' } : undefined}
            />
            <button
              type="submit"
              className="btn-send"
              disabled={isSending || !inputMessage.trim()}
            >
              <span className="btn-send-icon"><PaperPlaneIcon /></span>
              <span className="btn-send-label">{isSending ? 'Sending...' : 'Send'}</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
