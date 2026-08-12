/**
 * hooks/useOrgRole.ts
 *
 * WHY THIS HOOK EXISTS:
 * The frontend needs to know the current user's role to:
 *   - Hide the Run button from viewers
 *   - Hide the Approve button from viewers  
 *   - Hide member management from non-owners
 *   - Show/hide Add Step for restricted step types
 *
 * We query org_members via Hasura (which applies Layer 1 filtering)
 * so we only ever see the current user's own membership rows.
 */

'use client';

import { useUserData } from '@nhost/nextjs';
import { useQuery } from 'urql';

const ORG_ROLE_QUERY = `
  query GetMyOrgRole($userId: uuid!) {
    org_members(where: { user_id: { _eq: $userId } }) {
      org_id
      role
      organization {
        id
        name
        quota_used
        quota_limit
        quota_reset_at
      }
    }
  }
`;

export interface OrgRoleState {
  role: 'owner' | 'editor' | 'viewer' | null;
  orgId: string | null;
  orgName: string | null;
  quotaUsed: number;
  quotaLimit: number;
  quotaResetAt: string | null;
  isOwner: boolean;
  isEditor: boolean;
  isViewer: boolean;
  canTrigger: boolean;    // owner or editor
  canApprove: boolean;    // owner or editor
  canManageMembers: boolean; // owner only
  canAddRestrictedSteps: boolean; // owner only (db_write, notify, webhook trigger)
  isLoading: boolean;
}

export function useOrgRole(): OrgRoleState {
  const user = useUserData();

  const [result] = useQuery({
    query: ORG_ROLE_QUERY,
    variables: { userId: user?.id ?? '' },
    pause: !user?.id,
  });

  const membership = result.data?.org_members?.[0];
  const role = (membership?.role ?? null) as OrgRoleState['role'];
  const org = membership?.organization;

  return {
    role,
    orgId: org?.id ?? null,
    orgName: org?.name ?? null,
    quotaUsed: org?.quota_used ?? 0,
    quotaLimit: org?.quota_limit ?? 0,
    quotaResetAt: org?.quota_reset_at ?? null,
    isOwner: role === 'owner',
    isEditor: role === 'editor',
    isViewer: role === 'viewer',
    canTrigger: role === 'owner' || role === 'editor',
    canApprove: role === 'owner' || role === 'editor',
    canManageMembers: role === 'owner',
    canAddRestrictedSteps: role === 'owner',
    isLoading: result.fetching,
  };
}
