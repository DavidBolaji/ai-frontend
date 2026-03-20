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

  // Locked category modal
  const [lockedModal, setLockedModal] = useState<{
    cat: RoadmapCategoryOverview;
    prereqs: RoadmapCategoryOverview[];
  } | null>(null);

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

      // Default to municipality (first category) or first unlocked
      const municipality = cats.find(c => c.category === 'municipality');
      const firstUnlocked = cats.find(c => c.status !== 'locked') || cats[0];
      const defaultCat = municipality && municipality.status !== 'locked' ? municipality : firstUnlocked;

      if (defaultCat) {
        selectCategory(defaultCat.id, defaultCat.category);
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
    setSelectedCategoryId(categoryId);
    setSelectedCategoryName(categoryName);
    setStepsLoading(true);
    setChatMessages([]);
    setCurrentStepIndex(0);

    try {
      const detail = await apiClient.getCategoryDetail(categoryId);
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
      console.error('Failed to load category:', error);
    } finally {
      setStepsLoading(false);
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
      const { completed_step, next_step, new_steps_added, reset_steps, deleted_step_ids, category_progress_pct, category_completed, routed_to_chat, chat_response, validation_error } = resp.attributes;

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
          ? { ...c, progress_pct: category_progress_pct, status: category_completed ? 'completed' : 'in_progress', completed_steps: Math.round((category_progress_pct / 100) * c.total_steps) }
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
      {/* Locked Category Modal */}
      {lockedModal && (
        <div className="modal-overlay" onClick={() => setLockedModal(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-cat-icon">{CATEGORY_ICONS[lockedModal.cat.category] || '📌'}</div>
            <h3 className="modal-title">{CATEGORY_LABELS[lockedModal.cat.category] || lockedModal.cat.category} is Locked 🔒</h3>
            <p className="modal-body">
              {lockedModal.prereqs.length > 0
                ? `To unlock this category, you need to first complete ${
                    lockedModal.prereqs.length === 1
                      ? CATEGORY_LABELS[lockedModal.prereqs[0].category] || lockedModal.prereqs[0].category
                      : lockedModal.prereqs.slice(0, -1).map(p => CATEGORY_LABELS[p.category] || p.category).join(', ') +
                        ' and ' + (CATEGORY_LABELS[lockedModal.prereqs[lockedModal.prereqs.length - 1].category] || lockedModal.prereqs[lockedModal.prereqs.length - 1].category)
                  }.`
                : 'This category will unlock as you progress through your roadmap.'}
            </p>
            {lockedModal.prereqs.length > 0 && (
              <ul className="modal-prereq-list">
                {lockedModal.prereqs.map(p => (
                  <li key={p.id} className="modal-prereq-item">
                    <span className="modal-prereq-icon">{CATEGORY_ICONS[p.category] || '📌'}</span>
                    <span className="modal-prereq-name">{CATEGORY_LABELS[p.category] || p.category}</span>
                    <span className="modal-prereq-progress">{p.completed_steps}/{p.total_steps} done</span>
                  </li>
                ))}
              </ul>
            )}
            <button className="modal-close-btn" onClick={() => setLockedModal(null)}>Got it</button>
          </div>
        </div>
      )}

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
                if (cat.status === 'locked') {
                  const depKeys = CATEGORY_DEPENDENCIES[cat.category] ?? [];
                  const prereqs = depKeys
                    .map(key => categories.find(c => c.category === key))
                    .filter((c): c is RoadmapCategoryOverview => !!c && c.status !== 'completed');
                  setLockedModal({ cat, prereqs });
                } else {
                  selectCategory(cat.id, cat.category);
                }
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
                      {cat.status === 'locked' ? '🔒 Locked' : `${cat.completed_steps}/${cat.total_steps} steps`}
                    </span>
                  </div>
                </div>
                {cat.status !== 'locked' && (
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
                )}
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

              {/* Acknowledge button for info steps */}
              {currentStep.question_type === 'info' && currentStep.status !== 'completed' && (
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

              {(currentStep.question_type === 'single_choice' || currentStep.question_type === 'multi_choice') && currentStep.options && (
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
