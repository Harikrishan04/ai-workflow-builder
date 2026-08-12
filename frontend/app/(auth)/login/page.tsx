'use client';

import { useState } from 'react';
import { useSignInEmailPassword } from '@nhost/nextjs';
import { useRouter } from 'next/navigation';

export default function Login() {
  const [email, setEmail] = useState('owner@orga.com');
  const [password, setPassword] = useState('password123');
  const { signInEmailPassword, isLoading, isError, error } = useSignInEmailPassword();
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const { isSuccess } = await signInEmailPassword(email, password);
    if (isSuccess) {
      router.push('/dashboard');
    }
  };

  return (
    <div className="container" style={{ display: 'flex', justifyContent: 'center', marginTop: '10vh' }}>
      <div className="card" style={{ width: '100%', maxWidth: '400px' }}>
        <h1 style={{ marginTop: 0 }}>Sign In</h1>
        <p className="text-muted mb-4">Enter your test credentials.</p>
        
        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label htmlFor="email">Email</label>
            <input 
              id="email" 
              type="email" 
              value={email} 
              onChange={(e) => setEmail(e.target.value)} 
              required 
            />
          </div>
          
          <div className="flex flex-col gap-2">
            <label htmlFor="password">Password</label>
            <input 
              id="password" 
              type="password" 
              value={password} 
              onChange={(e) => setPassword(e.target.value)} 
              required 
            />
          </div>
          
          <button type="submit" className="primary mt-4" disabled={isLoading}>
            {isLoading ? 'Signing in...' : 'Sign In'}
          </button>
          
          {isError && <p style={{ color: 'var(--danger)' }}>{error?.message}</p>}
        </form>
      </div>
    </div>
  );
}
