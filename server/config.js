import 'dotenv/config';

export const PORT = Number(process.env.PORT) || 3000;
export const REVOLAB_API_KEY = process.env.REVOLAB_API_KEY || '';
export const REVOLAB_BASE_URL = process.env.REVOLAB_BASE_URL || 'https://api.revolab.ai';
export const MOCK = process.env.MOCK === '1';

// ---- LLM evaluator (Task 2) -------------------------------------------------
// LLM_PROVIDER=openai|gemini selects which API the evaluator talks to.
// With no key configured the evaluator logs once and uses the deterministic
// fallback, so the whole game still runs offline.
export const SUPPORTED_LLM_PROVIDERS = Object.freeze(['openai', 'gemini']);

const rawProvider = (process.env.LLM_PROVIDER || 'openai').toLowerCase().trim();

/**
 * An unrecognised value used to fall through to the OpenAI path silently, so a
 * typo (LLM_PROVIDER=openal) produced an empty key and a permanently
 * lobotomised evaluator. Warn unmistakably and name the fallback.
 * @returns {string} the provider actually used
 */
export function validateLlmProvider(value = rawProvider, warn = console.warn) {
  if (SUPPORTED_LLM_PROVIDERS.includes(value)) return value;
  warn(
    `\n*** [config] WARNING: LLM_PROVIDER="${process.env.LLM_PROVIDER}" is not recognised. ` +
      `Supported values: ${SUPPORTED_LLM_PROVIDERS.join(', ')}. ` +
      `Falling back to "openai" — if that key is unset every turn will use the deterministic fallback scorer. ***\n`,
  );
  return 'openai';
}

export const LLM_PROVIDER = validateLlmProvider();
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
export const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com';
export const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
export const GEMINI_BASE_URL =
  process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com';
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
export const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 20000;

/** @returns {string} '' when no key is configured for the selected provider */
export function llmApiKey() {
  return LLM_PROVIDER === 'gemini' ? GEMINI_API_KEY : OPENAI_API_KEY;
}

export function hasLlmKey() {
  return Boolean(llmApiKey());
}
