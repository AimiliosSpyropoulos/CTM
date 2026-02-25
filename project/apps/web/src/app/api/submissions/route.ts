import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.uid) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });

  const body = await req.json().catch(() => null) as any;
  const assignmentId = body?.assignmentId as string | undefined;
  const solutionJson = body?.solutionJson;
  if (!assignmentId || solutionJson == null) return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });

  const submission = await prisma.submission.upsert({
    where: { assignmentId_studentId: { assignmentId, studentId: session.uid } },
    create: { assignmentId, studentId: session.uid, solutionJson },
    update: { solutionJson }
  });

  return NextResponse.json({ id: submission.id });
}
