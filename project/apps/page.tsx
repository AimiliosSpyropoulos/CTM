import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="card">
      <h1>Turing Machine Studio (Σύνθετες Μηχανές)</h1>
      <p>
        Προσομοίωση με animation, κουμπιά step/run/pause, call-stack για σύνθετες μηχανές,
        και σύστημα εργασιών (καθηγητής/μαθητής/admin).
      </p>
      <div className="row">
        <Link className="button primary" href="/register">Create account</Link>
        <Link className="button" href="/login">Login</Link>
        <Link className="button" href="/sim">Open Simulator</Link>
      </div>
      <hr />
      <p className="small">
        Tip: Αργότερα θα βάλουμε ωραίο editor (graph + table), save/load projects, και grading UI.
      </p>
    </div>
  );
}
