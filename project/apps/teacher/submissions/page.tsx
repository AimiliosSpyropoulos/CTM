import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

type Role = "STUDENT" | "TEACHER" | "ADMIN";

type AssignmentHead = {
  id: string;
  title: string;
};

type SubmissionItem = {
  id: string;
  updatedAt: Date;
  grade: number | null;
  student: {
    id: string;
    email: string;
  };
};

export default async function SubmissionsPage({
  searchParams,
}: {
  searchParams: { assignment?: string };
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
      </div>
    );
  }

  const assignmentId = String(searchParams.assignment ?? "").trim();
  if (!assignmentId) {
    return (
      <div className="card">
        <h2>Missing assignment</h2>
        <p className="small">Open this page from Teacher → “Submissions”.</p>
      </div>
    );
  }

  // (προαιρετικά, αλλά σωστό) Teacher βλέπει μόνο assignments που έφτιαξε.
  // Admin βλέπει όλα.
  const assignmentRaw = await prisma.assignment.findFirst({
    where:
      role === "ADMIN"
        ? { id: assignmentId }
        : { id: assignmentId, createdById: session.uid },
    select: { id: true, title: true },
  });

  const assignment: AssignmentHead | null =
    (assignmentRaw as unknown as AssignmentHead | null) ?? null;

  if (!assignment) {
    return (
      <div className="card">
        <h2>Not found</h2>
        <p className="small">
          Assignment not found (or you don’t have access).
        </p>
        <Link className="button" href="/teacher">
          Back
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
      student: { select: { id: true, email: true } },
    },
  });

  const subs: SubmissionItem[] = subsRaw as unknown as SubmissionItem[];

  return (
    <div className="card">
      <h2>Submissions: {assignment.title}</h2>

      <div style={{ display: "grid", gap: 10 }}>
        {subs.map((s: SubmissionItem) => (
          <div key={s.id} className="card">
            <div
              className="row"
              style={{ justifyContent: "space-between", alignItems: "center" }}
            >
              <div>
                <b>{s.student.email}</b>
                <div className="small">
                  Updated: {new Date(s.updatedAt).toISOString()}
                </div>
              </div>

              <div className="row">
                <span className="badge">Grade: {s.grade ?? "—"}</span>
                <Link
                  className="button"
                  href={`/sim?assignment=${assignment.id}&submission=${s.id}&mode=grade`}
                >
                  Open for grading
                </Link>
              </div>
            </div>
          </div>
        ))}

        {subs.length === 0 && <p className="small">No submissions yet.</p>}
      </div>
    </div>
  );
}
