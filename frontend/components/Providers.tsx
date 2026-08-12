'use client';

import { NhostProvider } from '@nhost/nextjs';
import { Provider as UrqlProvider } from 'urql';
import { useMemo } from 'react';
import { nhost } from '../lib/nhost';
import { createUrqlClient } from '../lib/urql';

export function Providers({ children }: { children: React.ReactNode }) {
  const urqlClient = useMemo(() => createUrqlClient(), []);

  return (
    <NhostProvider nhost={nhost}>
      <UrqlProvider value={urqlClient}>
        {children}
      </UrqlProvider>
    </NhostProvider>
  );
}
