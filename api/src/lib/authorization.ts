import type { Principal, Role } from './principal.js';

/**
 * Authorisation.
 *
 * Two jobs, and the first one is load-bearing in a way it would not normally be.
 *
 * **1. The allowlist is what makes the Free tier safe.** Static Web Apps' Free
 * plan cannot restrict the built-in Entra ID provider to a single tenant — that
 * needs a custom OIDC provider, which is Standard-only (docs/VERIFICATION.md
 * §1). So *anyone* with a Microsoft account can complete the login and arrive
 * here with a valid principal. Authentication is therefore open by platform
 * constraint, and authorisation is the only thing standing between an outsider
 * and Modig's data. Every route must call `assertAuthorised`.
 *
 * **2. `can()` is where permissions grow.** v1 rules are trivial — a member may
 * do anything to any task — but they are expressed as a real function over
 * (principal, action, resource) so that per-list or per-owner rules later are a
 * change in one module rather than a scatter of inline checks.
 */

export type Action =
  | 'task:read'
  | 'task:create'
  | 'task:update'
  | 'task:delete'
  | 'list:read'
  | 'list:create'
  | 'list:update'
  | 'list:delete'
  | 'attachment:read'
  | 'attachment:create'
  | 'attachment:delete'
  | 'admin:manage';

export interface Resource {
  readonly kind: 'task' | 'list' | 'attachment' | 'system';
  readonly id?: string;
  /** Present for tasks; lets a future rule scope access by list. */
  readonly listId?: string | null;
  /** Present where known; lets a future rule scope access to the creator. */
  readonly ownerId?: string;
}

export interface AccessPolicy {
  /**
   * Entra object ids permitted to use the app. Empty means "not configured".
   */
  readonly allowedUserIds: readonly string[];
  /**
   * Email/UPN domains permitted, lower-cased and without the `@`
   * (e.g. `modig.se`). Matched against `userDetails`.
   */
  readonly allowedDomains: readonly string[];
  /** Object ids granted the admin role regardless of what the token says. */
  readonly adminUserIds: readonly string[];
  /**
   * When true, an empty allowlist permits everyone. Intended for local
   * development only — see `readAccessPolicy`, which never turns this on in a
   * deployed environment.
   */
  readonly allowAllWhenUnconfigured: boolean;
}

function splitList(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value
    .split(/[,;\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/**
 * Read the policy from application settings.
 *
 * The fail-safe choice matters here. If the allowlist is unset in a deployed
 * environment we deny everyone rather than admit everyone: a misconfigured
 * deploy should lock the owner out and be noticed, not silently publish the
 * company's task list to anyone who finds the URL.
 *
 * Locally (`AZURE_FUNCTIONS_ENVIRONMENT=Development` or no allowlist plus an
 * explicit opt-in) an unconfigured policy admits everyone, so nobody has to
 * maintain a fake allowlist to run the app on their laptop.
 */
export function readAccessPolicy(env: NodeJS.ProcessEnv = process.env): AccessPolicy {
  const isDevelopment =
    env['AZURE_FUNCTIONS_ENVIRONMENT'] === 'Development' ||
    env['TASKHUB_ALLOW_ANONYMOUS_DEV'] === 'true';

  return {
    allowedUserIds: splitList(env['TASKHUB_ALLOWED_USER_IDS']),
    allowedDomains: splitList(env['TASKHUB_ALLOWED_DOMAINS']),
    adminUserIds: splitList(env['TASKHUB_ADMIN_USER_IDS']),
    allowAllWhenUnconfigured: isDevelopment,
  };
}

export function isAllowlistConfigured(policy: AccessPolicy): boolean {
  return policy.allowedUserIds.length > 0 || policy.allowedDomains.length > 0;
}

/** Domain part of an email/UPN, lower-cased. Empty when there is no `@`. */
function domainOf(userDetails: string): string {
  const at = userDetails.lastIndexOf('@');
  if (at === -1 || at === userDetails.length - 1) return '';
  return userDetails.slice(at + 1).toLowerCase();
}

/**
 * Is this principal permitted to use the application at all?
 *
 * This is the tenant restriction the Free tier cannot enforce, moved into the
 * application.
 */
export function isAuthorisedUser(principal: Principal, policy: AccessPolicy): boolean {
  if (!isAllowlistConfigured(policy)) return policy.allowAllWhenUnconfigured;

  if (policy.allowedUserIds.includes(principal.userId.toLowerCase())) return true;

  const domain = domainOf(principal.userDetails);
  return domain.length > 0 && policy.allowedDomains.includes(domain);
}

export function rolesFor(principal: Principal, policy: AccessPolicy): Role[] {
  const roles: Role[] = ['member'];
  const isAdmin =
    policy.adminUserIds.includes(principal.userId.toLowerCase()) ||
    principal.roles.includes('admin');
  if (isAdmin) roles.push('admin');
  return roles;
}

/**
 * May this principal perform this action on this resource?
 *
 * v1: any allowlisted member may do anything except administrative actions.
 * The signature is the point — when "only the creator may delete" or "list X is
 * restricted to these people" arrives, it lands here and nowhere else.
 */
export function can(
  principal: Principal,
  action: Action,
  _resource: Resource,
  policy: AccessPolicy,
): boolean {
  if (!isAuthorisedUser(principal, policy)) return false;
  if (action === 'admin:manage') return rolesFor(principal, policy).includes('admin');
  return true;
}
