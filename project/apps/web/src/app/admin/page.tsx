import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { hash } from 'bcryptjs';

async function createUserAction(formData: FormData) {
  'use server';
  const session = await getServerSession(authOptions);
  if (!session?.uid) throw new Error('UNAUTHENTICATED');
  if (session.role !== 'ADMIN') throw new Error('FORBIDDEN');

  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const role = String(formData.get('role') ?? 'STUDENT');
  const password = String(formData.get('password') ?? '');
  if (!email || password.length < 6) throw new Error('Invalid input');

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) throw new Error('Email already exists');

  const passwordHash = await hash(password, 10);
  await prisma.user.create({
    data: { email, passwordHash, role: role as any }
  });
}

export default async function AdminPage() {
  const session = await getServerSession(authOptions);
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'desc' }, take: 25 });

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
          {users.map(u => (
            <div key={u.id} className="card">
              <b>{u.email}</b>
              <div className="small">Role: {u.role}</div>
              <div className="small">Created: {u.createdAt.toISOString()}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
