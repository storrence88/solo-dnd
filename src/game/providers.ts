import { ClaudeClient, FallbackClient, type Effort } from './claude';
import { OpenAICompatibleClient, providerConfigFromEnv, type ModelClient } from './model';

/** What the play page is told about the models: never the keys. */
export interface ProviderInfo {
  hasKey: boolean;
  /** Where the calls go, e.g. "Claude, falling back to api.groq.com". */
  provider: string;
  dmModel: string;
}

export interface ModelSetup {
  client: ModelClient;
  info: ProviderInfo;
}

/**
 * Picks the models from .env. With ANTHROPIC_API_KEY set, Claude is the primary; if an
 * OpenAI-style provider (Groq by default) is also configured, it takes over whenever Claude fails.
 */
export function modelSetupFromEnv(env: Record<string, string | undefined>, log: (msg: string) => void = console.warn): ModelSetup {
  const other = providerConfigFromEnv(env);
  const otherConfigured = other.apiKey !== '' || env.LLM_BASE_URL !== undefined;
  const otherClient = new OpenAICompatibleClient(other);
  const otherHost = new URL(other.baseUrl).host;
  const claudeKey = env.ANTHROPIC_API_KEY ?? '';
  if (!claudeKey) return { client: otherClient, info: { hasKey: other.apiKey !== '', provider: otherHost, dmModel: other.dmModel } };

  const effort = (['low', 'medium', 'high'] as const).find((e) => e === env.CLAUDE_EFFORT) ?? ('low' satisfies Effort);
  const helper = env.CLAUDE_HELPER_MODEL ?? 'claude-haiku-5-5';
  const dmModel = env.CLAUDE_DM_MODEL ?? 'claude-sonnet-5-5';
  const claude = new ClaudeClient({
    apiKey: claudeKey,
    dmModel,
    companionModel: env.CLAUDE_COMPANION_MODEL ?? helper,
    helperModel: helper,
    effort,
  });
  if (!otherConfigured) return { client: claude, info: { hasKey: true, provider: 'Claude', dmModel } };
  const client = new FallbackClient(claude, otherClient, { onFallback: (e) => log(`Claude failed, using ${otherHost} for the next minute: ${e.message}`) });
  return { client, info: { hasKey: true, provider: `Claude, falling back to ${otherHost}`, dmModel } };
}
