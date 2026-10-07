// ============================================================
// Model Capabilities Registry
// Auto-detection system for reasoning/thinking capabilities
// ============================================================

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh';

export interface ModelCapabilities {
  reasoningEffort?: ReasoningEffort;
  hasThinking?: boolean;
  supportsTemperatureOnlyWhenNoReasoning?: boolean;
  // Parameter names used by this model
  reasoningParamName?: 'reasoning_effort' | 'reasoning' | 'think' | 'chat_template_kwargs';
  // Whether the model supports disabling thinking
  canDisableThinking?: boolean;
  // API type
  apiType?: 'chat' | 'responses';
}

export interface CapabilitiesMap {
  [modelId: string]: ModelCapabilities;
}

// Pre-defined capabilities for known models
export const MODEL_CAPABILITIES: CapabilitiesMap = {
  // OpenAI GPT-5 family
  'gpt-5': { reasoningEffort: 'none', supportsTemperatureOnlyWhenNoReasoning: true, apiType: 'chat' },
  'gpt-5.4': { reasoningEffort: 'none', supportsTemperatureOnlyWhenNoReasoning: true, apiType: 'chat' },
  'gpt-5.4-pro': { reasoningEffort: 'none', supportsTemperatureOnlyWhenNoReasoning: true, apiType: 'chat' },
  'gpt-5.4-mini': { reasoningEffort: 'none', supportsTemperatureOnlyWhenNoReasoning: true, apiType: 'chat' },
  'gpt-5.4-nano': { reasoningEffort: 'none', supportsTemperatureOnlyWhenNoReasoning: true, apiType: 'chat' },
  
  // OpenAI O-series
  'o1': { reasoningEffort: 'high', supportsTemperatureOnlyWhenNoReasoning: true, apiType: 'chat' },
  'o1-mini': { reasoningEffort: 'medium', supportsTemperatureOnlyWhenNoReasoning: true, apiType: 'chat' },
  'o1-preview': { reasoningEffort: 'high', supportsTemperatureOnlyWhenNoReasoning: true, apiType: 'chat' },
  'o3': { reasoningEffort: 'high', supportsTemperatureOnlyWhenNoReasoning: true, apiType: 'chat' },
  'o3-mini': { reasoningEffort: 'medium', supportsTemperatureOnlyWhenNoReasoning: true, apiType: 'chat' },
  'o4-mini': { reasoningEffort: 'low', supportsTemperatureOnlyWhenNoReasoning: true, apiType: 'chat' },
  'o4-mini-high': { reasoningEffort: 'medium', supportsTemperatureOnlyWhenNoReasoning: true, apiType: 'chat' },
  
  // OpenAI GPT-4 (non-reasoning)
  'gpt-4.1': { reasoningEffort: 'none', apiType: 'chat' },
  'gpt-4.1-mini': { reasoningEffort: 'none', apiType: 'chat' },
  'gpt-4.1-nano': { reasoningEffort: 'none', apiType: 'chat' },
  'gpt-4o': { reasoningEffort: 'none', apiType: 'chat' },
  'gpt-4o-mini': { reasoningEffort: 'none', apiType: 'chat' },
  'gpt-4-turbo': { reasoningEffort: 'none', apiType: 'chat' },
  'gpt-4': { reasoningEffort: 'none', apiType: 'chat' },
  
  // Holo3 models
  'holo3-35b-a3b': { hasThinking: true, canDisableThinking: true, reasoningParamName: 'chat_template_kwargs' },
  'holo3-122b-a10b': { hasThinking: true, canDisableThinking: true, reasoningParamName: 'chat_template_kwargs' },
  
  // Ollama thinking models
  'deepseek-r1': { hasThinking: true, canDisableThinking: true, reasoningParamName: 'think' },
  'deepseek-r1:8b': { hasThinking: true, canDisableThinking: true, reasoningParamName: 'think' },
  'deepseek-r1:14b': { hasThinking: true, canDisableThinking: true, reasoningParamName: 'think' },
  'deepseek-r1:32b': { hasThinking: true, canDisableThinking: true, reasoningParamName: 'think' },
  'deepseek-r1:70b': { hasThinking: true, canDisableThinking: true, reasoningParamName: 'think' },
  'deepseek-v3': { hasThinking: true, canDisableThinking: true, reasoningParamName: 'think' },
  'deepseek-v3.1': { hasThinking: true, canDisableThinking: true, reasoningParamName: 'think' },
  'qwen3': { hasThinking: true, canDisableThinking: true, reasoningParamName: 'think' },
  'qwen3:4b': { hasThinking: true, canDisableThinking: true, reasoningParamName: 'think' },
  'qwen3:8b': { hasThinking: true, canDisableThinking: true, reasoningParamName: 'think' },
  'qwen3:14b': { hasThinking: true, canDisableThinking: true, reasoningParamName: 'think' },
  'qwen3:32b': { hasThinking: true, canDisableThinking: true, reasoningParamName: 'think' },
  'qwen2.5:14b': { hasThinking: true, canDisableThinking: true, reasoningParamName: 'think' },
  'qwen2.5:32b': { hasThinking: true, canDisableThinking: true, reasoningParamName: 'think' },
  
  // Anthropic (different system - uses thinking but not controllable via API)
  'claude-sonnet-4-5': { reasoningEffort: 'none' },
  'claude-haiku-4-5': { reasoningEffort: 'none' },
  'claude-opus-4-5': { reasoningEffort: 'none' },
  
  // Gemini (different system)
  'gemini-2.5-flash': { reasoningEffort: 'none' },
  'gemini-2.5-pro': { reasoningEffort: 'none' },
  'gemini-2.0-flash': { reasoningEffort: 'none' },
  'gemini-2.0-flash-lite': { reasoningEffort: 'none' },
  
  // OpenRouter models (pass-through)
  'anthropic/claude-sonnet-4-5': { reasoningEffort: 'none' },
  'anthropic/claude-3.5-sonnet': { reasoningEffort: 'none' },
  'google/gemini-2.5-flash': { reasoningEffort: 'none' },
  'google/gemini-2.5-pro': { reasoningEffort: 'none' },
  'meta-llama/llama-4-maverick': { reasoningEffort: 'none' },
  'deepseek/deepseek-r1': { hasThinking: true, canDisableThinking: true },
};

// Regex patterns for auto-detection
const REASONING_PATTERNS = [
  { pattern: /^gpt-5(\.4)?/, type: 'reasoning', defaultEffort: 'none' },
  { pattern: /^o[1-4](-mini|-high)?/, type: 'reasoning', defaultEffort: 'high' },
  { pattern: /^(deepseek|qwen).*r1/i, type: 'thinking', canDisable: true },
  { pattern: /^qwen3/i, type: 'thinking', canDisable: true },
  { pattern: /^holo3/i, type: 'thinking', canDisable: true },
];

// Auto-detection function
export function detectModelCapabilities(modelId: string): ModelCapabilities | null {
  const lowerModel = modelId.toLowerCase();
  
  // 1. Direct match (most reliable)
  for (const [capModelId, caps] of Object.entries(MODEL_CAPABILITIES)) {
    if (lowerModel === capModelId.toLowerCase() || lowerModel.startsWith(capModelId.toLowerCase())) {
      return caps;
    }
  }
  
  // 2. Pattern matching (fallback for variants)
  for (const { pattern, type, defaultEffort, canDisable } of REASONING_PATTERNS) {
    if (pattern.test(lowerModel)) {
      if (type === 'reasoning') {
        return { 
          reasoningEffort: defaultEffort as ReasoningEffort, 
          supportsTemperatureOnlyWhenNoReasoning: true,
          apiType: 'chat'
        };
      } else if (type === 'thinking') {
        return { 
          hasThinking: true, 
          canDisableThinking: canDisable,
          reasoningParamName: 'think'
        };
      }
    }
  }
  
  // 3. No detection possible
  return null;
}

// Get effective reasoning config from model
export function getEffectiveReasoningConfig(
  modelId: string,
  userSetting?: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'auto'
): { reasoningEffort: ReasoningEffort; enableThinking: boolean } {
  // If user explicitly set a value, use it
  if (userSetting && userSetting !== 'auto') {
    return { reasoningEffort: userSetting, enableThinking: false };
  }
  
  // Otherwise, detect from model capabilities
  const caps = detectModelCapabilities(modelId);
  
  if (caps?.reasoningEffort) {
    return { reasoningEffort: caps.reasoningEffort, enableThinking: false };
  }
  
  if (caps?.hasThinking) {
    return { reasoningEffort: 'none', enableThinking: true };
  }
  
  // Default: no reasoning/thinking
  return { reasoningEffort: 'none', enableThinking: false };
}

// Validate if model supports a specific parameter
export function modelSupportsParameter(modelId: string, paramName: string): boolean {
  const caps = detectModelCapabilities(modelId);
  if (!caps) return false;
  
  if (paramName === 'reasoning_effort' || paramName === 'reasoning') {
    return caps.reasoningEffort !== undefined;
  }
  
  if (paramName === 'think') {
    return caps.hasThinking === true;
  }
  
  if (paramName === 'chat_template_kwargs') {
    return caps.reasoningParamName === 'chat_template_kwargs';
  }
  
  return false;
}