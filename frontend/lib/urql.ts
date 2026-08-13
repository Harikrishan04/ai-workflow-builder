'use client';

import { createClient, fetchExchange, subscriptionExchange } from 'urql';
import { createClient as createWSClient } from 'graphql-ws';
import { nhost } from './nhost';

export function createUrqlClient() {
  const isServer = typeof window === 'undefined';

  const wsClient = isServer
    ? null
    : createWSClient({
        url: process.env.NEXT_PUBLIC_HASURA_WS_URL || 'ws://localhost:1337/v1/graphql',
        connectionParams: async () => {
          const token = nhost.auth.getAccessToken();
          return {
            headers: {
              Authorization: token ? `Bearer ${token}` : undefined,
            },
          };
        },
      });

  return createClient({
    url: process.env.NEXT_PUBLIC_HASURA_URL || 'https://local.graphql.local.nhost.run/v1',
    preferGetMethod: false,
    fetchOptions: () => {
      const token = nhost.auth.getAccessToken();
      return {
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
        },
      };
    },
    exchanges: [
      fetchExchange,
      subscriptionExchange({
        forwardSubscription: (operation) => ({
          subscribe: (sink) => {
            if (!wsClient) return { unsubscribe: () => {} };
            const dispose = wsClient.subscribe(operation as any, sink as any);
            return { unsubscribe: dispose };
          },
        }),
      }),
    ],
  });
}
