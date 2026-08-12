#!/usr/bin/env node
/**
 * scripts/create-seed-users.js
 *
 * Creates the 3 test users in nhost Auth via the admin API.
 * Run this ONCE after `nhost up` to populate auth users.
 *
 * Usage:
 *   node scripts/create-seed-users.js
 *
 * Requires NHOST_ADMIN_SECRET in environment (auto-set by nhost CLI locally).
 */

const HASURA_AUTH_URL =
  process.env.NHOST_AUTH_URL || 'http://localhost:1337/v1/auth';

const ADMIN_SECRET =
  process.env.NHOST_ADMIN_SECRET || 'nhost-admin-secret'; // default for local

const USERS = [
  { email: 'owner@orga.com',  password: 'Password123!', displayName: 'Owner A' },
  { email: 'editor@orga.com', password: 'Password123!', displayName: 'Editor A' },
  { email: 'owner@orgb.com',  password: 'Password123!', displayName: 'Owner B' },
];

async function createUser(user) {
  const res = await fetch(`${HASURA_AUTH_URL}/signup/email-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': ADMIN_SECRET,
    },
    body: JSON.stringify({
      email: user.email,
      password: user.password,
      options: { displayName: user.displayName },
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error(`❌ Failed to create ${user.email}:`, data.error || data.message);
    return null;
  }

  console.log(`✅ Created ${user.email} → ID: ${data.session?.user?.id}`);
  return data.session?.user?.id;
}

async function main() {
  console.log('Creating seed users...\n');
  for (const user of USERS) {
    await createUser(user);
  }
  console.log('\nDone! Copy the IDs above into nhost/seeds/default/1723500000000_seed_data.sql');
}

main().catch(console.error);
