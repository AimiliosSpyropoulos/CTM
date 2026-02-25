import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { redirect } from 'next/navigation';

const defaultSpec = {
  kind: 'base',
  id: 'm1',
  name: 'Example Machine',
  states: ['q0', 'qacc', 'qrej'],
  startState: 'q0',
  acceptStates: ['qacc'],
  rejectStates: ['qrej'],
  blank: '_',
  alphabet: ['0', '1', '_'],
  transitions: [
    { fromState: 'q0', read: '_', toState: 'qacc', write: '_', move: 'S' }
  ]
};

async function createAssignmentAction(formData: FormData) {
  'use server';
  const session = await getServerSession(authOptions);
  if (!session?.uid) throw new Error('UNAUTHENTICATED');
  if (session.role !== 'TEACHER' && session.role !== 'ADMIN') throw new Error('FORBIDDEN');

  const title = String(formData.get('title') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();
  if (!title) throw new Error('Missing title');

  const a = await prisma.assignment.create({
    data: {
      title,
      description: description || '—',
      createdById: session.uid,
      specJson: defaultSpec as any
    }
  });

  redirect(`/sim?assignment=${a.id}`);
}

export default async function TeacherPage() {
  const session = await getServerSession(authOptions);

  const myAssignments = session?.uid
    ? await prisma.assignment.findMany({ where: { createdById: session.uid }, orderBy: { createdAt: 'desc' } })
    : [];

  return (
    <div className="row" style={{ alignItems: 'flex-start' }}>
      <div className="card" style={{ flex: 1, minWidth: 340 }}>
        <h2>Create assignment</h2>
        <form action={createAssignmentAction} style={{ display: 'grid', gap: 12 }}>
          <div>
            <label>Title</label>
            <input name="title" required />
          </div>
          <div>
            <label>Description</label>
            <textarea name="description" rows={4} />
          </div>
          <button className="button primary" type="submit">Create & open</button>
        </form>
      </div>

      <div className="card" style={{ flex: 1, minWidth: 340 }}>
        <h2>My assignments</h2>
        <div style={{ display: 'grid', gap: 10 }}>
          {myAssignments.map(a => (
            <div key={a.id} className="card">
              <b>{a.title}</b>
              <div className="small">{a.description}</div>
              <div className="row" style={{ marginTop: 8 }}>
                <a className="button" href={`/sim?assignment=${a.id}`}>Open</a>
                <a className="button" href={`/teacher/submissions?assignment=${a.id}`}>Submissions</a>
              </div>
            </div>
          ))}
          {myAssignments.length === 0 && <p className="small">No assignments created yet.</p>}
        </div>
      </div>
    </div>
  );
}
