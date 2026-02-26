import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { hash } from 'bcryptjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Role = 'STUDENT' | 'TEACHER' | 'ADMIN';

type AdminUserRow = {
  id: string;
  email: string;
  role: Role;
};

async function createUserAction(formData: FormData) {
  'use server';

  const session = await getServerSession(authOptions);
  if (!session?.uid) throw new Error('UNAUTHENTICATED');
  if (session.role !== 'ADMIN') throw new Error('FORBIDDEN');

  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const roleRaw = String(formData.get('role') ?? 'STUDENT').toUpperCase();
  const password = String(formData.get('password') ?? '');

  const role: Role = (['STUDENT', 'TEACHER', 'ADMIN'] as const).includes(roleRaw as any)
    ? (roleRaw as Role)
    : 'STUDENT';

  if (!email || password.length < 6) throw new Error('Invalid input');

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) throw new Error('Email already exists');

  const passwordHash = await hash(password, 10);
  await prisma.user.create({
    data: { email, passwordHash, role }
  });
}

export default async function AdminPage() {
  const session = await getServerSession(authOptions);

  if (!session?.uid) {
    return (
      <div className="card">
        <h2>Not signed in</h2>
        <Link className="button" href="/login">Login</Link>
      </div>
    );
  }

  if (session.role !== 'ADMIN') {
    return (
      <div className="card">
        <h2>Forbidden</h2>
        <p className="small">You don’t have access to this page.</p>
      </div>
    );
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    take: 25,
    select: { id: true, email: true, role: true }
  });

  return (
    <div className="row" style={{ alignItems: 'flex-start' }}>
      <div className="card" style={{ flex: 1, minWidth: 340 }}>
        <h2>Admin</h2>
        <p className="small">Create users (teachers/admins) — no email verification.</p>

        <form action={createUserAction} style={{ display: 'grid', gap: 12, maxWidth: 460 }}>
          <div>
            <label>Email</label>
            <input name="email" type="email" required />
          </div>

          <div>
            <label>Role</label>
            <select name="role" defaultValue="TEACHER">
              <option value="TEACHER">TEACHER</option>
              <option value="STUDENT">STUDENT</option>
              <option value="ADMIN">ADMIN</option>
            </select>
          </div>

          <div>
            <label>Password</label>
            <input name="password" type="password" required minLength={6} />
          </div>

          <button className="button primary" type="submit">Create user</button>
        </form>
      </div>

      <div className="card" style={{ flex: 1, minWidth: 340 }}>
        <h2>Latest users</h2>
        <div style={{ display: 'grid', gap: 10 }}>
          {(users as AdminUserRow[]).map((u) => (
            <div key={u.id} className="card">
              <b>{u.email}</b>
              <div className="small">Role: {u.role}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
