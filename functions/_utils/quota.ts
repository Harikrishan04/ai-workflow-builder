/**
 * _utils/quota.ts
 * 
 * WHY PER-ORG QUOTA:
 * LLM and HTTP calls have real costs. Without a quota, one org could
 * abuse the system and run up bills. We check BEFORE creating a run
 * (fail-fast), and increment DURING execution (per external call, not
 * just at the end) so a long run that hits the limit stops mid-way
 * rather than running to completion and then reporting an error.
 */

import { adminQuery } from './hasura';

interface OrgQuota {
  id: string;
  quota_used: number;
  quota_limit: number;
  quota_reset_at: string;
}

/**
 * Check if an org has remaining quota. Resets the counter if the
 * reset period has passed. Returns the current quota state.
 */
export async function checkAndResetQuota(orgId: string): Promise<OrgQuota> {
  const data = await adminQuery<{ organizations_by_pk: OrgQuota }>(
    `query GetQuota($orgId: uuid!) {
      organizations_by_pk(id: $orgId) {
        id quota_used quota_limit quota_reset_at
      }
    }`,
    { orgId }
  );

  const org = data.organizations_by_pk;
  if (!org) throw new Error(`Organization ${orgId} not found`);

  // Auto-reset if the reset period has passed
  if (new Date(org.quota_reset_at) < new Date()) {
    await adminQuery(
      `mutation ResetQuota($orgId: uuid!) {
        update_organizations_by_pk(
          pk_columns: { id: $orgId }
          _set: {
            quota_used: 0
            quota_reset_at: "now() + interval '30 days'"
          }
        ) { id }
      }`,
      { orgId }
    );
    org.quota_used = 0;
  }

  return org;
}

/**
 * Returns true if the org has quota remaining.
 * Call this BEFORE starting a run.
 */
export async function hasQuotaRemaining(orgId: string): Promise<boolean> {
  const org = await checkAndResetQuota(orgId);
  return org.quota_used < org.quota_limit;
}

/**
 * Increment the org's quota_used by 1.
 * Call this after each llm_call or http_request step succeeds.
 */
export async function incrementQuota(orgId: string): Promise<void> {
  await adminQuery(
    `mutation IncrementQuota($orgId: uuid!) {
      update_organizations_by_pk(
        pk_columns: { id: $orgId }
        _inc: { quota_used: 1 }
      ) { id quota_used }
    }`,
    { orgId }
  );
}
