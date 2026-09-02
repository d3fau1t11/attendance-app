/**
 * Schema barrel. Order matters only for readability — Drizzle resolves
 * references lazily.
 *
 * Tenancy rule: every business table carries `companyId`, and the API scopes
 * all queries by the caller's JWT claim (see `middleware/auth.ts`). Isolation
 * is enforced at the query layer, not left to individual handlers.
 */
export * from "./enums";
export * from "./companies";
export * from "./users";
export * from "./departments";
export * from "./workplaces";
export * from "./employees";
export * from "./attendance";
export * from "./devices";
export * from "./auth";
