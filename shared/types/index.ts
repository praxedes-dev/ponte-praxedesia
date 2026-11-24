// ============================================================
// Provider & Workspace Types
// ============================================================

export type ProviderKind =
  | 'openai'
  | 'openai-compatible'
  | 'anthropic'
  | 'gemini'
  | 'local';

export type WorkspaceStatus =
  | 'idle'
  | 'planning'
  | 'awaiting_plan_approval'   // paused after cycle-1 plan, waiting for user to approve
  | 'awaiting_approval'
  | 'executing'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ActionType =
  | 'read_page'
  | 'screenshot'
  | 'click'
  | 'type'
  | 'press_key'
  | 'scroll'
  | 'navigate'
  | 'open_tab'
  | 'switch_tab'
  | 'close_tab'
  | 'wait_for'
  | 'wait_for_change'
  | 'wait_for_text'
  | 'extract'
  | 'drag'
  | 'request_confirmation'
  | 'memory_write'
  | 'memory_read'
  | 'memory_delete'
  | 'copy_to_clipboard';

export interface ProviderConfig {
  provider: ProviderKind;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  supportsVision: boolean;
  supportsStructuredOutputs: boolean;
  contextWindow: number;
  // Reasoning/thinking configuration
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh';
  enableThinking?: boolean;
}

export interface TabSession {
  tabId: number;
  windowId: number;
  groupId: number;
  url: string;
  title?: string;
  isActive: boolean;
  lastObservedAt?: number;
  lastPageState?: PageState;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  llmCalls: number;
}

export interface PageObservation {
  cycle: number;           // which planning cycle this came from
  url: string;
  textTail: string;        // last ~800 chars of page text (the part that matters most)
  actionsAfter: string[];  // action types executed after this observation
  timestamp: number;
}

export interface AgentWorkspace {
  workspaceId: string;
  name: string;
  goal: string;
  status: WorkspaceStatus;
  mode?: 'task' | 'chat';       // undefined = task (back-compat)
  rootTabId: number;
  tabGroupId: number;
  activeTabId: number;
  provider: ProviderConfig;
  tabs: Record<number, TabSession>;
  queue: PlannedAction[];
  executedActions: ExecutedAction[];
  conversationHistory: ChatMessage[];
  tokenUsage: TokenUsage;
  finalMessage?: string;       // Final response from agent when task completes
  failureReason?: string;      // Error message shown when status is 'failed'
  pageObservations: PageObservation[];   // Rolling buffer of last N page snapshots for context
  memoryBox?: Record<string, string>;  // Agent's scratchpad for preserving extracted info across context summarization
  cycleCount: number;          // How many planning cycles have run (used for observation tagging)
  createdAt: number;
  updatedAt: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | ContentPart[];
}

export interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

// ============================================================
// Planner & Execution Types
// ============================================================

export interface ActionTarget {
  strategy: 'semantic' | 'xpath' | 'coordinates' | 'agent-id';
  role?: string;
  text?: string;
  placeholder?: string;
  ariaLabel?: string;
  x?: number;
  y?: number;
  agentId?: number;
  /** S2: na busca semantica, casa o nome INTEIRO e recusa ambiguidade (lista os candidatos). */
  exato?: boolean;
}

export interface PlannedAction {
  id: string;
  type: ActionType;
  target?: ActionTarget;
  params?: Record<string, unknown>;
  expectedOutcome?: string;
  sensitive: boolean;
}

export interface ExecutedAction {
  actionId: string;
  action: PlannedAction;
  result: 'success' | 'failed' | 'skipped';
  error?: string;
  data?: Record<string, unknown>;
  screenshotBefore?: string;
  screenshotAfter?: string;
  executedAt: number;
}

export interface PageState {
  url: string;
  title: string;
  interactiveElements: InteractiveElement[];
  textContent: string;
  contentLength: number;
  screenshot?: string;
  accessibilityTree?: string;
  /** B3: ha nos cortados por profundidade (a leitura nao mostra tudo). */
  avisoProfundidade?: string;
  /** Fase 4: escopo sem resultado, itens omitidos, pagina trocou durante a leitura. */
  avisoLeitura?: string;
}

export interface InteractiveElement {
  agentId: number;
  tag: string;
  role: string;
  text: string;
  ariaLabel?: string;
  placeholder?: string;
  ariaPlaceholder?: string; // used by CodeMirror / rich editors instead of placeholder=""
  ce?: string;              // contenteditable attribute value ("true", "", "plaintext-only")
  href?: string;
  type?: string;
  /** Fase 4 (L1): o centro do elemento esta fora da janela da aba. */
  foraDaVista?: boolean;
  isSubmit?: boolean;       // true when element looks like a chat/form submit button (Run, Send, Submit…)
  rect: { x: number; y: number; w: number; h: number };
}

// ============================================================
// Audit Types
// ============================================================

export interface AuditEvent {
  id: string;
  workspaceId: string;
  tabId?: number;
  type:
    | 'workspace_created'
    | 'planner_request'
    | 'planner_response'
    | 'action_started'
    | 'action_succeeded'
    | 'action_failed'
    | 'approval_requested'
    | 'approval_received'
    | 'approval_denied'
    | 'workspace_completed'
    | 'workspace_cancelled'
    | 'workspace_failed'
    | 'llm_call_start'
    | 'llm_call_success'
    | 'llm_call_error'
    | 'chat_capture_start'
    | 'chat_page_captured'
    | 'chat_llm_start'
    | 'chat_llm_success'
    // Obra 10: um evento por comando da ponte (bridge/index.ts, responder()),
    // gravado pelo gancho `depois` de capacidades/auditoria.ts.
    | 'bridge_command';
  timestamp: number;
  payload: Record<string, unknown>;
}
