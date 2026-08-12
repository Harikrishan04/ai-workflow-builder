/**
 * _utils/auth.ts
 * 
 * WHY THIS EXISTS — LAYER 2 EXPLAINED:
 * 
 * When a Hasura Action is called, Hasura forwards the caller's JWT
 * session variables (X-Hasura-User-Id, X-Hasura-Role) in the request body.
 * 
 * But we CANNOT trust X-Hasura-Role alone for state-changing decisions.
 * Why? Because:
 *   1. JWTs are issued at login — a user's role may have changed since then.
 *   2. For approval_gate steps, we need to verify the caller's role against
 *      the *specific org* that owns the workflow run — not just any org.
 *   3. The webhook endpoint has no JWT at all (uses API key instead).
 * 
 * So for every action that changes state, we RE-QUERY the database to
 * confirm the caller's current role in the correct org. This is Layer 2.
 */

import { adminQuery } from './hasura.js';

export interface SessionVars {
  userId: string;
  role: string;
}

/**
 * Parse Hasura session variables from an Action request body.
 * nhost Action requests have session_variables at the top level.
 */
export function parseSessionVars(body: Record<string, unknown>): SessionVars {
  const sessionVars = body['session_variables'] as Record<string, string> | undefined;
  const userId = sessionVars?.['x-hasura-user-id'];
  const role = sessionVars?.['x-hasura-role'];

  if (!userId) {
    throw Object.assign(new Error('Missing x-hasura-user-id in session variables'), { status: 401 });
  }

  return { userId, role: role ?? 'user' };
}

export interface OrgMembership {
  org_id: string;
  role: 'owner' | 'editor' | 'viewer';
}

/**
 * LAYER 2 CHECK: Re-query the database to get the caller's actual current
 * role in a specific org. Returns null if the caller is not a member.
 * 
 * This is the key security function — called in every Action handler
 * before any state-changing operation.
 */
export async function getCallerMembership(
  userId: string,
  orgId: string
): Promise<OrgMembership | null> {
  const data = await adminQuery<{
    org_members: Array<{ org_id: string; role: string }>;
  }>(
    `query GetMembership($userId: uuid!, $orgId: uuid!) {
      org_members(
        where: {
          user_id: { _eq: $userId }
          org_id: { _eq: $orgId }
        }
        limit: 1
      ) {
        org_id
        role
      }
    }`,
    { userId, orgId }
  );

  const member = data.org_members[0];
  if (!member) return null;

  return { org_id: member.org_id, role: member.role as OrgMembership['role'] };
}

/**
 * Convenience: throws a 403 if the caller is not owner/editor in the org.
 * Pass allowedRoles to customize (e.g., ['owner'] for owner-only operations).
 */
export async function requireRole(
  userId: string,
  orgId: string,
  allowedRoles: Array<'owner' | 'editor' | 'viewer'> = ['owner', 'editor']
): Promise<OrgMembership> {
  const membership = await getCallerMembership(userId, orgId);

  if (!membership || !allowedRoles.includes(membership.role)) {
    throw Object.assign(
      new Error(
        `Access denied: requires ${allowedRoles.join(' or ')} role in this organization`
      ),
      { status: 403 }
    );
  }

  return membership;
}
