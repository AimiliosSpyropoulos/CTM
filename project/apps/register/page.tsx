import { prisma } from '@/lib/db';
import { hash } from 'bcryptjs';
import { redirect } from 'next/navigation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function registerAction(formData: FormData) {
  'use server';

  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const name = String(formData.get('name') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!email || !password || password.length < 6) {
    throw new Error('Invalid input');
  }

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) {
    throw new Error('Email already registered');
  }

  const passwordHash = await hash(password, 10);
  await prisma.user.create({
    data: {
      email,
      name: name || null,
      passwordHash,
      role: 'STUDENT'
    }
  });

  redirect('/login');
}

export default function RegisterPage() {
  return (
    <div className="card">
      <h2>Register (Student)</h2>
      <p className="small">Χωρίς επιβεβαίωση email.</p>

      <form action={registerAction} style={{ display: 'grid', gap: 12, maxWidth: 460 }}>
        <div>
          <label>Email</label>
          <input name="email" type="email" required />
        </div>

        <div>
          <label>Name (optional)</label>
          <input name="name" type="text" />
        </div>

        <div>
          <label>Password (min 6 chars)</label>
          <input name="password" type="password" required minLength={6} />
        </div>

        <button className="button primary" type="submit">Create account</button>
      </form>

      <hr />
      <p className="small">Teachers/Admins θα δημιουργούνται από Admin panel/seed.</p>
    </div>
  );
}
