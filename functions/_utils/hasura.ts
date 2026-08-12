/**
 * _utils/hasura.ts
 * 
 * WHY THIS EXISTS:
 * The Action handlers need to read and write to the database directly,
 * bypassing all row-level permission filters. This is the "trust boundary" —
 * the handler has already verified the caller's identity and role,
 * so now it acts as a privileged service using the admin secret.
 * 
 * NEVER expose the admin secret to the frontend or include it in
 * any response. It only lives in the server-side function environment.
 */

const HASURA_ENDPOINT = process.env.NHOST_GRAPHQL_URL ||
  `https://${process.env.NHOST_SUBDOMAIN}.hasura.${process.env.NHOST_REGION}.nhost.run/v1/graphql`;

const ADMIN_SECRET = process.env.NHOST_ADMIN_SECRET || '';

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
}

/**
 * Execute a GraphQL operation as admin (bypasses all row-level permissions).
 * Use only after you've already verified the caller's identity in the handler.
 */
export async function adminQuery<T = unknown>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const response = await fetch(HASURA_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': ADMIN_SECRET,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Hasura HTTP error: ${response.status} ${response.statusText}`);
  }

  const result = (await response.json()) as GraphQLResponse<T>;

  if (result.errors && result.errors.length > 0) {
    const messages = result.errors.map((e) => e.message).join(', ');
    throw new Error(`Hasura GraphQL error: ${messages}`);
  }

  if (!result.data) {
    throw new Error('Hasura returned no data and no errors');
  }

  return result.data;
}
