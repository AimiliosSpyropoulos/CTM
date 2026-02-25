import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

type Role = "STUDENT" | "TEACHER" | "ADMIN";

type AssignmentRow = {
  id: string;
  title: string;
  description?: string | null;
};

type SubmissionRow = {
  id: string;
  updatedAt: Date;
  grade?: number | null;
  assignment: {
    id: string;
    title: string;
  };
};

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);

  if (!session?.uid) {
    return (
      <div className="card">
        <h2>Not signed in</h2>
        <Link className="button" href="/login">
          Login
        </Link>
      </div>
    );
  }

  const role = session.role as Role;
  const uid = session.uid;

  const assignmentsRaw =
    role === "TEACHER" || role === "ADMIN"
      ? await prisma.assignment.findMany({
          where: { createdById: uid },
          orderBy: { createdAt: "desc" },
          take: 20,
          select: { id: true, title: true, description: true },
        })
      : await prisma.assignment.findMany({
          orderBy: { createdAt: "desc" },
          take: 20,
          select: { id: true, title: true, description: true },
        });

  const assignments: AssignmentRow[] = assignmentsRaw;

  const submissionsRaw = await prisma.submission.findMany({
    where: { studentId: uid },
    include: { assignment: { select: { id: true, title: true } } },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });

  const submissions: SubmissionRow[] = submissionsRaw.map((s) => ({
    id: s.id,
    updatedAt: s.updatedAt,
    grade: s.grade,
    assignment: { id: s.assignment.id, title: s.assignment.title },
  }));

  return (
    <div className="row" style={{ alignItems: "flex-start" }}>
      <div className="card" style={{ flex: 1, minWidth: 320 }}>
        <h2>Assignments</h2>
        <p className="small">Role: {role}</p>

        <div style={{ display: "grid", gap: 10 }}>
          {assignments.map((a) => (
            <div key={a.id} className="card">
              <b>{a.title}</b>
              {a.description && <div className="small">{a.description}</div>}
              <div style={{ marginTop: 8 }}>
                <Link className="button" href={`/sim?assignment=${a.id}`}>
                  Open in Simulator
                </Link>
              </div>
            </div>
          ))}

          {assignments.length === 0 && (
            <p className="small">No assignments yet.</p>
          )}
        </div>
      </div>

      <div className="card" style={{ flex: 1, minWidth: 320 }}>
        <h2>My Submissions</h2>

        <div style={{ display: "grid", gap: 10 }}>
          {submissions.map((s) => (
            <div key={s.id} className="card">
              <b>{s.assignment.title}</b>
              <div className="small">
                Updated: {new Date(s.updatedAt).toLocaleString()}
              </div>
              <div className="small">
                Grade: {s.grade ?? "—"}
              </div>
              <div style={{ marginTop: 8 }}>
                <Link
                  className="button"
                  href={`/sim?assignment=${s.assignment.id}&submission=${s.id}`}
                >
                  View Submission
                </Link>
              </div>
            </div>
          ))}

          {submissions.length === 0 && (
            <p className="small">No submissions yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
