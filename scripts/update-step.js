const HASURA_ENDPOINT = 'https://local.graphql.local.nhost.run/v1';
const ADMIN_SECRET = 'nhost-admin-secret';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function main() {
  const res = await fetch(HASURA_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': ADMIN_SECRET,
    },
    body: JSON.stringify({
      query: `
        mutation {
          update_workflow_steps(
            where: { step_type: { _eq: "llm_call" } }
            _set: {
              config: {
                model: "llama-3.1-8b-instant",
                system_prompt: "You are a sales analyst. Respond with exactly one word: Positive, Negative, or Neutral.",
                user_prompt: "Analyze this lead message: \\"Hi, I saw your product at the conference and I am very interested in the enterprise plan.\\"",
                max_tokens: 10
              }
            }
          ) {
            affected_rows
          }
        }
      `
    })
  });
  console.log('Update result:', await res.json());
}

main().catch(console.error);
