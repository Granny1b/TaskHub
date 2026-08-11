import { describe, expect, it } from 'vitest';
import {
  can,
  isAllowlistConfigured,
  isAuthorisedUser,
  readAccessPolicy,
  rolesFor,
  type AccessPolicy,
} from './authorization.js';
import { encodeClientPrincipal, getPrincipal, type Principal } from './principal.js';

/**
 * The allowlist is not a nicety here. On the SWA Free tier the built-in Entra
 * provider cannot be restricted to one tenant, so any Microsoft account in the
 * world can authenticate and arrive with a valid principal. These tests are
 * what stand between that and Modig's data.
 */

const principal = (overrides: Partial<Principal> = {}): Principal => ({
  userId: 'user-object-id',
  userDetails: 'anna@modig.se',
  identityProvider: 'aad',
  roles: ['authenticated'],
  ...overrides,
});

const policy = (overrides: Partial<AccessPolicy> = {}): AccessPolicy => ({
  allowedUserIds: [],
  allowedDomains: [],
  adminUserIds: [],
  allowAllWhenUnconfigured: false,
  ...overrides,
});

describe('the allowlist gate', () => {
  it('admits a user on the allowed domain', () => {
    expect(isAuthorisedUser(principal(), policy({ allowedDomains: ['modig.se'] }))).toBe(true);
  });

  it('admits a user by explicit object id', () => {
    expect(isAuthorisedUser(principal(), policy({ allowedUserIds: ['user-object-id'] }))).toBe(
      true,
    );
  });

  it('rejects an outsider who authenticated with a personal Microsoft account', () => {
    const outsider = principal({ userId: 'stranger', userDetails: 'someone@outlook.com' });
    expect(isAuthorisedUser(outsider, policy({ allowedDomains: ['modig.se'] }))).toBe(false);
  });

  it('rejects a lookalike domain rather than matching a suffix', () => {
    const attacker = principal({ userDetails: 'anna@notmodig.se' });
    expect(isAuthorisedUser(attacker, policy({ allowedDomains: ['modig.se'] }))).toBe(false);
  });

  it('is not fooled by a domain in the local part of the address', () => {
    const attacker = principal({ userDetails: 'modig.se@evil.com' });
    expect(isAuthorisedUser(attacker, policy({ allowedDomains: ['modig.se'] }))).toBe(false);
  });

  it('matches domains case-insensitively', () => {
    const user = principal({ userDetails: 'Anna@MODIG.se' });
    expect(isAuthorisedUser(user, policy({ allowedDomains: ['modig.se'] }))).toBe(true);
  });

  it('rejects a principal with no domain at all when matching by domain', () => {
    const user = principal({ userDetails: 'no-at-sign' });
    expect(isAuthorisedUser(user, policy({ allowedDomains: ['modig.se'] }))).toBe(false);
  });

  it('DENIES everyone when the allowlist is unconfigured in a deployed environment', () => {
    // Fail closed. A misconfigured deploy should lock the owner out and be
    // noticed, not silently publish the company's task list to the internet.
    expect(isAuthorisedUser(principal(), policy())).toBe(false);
  });

  it('admits everyone when unconfigured only if development explicitly opted in', () => {
    expect(isAuthorisedUser(principal(), policy({ allowAllWhenUnconfigured: true }))).toBe(true);
  });

  it('knows whether it has been configured at all', () => {
    expect(isAllowlistConfigured(policy())).toBe(false);
    expect(isAllowlistConfigured(policy({ allowedDomains: ['modig.se'] }))).toBe(true);
    expect(isAllowlistConfigured(policy({ allowedUserIds: ['x'] }))).toBe(true);
  });
});

describe('readAccessPolicy', () => {
  it('parses comma, semicolon and whitespace separated lists', () => {
    const parsed = readAccessPolicy({
      TASKHUB_ALLOWED_DOMAINS: 'modig.se, example.com;  other.se',
    } as NodeJS.ProcessEnv);
    expect(parsed.allowedDomains).toEqual(['modig.se', 'example.com', 'other.se']);
  });

  it('lower-cases entries so configuration is not case-sensitive', () => {
    const parsed = readAccessPolicy({
      TASKHUB_ALLOWED_DOMAINS: 'MODIG.se',
      TASKHUB_ALLOWED_USER_IDS: 'ABC-123',
    } as NodeJS.ProcessEnv);
    expect(parsed.allowedDomains).toEqual(['modig.se']);
    expect(parsed.allowedUserIds).toEqual(['abc-123']);
  });

  it('does not open up when the environment is empty', () => {
    expect(readAccessPolicy({} as NodeJS.ProcessEnv).allowAllWhenUnconfigured).toBe(false);
  });

  it('opens up for local development', () => {
    expect(
      readAccessPolicy({ AZURE_FUNCTIONS_ENVIRONMENT: 'Development' } as NodeJS.ProcessEnv)
        .allowAllWhenUnconfigured,
    ).toBe(true);
  });
});

describe('roles', () => {
  it('makes everyone a member', () => {
    expect(rolesFor(principal(), policy({ allowedDomains: ['modig.se'] }))).toEqual(['member']);
  });

  it('grants admin from configuration', () => {
    const roles = rolesFor(principal(), policy({ adminUserIds: ['user-object-id'] }));
    expect(roles).toContain('admin');
  });

  it('grants admin from a role claim', () => {
    const withRole = principal({ roles: ['authenticated', 'admin'] });
    expect(rolesFor(withRole, policy())).toContain('admin');
  });
});

describe('can()', () => {
  const allowed = policy({ allowedDomains: ['modig.se'] });

  it('lets an allowlisted member work with tasks', () => {
    expect(can(principal(), 'task:update', { kind: 'task', id: 't1' }, allowed)).toBe(true);
    expect(can(principal(), 'task:delete', { kind: 'task', id: 't1' }, allowed)).toBe(true);
  });

  it('refuses everything to a non-allowlisted principal', () => {
    const outsider = principal({ userDetails: 'stranger@example.com' });
    expect(can(outsider, 'task:read', { kind: 'task' }, allowed)).toBe(false);
  });

  it('reserves administrative actions for admins', () => {
    expect(can(principal(), 'admin:manage', { kind: 'system' }, allowed)).toBe(false);
    expect(
      can(
        principal(),
        'admin:manage',
        { kind: 'system' },
        policy({ allowedDomains: ['modig.se'], adminUserIds: ['user-object-id'] }),
      ),
    ).toBe(true);
  });
});

describe('getPrincipal', () => {
  const request = (headerValue: string | null) =>
    ({
      headers: { get: (name: string) => (name === 'x-ms-client-principal' ? headerValue : null) },
    }) as never;

  it('decodes a valid principal header', () => {
    const header = encodeClientPrincipal({ userId: 'abc', userDetails: 'anna@modig.se' });
    const parsed = getPrincipal(request(header));

    expect(parsed?.userId).toBe('abc');
    expect(parsed?.userDetails).toBe('anna@modig.se');
    expect(parsed?.roles).toContain('authenticated');
  });

  it('returns null for an anonymous request', () => {
    expect(getPrincipal(request(null))).toBeNull();
    expect(getPrincipal(request(''))).toBeNull();
  });

  it('returns null rather than throwing on a malformed header', () => {
    // A parse failure is an unauthenticated request, not a server error.
    expect(getPrincipal(request('not-base64-at-all!!!'))).toBeNull();
    expect(getPrincipal(request(Buffer.from('{"broken":').toString('base64')))).toBeNull();
    expect(getPrincipal(request(Buffer.from('[]').toString('base64')))).toBeNull();
  });

  it('returns null when the payload carries no userId', () => {
    const header = Buffer.from(JSON.stringify({ userDetails: 'x' })).toString('base64');
    expect(getPrincipal(request(header))).toBeNull();
  });

  it('ignores non-string entries in userRoles', () => {
    const header = Buffer.from(
      JSON.stringify({ userId: 'abc', userRoles: ['authenticated', 42, null] }),
    ).toString('base64');
    expect(getPrincipal(request(header))?.roles).toEqual(['authenticated']);
  });
});
