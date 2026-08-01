import { MockAuthProvider } from './mockAuthProvider';
import { SupabaseAuthProvider } from './supabaseAuthProvider';
import type { AuthProvider } from './types';

export type SupportedAuthProvider = 'mock' | 'supabase';

export interface AuthProviderConfig {
  provider: SupportedAuthProvider;
  projectUrl?: string;
  apiKey?: string;
}

/**
 * The only place in the codebase allowed to know which concrete
 * `AuthProvider` classes exist — mirrors `ai-engine/src/voice/registry.ts`
 * (`createSpeechToTextProvider`) and `ai-engine/src/registry.ts`
 * (`AIProvider`). "mock" remains the default so every existing test, and
 * local development without a Supabase project, keeps working unchanged.
 */
export function createAuthProvider(config: AuthProviderConfig): AuthProvider {
  switch (config.provider) {
    case 'supabase':
      if (!config.projectUrl || !config.apiKey) {
        throw new Error('AUTH_PROVIDER_URL and AUTH_PROVIDER_API_KEY are required when AUTH_PROVIDER=supabase');
      }
      return new SupabaseAuthProvider(config.projectUrl, config.apiKey);
    case 'mock':
      return new MockAuthProvider();
    default: {
      const exhaustiveCheck: never = config.provider;
      throw new Error(`Unknown auth provider: ${exhaustiveCheck}`);
    }
  }
}

/** Reads AUTH_PROVIDER(_URL|_API_KEY) from process.env, defaulting to "mock" — same shape as `createSpeechToTextProviderFromEnv`. */
export function createAuthProviderFromEnv(env: NodeJS.ProcessEnv = process.env): AuthProvider {
  const provider = (env.AUTH_PROVIDER ?? 'mock') as SupportedAuthProvider;
  return createAuthProvider({
    provider,
    projectUrl: env.AUTH_PROVIDER_URL,
    apiKey: env.AUTH_PROVIDER_API_KEY,
  });
}
