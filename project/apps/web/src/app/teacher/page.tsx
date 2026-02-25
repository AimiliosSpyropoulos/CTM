import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

type Role = "STUDENT" | "TEACHER" | "ADMIN";

type SubmissionItem = {
  id: string;
  updatedAt: Date;
  grade: number | null;
  feedback: string | null;
  student: { id: string; email: string };
  assignment: { id: string; title: string };
};

export default async function TeacherSubmissionsPage({
  searchParams,
}: {
  searchParams?: { assignment?: string };
}) {
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
  if (role !== "TEACHER" && role !== "ADMIN") {
    return (
      <div className="card">
        <h2>Forbidden</h2>
        <p className="small">You don’t have access to this page.</p>
        <Link className="button" href="/dashboard">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const assignmentId = String(searchParams?.assignment ?? "").trim();

  if (!assignmentId) {
    // Αν δεν δόθηκε assignment id, δείξε λίστα assignments του teacher για να διαλέξει
    const myAssignments = await prisma.assignment.findMany({
      where: { createdById: session.uid },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, title: true },
    });

    return (
      <div className="card">
        <h2>Pick an assignment</h2>
        <p className="small">
          Open submissions from a specific assignment.
        </p>

        <div style={{ display: "grid", gap: 10 }}>
          {myAssignments.map((a: { id: string; title: string }) => (
            <div key={a.id} className="card">
              <b>{a.title}</b>
              <div style={{ marginTop: 8 }}>
                <Link
                  className="button"
                  href={`/teacher/submissions?assignment=${a.id}`}
                >
                  View submissions
                </Link>
              </div>
            </div>
          ))}

          {myAssignments.length === 0 && (
            <p className="small">You haven’t created any assignments yet.</p>
          )}
        </div>
      </div>
    );
  }

  // Επιβεβαίωση ότι το assignment ανήκει στον teacher (ή admin μπορεί να δει όλα)
  const assignment = await prisma.assignment.findFirst({
    where:
      role === "ADMIN"
        ? { id: assignmentId }
        : { id: assignmentId, createdById: session.uid },
    select: { id: true, title: true },
  });

  if (!assignment) {
    return (
      <div className="card">
        <h2>Not found</h2>
        <p className="small">
          Assignment not found (or you don’t have access).
        </p>
        <Link className="button" href="/teacher">
          Back to teacher
        </Link>
      </div>
    );
  }

  const subsRaw = await prisma.submission.findMany({
    where: { assignmentId: assignment.id },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: {
      id: true,
      updatedAt: true,
      grade: true,
      feedback: true,
      student: { select: { id: true, email: true } },
      assignment: { select: { id: true, title: true } },
    },
  });

  // Αν το prisma instance σου είναι typed ως any, αυτό το cast σταθεροποιεί τα types
  const subs = subsRaw as unknown as SubmissionItem[];

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h2>Submissions: {assignment.title}</h2>
          <p className="small">Total: {subs.length}</p>
        </div>

        <div className="row">
          <Link className="button" href="/teacher">
            Back
          </Link>
          <Link className="button" href={`/sim?assignment=${assignment.id}`}>
            Open assignment in simulator
          </Link>
        </div>
      </div>

      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        {subs.map((s: SubmissionItem) => (
          <div key={s.id} className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <b>{s.student.email}</b>
              <span className="small">
                {new Date(s.updatedAt).toLocaleString()}
              </span>
            </div>

            <div className="small" style={{ marginTop: 6 }}>
              Grade: {s.grade ?? "—"}
              {s.feedback ? ` • ${s.feedback}` : ""}
            </div>

            <div className="row" style={{ marginTop: 10 }}>
              <a
                className="button"
                href={`/sim?assignment=${s.assignment.id}&submission=${s.id}`}
              >
                Open in simulator
              </a>
            </div>
          </div>
        ))}

        {subs.length === 0 && (
          <p className="small">No submissions yet.</p>
        )}
      </div>
    </div>
  );
}
