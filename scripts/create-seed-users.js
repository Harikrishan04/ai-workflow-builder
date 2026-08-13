#!/usr/bin/env node
/**
 * scripts/create-seed-users.js
 *
 * Creates the 3 test users in nhost Auth via the signup API,
 * then patches their passwords and email_verified status directly
 * in PostgreSQL to guarantee they're loggable.
 *
 * Usage:
 *   node scripts/create-seed-users.js
 *
 * Prerequisite: nhost local environment must be running (`nhost up`).
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const HASURA_AUTH_URL =
  process.env.NHOST_AUTH_URL || 'https://local.auth.local.nhost.run/v1';

const HASURA_GRAPHQL_URL =
  process.env.HASURA_GRAPHQL_URL || 'https://local.hasura.local.nhost.run/v1/metadata';

const ADMIN_SECRET =
  process.env.NHOST_ADMIN_SECRET || 'nhost-admin-secret';

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
    if (data.error === 'email-already-in-use') {
      console.log(`⚠️  ${user.email} already exists — will fix password`);
      return null;
    }
    console.error(`❌ Failed to create ${user.email}:`, data.error || data.message);
    return null;
  }

  console.log(`✅ Created ${user.email} → ID: ${data.session?.user?.id}`);
  return data.session?.user?.id;
}

async function fixPasswords() {
  // Use Hasura admin API to run SQL directly
  const emails = USERS.map(u => `'${u.email}'`).join(', ');
  const password = USERS[0].password; // same for all

  const sql = `
    UPDATE auth.users
    SET password_hash = crypt('${password}', gen_salt('bf', 10)),
        email_verified = true
    WHERE email IN (${emails});
  `;

  const res = await fetch('https://local.hasura.local.nhost.run/v2/query', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': ADMIN_SECRET,
    },
    body: JSON.stringify({
      type: 'run_sql',
      args: {
        source: 'default',
        sql,
        cascade: false,
      },
    }),
  });

  const data = await res.json();
  if (data.error || data.internal) {
    console.error('❌ Failed to fix passwords:', JSON.stringify(data));
    return;
  }
  console.log('✅ Passwords and email_verified fixed for all users');
}

async function main() {
  console.log('Creating seed users...\n');
  for (const user of USERS) {
    await createUser(user);
  }

  console.log('\nFixing passwords via direct DB update...');
  await fixPasswords();

  console.log('\n✅ Done! Users can now log in with password: Password123!');
  console.log('Next: run the seed SQL to create orgs and workflows:');
  console.log('  DOCKER_HOST=... docker exec -i vocallabs-postgres-1 psql -U postgres -d local < nhost/seeds/default/1723500000000_seed_data.sql');
}

main().catch(console.error);
