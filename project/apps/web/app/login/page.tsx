'use client';

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import Link from 'next/link';

export default function LoginPage() {
  const params = useSearchParams();

  // In some TS setups useSearchParams can be typed as possibly null.
  // Guard it so `next build` never fails.
  const next = useMemo(() => {
    const v = params?.get('next');
    return v && v.trim().length > 0 ? v : '/dashboard';
  }, [params]);

  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const form = new FormData(e.currentTarget);
    const email = String(form.get('email') ?? '').trim();
    const password = String(form.get('password') ?? '');

    if (!email || !password) {
      setError('Missing email or password');
      return;
    }

    const res = await signIn('credentials', {
      email,
      password,
      redirect: false,
      callbackUrl: next
    });

    if (!res) {
      setError('Login failed');
      return;
    }

    if (res.error) {
      setError(res.error);
      return;
    }

    // res.url is the destination when redirect:false
    window.location.href = res.url ?? next;
  }

  return (
    <div className="card" style={{ maxWidth: 520 }}>
      <h2>Login</h2>

      {error && (
        <div className="card" style={{ border: '1px solid rgba(255,0,0,.35)', padding: 12 }}>
          <b style={{ color: 'rgb(180,0,0)' }}>Error</b>
          <div className="small" style={{ marginTop: 6 }}>{error}</div>
        </div>
      )}

      <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12, marginTop: 12 }}>
        <div>
          <label>Email</label>
          <input name="email" type="email" required />
        </div>

        <div>
          <label>Password</label>
          <input name="password" type="password" required />
        </div>

        <button className="button primary" type="submit">Sign in</button>
      </form>

      <div className="small" style={{ marginTop: 10 }}>
        No account? <Link href="/register">Create one</Link>
      </div>
    </div>
  );
}
