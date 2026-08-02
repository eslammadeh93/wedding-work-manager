# Multi-tenant clean-start setup

No operational legacy collection is migrated, read as a fallback, or written by the new system. Root `users`, `orders`, `workers`, `customers`, `inventory`, `expenses`, `categories`, `activityLogs`, `notifications`, and `settings/company` are temporary read-only archives only.

## Local emulator

1. Start Auth, Firestore, and Functions emulators with `firebase emulators:start`.
2. Call `createInitialPlatformOwner` once with `{ "name", "email", "password" }`; the password must be at least 12 characters. This endpoint is unavailable in production and creates both Firebase Auth claims and `platformUsers/{uid}`.
3. Sign in as that owner and use the Platform page to call `createCompanyWithOwner`. This creates a fresh `companies/{companyId}`, its `members/{ownerUid}`, and a new `company_super_admin` Auth account.
4. The company super admin uses the Team page to create `manager`, `employee`, and `worker`. Worker public data goes to `workers`, while its password-equivalent is hashed only in `workerSecrets`; worker login is only through `workerLogin`.

## Staging

Set `MULTI_TENANT_SETUP_MODE=staging` and provide `SETUP_BOOTSTRAP_SECRET` (at least 24 characters) through managed runtime configuration. The bootstrap callable requires that secret in its request. Do not set either variable in production.

## Test seed

`seedTestMultiTenantData` is explicit-only: callers must send `confirmSeed: true`; it never runs at startup. It runs only in the emulator, or in staging with `MULTI_TENANT_TEST_MODE=true`, and creates `test_alpha` and `test_beta` with isolated members, worker/workerSecrets, customer, order, inventory, and `settings/main`. It does not touch legacy collections. Emulator-only responses include synthetic credentials; staging responses never expose them.

Keep `VITE_USE_MULTI_TENANT_DATA=false` by default. Set it to `true` only in an approved staging environment after the integration and rules tests pass. Never enable it in production during this phase.
