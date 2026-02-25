import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.uid) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });

  const a = await prisma.assignment.findUnique({ where: { id: params.id } });
  if (!a) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  return NextResponse.json({
    id: a.id,
    title: a.title,
    description: a.description,
    spec: a.specJson,
    dueAt: a.dueAt
  });
}
