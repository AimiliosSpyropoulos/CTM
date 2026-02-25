import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export default async function SubmissionsPage({ searchParams }: { searchParams: { assignment?: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.uid) return <div className="card"><h2>Not signed in</h2></div>;
  if (session.role !== 'TEACHER' && session.role !== 'ADMIN') return <div className="card"><h2>Forbidden</h2></div>;

  const assignmentId = searchParams.assignment;
  if (!assignmentId) {
    return (
      <div className="card">
        <h2>Missing assignment</h2>
        <p className="small">Open this page from Teacher → "Submissions".</p>
      </div>
    );
  }

  const assignment = await prisma.assignment.findUnique({ where: { id: assignmentId } });
  const subs = await prisma.submission.findMany({
    where: { assignmentId },
    include: { student: true },
    orderBy: { updatedAt: 'desc' }
  });

  return (
    <div className="card">
      <h2>Submissions: {assignment?.title ?? assignmentId}</h2>
      <div style={{ display: 'grid', gap: 10 }}>
        {subs.map(s => (
          <div key={s.id} className="card">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <b>{s.student.email}</b>
                <div className="small">Updated: {s.updatedAt.toISOString()}</div>
              </div>
              <div className="row">
                <span className="badge">Grade: {s.grade ?? '—'}</span>
                <Link className="button" href={`/sim?assignment=${assignmentId}&submission=${s.id}&mode=grade`}>Open for grading</Link>
              </div>
            </div>
          </div>
        ))}
        {subs.length === 0 && <p className="small">No submissions yet.</p>}
      </div>
    </div>
  );
}
