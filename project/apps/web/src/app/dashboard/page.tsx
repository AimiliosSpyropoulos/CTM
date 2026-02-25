import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

type AssignmentRow = {
  id: string
  title: string
  description?: string | null
  createdAt?: string
}

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.uid) {
    return (
      <div className="card">
        <h2>Not signed in</h2>
        <Link className="button" href="/login">Login</Link>
      </div>
    );
  }

  const role = session.role;
  const uid = session.uid;

  const assignments =
    role === 'TEACHER' || role === 'ADMIN'
      ? await prisma.assignment.findMany({
          where: { createdById: uid },
          orderBy: { createdAt: 'desc' },
          take: 20
        })
      : await prisma.assignment.findMany({
          orderBy: { createdAt: 'desc' },
          take: 20
        });

  const submissions = await prisma.submission.findMany({
    where: { studentId: uid },
    include: { assignment: true },
    orderBy: { updatedAt: 'desc' },
    take: 20
  });

  return (
    <div className="row" style={{ alignItems: 'flex-start' }}>
      <div className="card" style={{ flex: 1, minWidth: 320 }}>
        <h2>Assignments</h2>
        <p className="small">Role: {role}</p>
        <div style={{ display: 'grid', gap: 10 }}>
          {(assignments as AssignmentRow[]).map((a: AssignmentRow) => (
  <div key={a.id} className="card">
    <b>{a.title}</b>
    <div className="small">{a.description}</div>
  </div>
))}
          {assignments.length === 0 && <p className="small">No assignments yet.</p>}
        </div>
      </div>

      <div className="card" style={{ flex: 1, minWidth: 320 }}>
        <h2>My Submissions</h2>
        <div style={{ display: 'grid', gap: 10 }}>
          {submissions.map(s => (
            <div key={s.id} className="card">
              <b>{s.assignment.title}</b>
              <div className="small">Updated: {s.updatedAt.toISOString()}</div>
              <div className="small">Grade: {s.grade ?? '—'}</div>
              <div className="row" style={{ marginTop: 8 }}>
                <Link className="button" href={`/sim?assignment=${s.assignmentId}&submission=${s.id}`}>Open submission</Link>
              </div>
            </div>
          ))}
          {submissions.length === 0 && <p className="small">No submissions yet.</p>}
        </div>
      </div>
    </div>
  );
}
