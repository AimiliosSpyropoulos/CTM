'use client';

import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

export default function LoginPage() {
  const params = useSearchParams();
  const next = params.get('next') ?? '/dashboard';
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get('email') ?? '');
    const password = String(fd.get('password') ?? '');

    const res = await signIn('credentials', {
      email,
      password,
      redirect: false
    });

    if (!res || res.error) {
      setError('Wrong email or password');
      return;
    }

    window.location.href = next;
  }

  return (
    <div className="card">
      <h2>Login</h2>
      <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12, maxWidth: 460 }}>
        <div>
          <label>Email</label>
          <input name="email" type="email" required />
        </div>
        <div>
          <label>Password</label>
          <input name="password" type="password" required />
        </div>
        <button className="button primary" type="submit">Sign in</button>
        {error && <p className="small">{error}</p>}
      </form>
    </div>
  );
}
