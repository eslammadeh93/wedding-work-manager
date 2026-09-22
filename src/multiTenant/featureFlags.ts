/**
 * Which data provider the app runs on.
 *
 * The multi-tenant provider is the only one whose financial writes go through
 * the transactional, version-checked path. The legacy provider writes to the
 * root collections, which the security rules deny, and its write helpers catch
 * that rejection, log it and update local state anyway - so a user would be
 * told their payment saved when nothing reached the database.
 *
 * A plain `=== 'true'` check meant a production build with the variable
 * missing or misspelled would silently select exactly that provider. In
 * production the flag is therefore required and must be explicitly true; a
 * build without it fails loudly instead of quietly choosing the unsafe path.
 */
const environment = (import.meta as ImportMeta & {
  env?: Record<string, string | boolean | undefined>;
}).env;

const rawFlag = environment?.VITE_USE_MULTI_TENANT_DATA as string | undefined;

/** `true` only in a real production build, not in dev, test or preview. */
export const IS_PRODUCTION_BUILD = environment?.PROD === true && environment?.MODE === 'production';

export class ProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderConfigurationError';
  }
}

/**
 * Resolves the provider, refusing to guess in production.
 * Exported so the decision can be tested without building the app.
 */
export const resolveMultiTenantFlag = (value: string | undefined, isProduction: boolean): boolean => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'true') return true;
  if (!isProduction) return false;
  throw new ProviderConfigurationError(
    'VITE_USE_MULTI_TENANT_DATA must be "true" in a production build. '
    + 'Refusing to start on the legacy provider, whose financial writes can report success after Firestore rejects them.',
  );
};

/**
 * Resolved once at startup. The error is captured rather than thrown at module
 * scope so the app can render an explicit message instead of a blank page: a
 * white screen is loud but tells an operator nothing.
 */
const resolved = (() => {
  try {
    return { value: resolveMultiTenantFlag(rawFlag, IS_PRODUCTION_BUILD), error: null as string | null };
  } catch (error) {
    return { value: false, error: error instanceof Error ? error.message : 'Invalid data provider configuration.' };
  }
})();

export const USE_MULTI_TENANT_DATA = resolved.value;
/** Non-null when a production build is misconfigured; the app must refuse to run. */
export const PROVIDER_CONFIG_ERROR = resolved.error;
