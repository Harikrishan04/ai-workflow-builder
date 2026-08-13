process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
async function main() {
  const res = await fetch('https://local.graphql.local.nhost.run/v1', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': 'nhost-admin-secret',
    },
    body: JSON.stringify({
      query: '{ __schema { mutationType { fields { name } } } }',
    }),
  });
  const data = await res.json();
  const names = data.data.__schema.mutationType.fields.map(f => f.name).filter(n => n.includes('trigger') || n.includes('approve') || n.includes('Trigger') || n.includes('Approve'));
  console.log('Action mutations found:', names);
  if (names.length === 0) {
    const all = data.data.__schema.mutationType.fields.map(f => f.name);
    console.log('All mutations:', all.join(', '));
  }
}
main().catch(console.error);
