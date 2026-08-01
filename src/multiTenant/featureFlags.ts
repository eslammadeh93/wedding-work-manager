/**
 * This stays false unless explicitly enabled by an environment variable during
 * a later staged rollout. It does not alter existing data access by itself.
 */
const environment = (import.meta as ImportMeta & {
  env?: Record<string, string | undefined>;
}).env;

export const USE_MULTI_TENANT_DATA = environment?.VITE_USE_MULTI_TENANT_DATA === 'true';
