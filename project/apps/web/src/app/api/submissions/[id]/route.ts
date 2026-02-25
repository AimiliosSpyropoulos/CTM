import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.uid) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });

  const s = await prisma.submission.findUnique({ where: { id: params.id } });
  if (!s) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  // Student can read own; teacher/admin can read any
  if (s.studentId !== session.uid && session.role !== 'TEACHER' && session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  return NextResponse.json(s);
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.uid) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  if (session.role !== 'TEACHER' && session.role !== 'ADMIN') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const body = await req.json().catch(() => null) as any;
  const grade = typeof body?.grade === 'number' ? body.grade : undefined;
  const feedback = typeof body?.feedback === 'string' ? body.feedback : undefined;
  const teacherRunJson = body?.teacherRunJson;

  const s = await prisma.submission.update({
    where: { id: params.id },
    data: {
      ...(grade !== undefined ? { grade: Math.max(0, Math.min(100, Math.round(grade))) } : {}),
      ...(feedback !== undefined ? { feedback } : {}),
      ...(teacherRunJson !== undefined ? { teacherRunJson } : {})
    }
  });

  return NextResponse.json({ ok: true, submission: s });
}
