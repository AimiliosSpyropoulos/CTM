'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  initRuntime,
  stepRuntime,
  tapeToString,
  validateSpec,
  type BaseMachine,
  type MachineSpec,
  type Runtime,
  type StepAction
} from '@tm-studio/tm-engine';
import { useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { GraphEditor } from '@/components/tm/GraphEditor';
import { CompositeEditor } from '@/components/tm/CompositeEditor';

function safeJsonParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export default function SimPage() {
  export default function SimPage() {
  const params = useSearchParams();

  const assignmentId = params?.get('assignment');
  const submissionId = params?.get('submission');
  const mode = params?.get('mode') ?? 'solve';

  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState<string>('Simulator');
  const [description, setDescription] = useState<string>('');
  const [specText, setSpecText] = useState<string>('');
  const [tapeInputs, setTapeInputs] = useState<string[]>(['']);
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [haltedReason, setHaltedReason] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<StepAction | null>(null);
  const [selectedFrame, setSelectedFrame] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef<number | null>(null);

  // Step 6: timeline / replay
  const [history, setHistory] = useState<Runtime[]>([]);
  const [historyActions, setHistoryActions] = useState<(StepAction | null)[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(0);
  const historyLimit = 2000;

  const historyRef = useRef<Runtime[]>([]);
  const historyActionsRef = useRef<(StepAction | null)[]>([]);
  const historyIndexRef = useRef(0);

  const [speedMs, setSpeedMs] = useState(80);
  const [maxSteps, setMaxSteps] = useState(5000);
  const [breakpointsText, setBreakpointsText] = useState('');
  const [editorMode, setEditorMode] = useState<'visual' | 'json'>('visual');

  // Step 5: "debugger" style controls
  const [followRuntime, setFollowRuntime] = useState(true);
  const [pauseOnCall, setPauseOnCall] = useState(true);
  const [pauseOnReturn, setPauseOnReturn] = useState(false);

  function pushHistorySnapshot(nextRuntime: Runtime, action: StepAction | null) {
    let h = historyRef.current;
    let a = historyActionsRef.current;
    const idx = historyIndexRef.current;

    // If the user scrubbed the timeline, truncate future history (branching)
    if (idx < h.length - 1) {
      h = h.slice(0, idx + 1);
      a = a.slice(0, idx + 1);
    }

    h = [...h, structuredClone(nextRuntime)];
    a = [...a, action];

    if (h.length > historyLimit) {
      h = h.slice(h.length - historyLimit);
      a = a.slice(a.length - historyLimit);
    }

    historyRef.current = h;
    historyActionsRef.current = a;
    const newIdx = h.length - 1;
    historyIndexRef.current = newIdx;
    setHistory(h);
    setHistoryActions(a);
    setHistoryIndex(newIdx);
  }

  function scrubTo(i: number) {
    const h = historyRef.current;
    const a = historyActionsRef.current;
    const idx = Math.max(0, Math.min(i, h.length - 1));
    setRunning(false);
    const snap = h[idx];
    if (!snap) return;
    setRuntime(structuredClone(snap));
    setLastAction(a[idx] ?? null);
    setHaltedReason(null);
    setSelectedFrame(snap.frames.length - 1);
    setHistoryIndex(idx);
    historyIndexRef.current = idx;
  }

  // load assignment + optionally submission
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setHaltedReason(null);
      try {
        if (!assignmentId) {
          setSpecText(JSON.stringify({
            kind: 'base', id: 'm1', name: 'Scratch',
            states: ['q0','qacc','qrej'], startState: 'q0', acceptStates: ['qacc'], rejectStates: ['qrej'],
            blank: '_', alphabet: ['0','1','_'], transitions: [{ fromState:'q0', read:'_', toState:'qacc', write:'_', move:'S'}]
          }, null, 2));
          setTitle('Scratch simulator');
          setDescription('');
          return;
        }

        const aRes = await fetch(`/api/assignments/${assignmentId}`);
        if (aRes.status === 401) {
          // trigger login page
          await signIn(undefined, { callbackUrl: `/sim?assignment=${assignmentId}` });
          return;
        }
        const a = await aRes.json();
        if (cancelled) return;
        setTitle(a.title);
        setDescription(a.description);

        let spec = a.spec;

        if (submissionId) {
          const sRes = await fetch(`/api/submissions/${submissionId}`);
          const s = await sRes.json();
          if (s?.solutionJson) spec = s.solutionJson;
        }

        setSpecText(JSON.stringify(spec, null, 2));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [assignmentId, submissionId]);

  // run loop
  const breakpoints = useMemo(() => {
    return breakpointsText
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  }, [breakpointsText]);

  function pushHistoryNow(nextRuntime: Runtime, action: StepAction | null) {
    // If the user scrubbed back in time, branch the timeline from the current index.
    let h = historyRef.current;
    let a = historyActionsRef.current;
    const idx = historyIndexRef.current;
    if (idx < h.length - 1) {
      h = h.slice(0, idx + 1);
      a = a.slice(0, idx + 1);
    }

    h = [...h, structuredClone(nextRuntime)];
    a = [...a, action];

    if (h.length > historyLimit) {
      const start = h.length - historyLimit;
      h = h.slice(start);
      a = a.slice(start);
    }

    const newIdx = h.length - 1;
    historyRef.current = h;
    historyActionsRef.current = a;
    historyIndexRef.current = newIdx;
    setHistory(h);
    setHistoryActions(a);
    setHistoryIndex(newIdx);
  }

  function toggleBreakpoint(machineId: string, state: string) {
    const key = `${machineId}:${state}`;
    const set = new Set(breakpoints);
    if (set.has(key)) set.delete(key);
    else set.add(key);
    setBreakpointsText(Array.from(set).sort().join(', '));
  }

  useEffect(() => {
    if (!running) {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }
    intervalRef.current = window.setInterval(() => {
      setRuntime(prev => {
        if (!prev) return prev;
        const r = structuredClone(prev);
        const res = stepRuntime(r);
        setLastAction(res.action ?? null);
        setSelectedFrame(r.frames.length - 1);

        // timeline capture
        pushHistoryNow(r, res.action ?? null);

        // debugger-style pauses for composite machines
        if (res.action?.type === 'CALL' && pauseOnCall) {
          setRunning(false);
        }
        if (res.action?.type === 'RETURN' && pauseOnReturn) {
          setRunning(false);
        }

        if (res.halted) {
          setRunning(false);
          setHaltedReason(res.haltingReason ?? 'HALT');
          return r;
        }

        // breakpoint check (only when not halted)
        const top = r.frames[r.frames.length - 1];
        if (breakpoints.length && breakpoints.includes(`${top.machineId}:${top.state}`)) {
          setRunning(false);
        }
        return r;
      });
    }, Math.max(10, speedMs));

    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [running, speedMs, breakpoints, pauseOnCall, pauseOnReturn]);

  const spec = useMemo(() => safeJsonParse<MachineSpec>(specText), [specText]);

  const tapesK = useMemo(() => {
    const k = Number((spec as any)?.tapes ?? 1);
    return Number.isFinite(k) && k > 0 ? Math.min(10, Math.max(1, k)) : 1;
  }, [spec]);

  const validation = useMemo(() => (spec ? validateSpec(spec) : null), [spec]);

  useEffect(() => {
    // keep tapeInputs length in sync with spec.tapes
    setTapeInputs(prev => {
      const next = prev.slice(0, tapesK);
      while (next.length < tapesK) next.push('');
      return next;
    });
  }, [tapesK]);

  const tapeWindows = useMemo(() => {
    if (!runtime) return null;
    return runtime.tapes.map((t) => tapeToString(t, 18));
  }, [runtime]);

  const activeRuntimeMachineId = useMemo(() => {
    if (!runtime) return null;
    return runtime.frames[runtime.frames.length - 1]?.machineId ?? null;
  }, [runtime]);

  function reset() {
    setHaltedReason(null);
    setLastAction(null);
    if (!spec) return;
    if (validation && !validation.ok) {
      alert(`Spec has errors:\n\n${validation.errors.slice(0, 20).join('\n')}${validation.errors.length > 20 ? '\n…' : ''}`);
      return;
    }
    const r = initRuntime(spec, tapeInputs, maxSteps);
    setRuntime(r);
    setSelectedFrame(r.frames.length - 1);
    const snap = structuredClone(r);
    historyRef.current = [snap];
    historyActionsRef.current = [null];
    historyIndexRef.current = 0;
    setHistory([snap]);
    setHistoryActions([null]);
    setHistoryIndex(0);
  }

  function stepOnce() {
    setRuntime(prev => {
      if (!prev) return prev;
      const r = structuredClone(prev);
      const res = stepRuntime(r);
      setLastAction(res.action ?? null);
      if (res.halted) setHaltedReason(res.haltingReason ?? 'HALT');
      setSelectedFrame(r.frames.length - 1);

      pushHistoryNow(r, res.action ?? null);
      return r;
    });
  }

  async function saveSubmission() {
    if (!assignmentId) return;
    if (!spec) {
      alert('Invalid JSON spec');
      return;
    }
    const res = await fetch('/api/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignmentId, solutionJson: spec })
    });
    const data = await res.json();
    if (data?.id) {
      alert('Saved!');
      window.location.href = `/sim?assignment=${assignmentId}&submission=${data.id}`;
    } else {
      alert('Save failed');
    }
  }

  async function gradeSubmission() {
    if (!submissionId) return;
    const gradeStr = prompt('Grade 0-100:');
    if (gradeStr == null) return;
    const grade = Number(gradeStr);
    const feedback = prompt('Feedback (optional):') ?? undefined;
    const res = await fetch(`/api/submissions/${submissionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grade, feedback })
    });
    if (res.ok) alert('Graded!');
    else alert('Grade failed');
  }

  return (
    <div className="row" style={{ alignItems: 'flex-start' }}>
      <div className="card" style={{ flex: 1, minWidth: 360 }}>
        <h2>{title}</h2>
        {description && <p className="small">{description}</p>}

        <div className="row" style={{ marginTop: 8 }}>
          <button className="button" onClick={reset} disabled={!spec}>Reset</button>
          <button className="button" onClick={stepOnce} disabled={!runtime}>Step</button>
          <button className="button" onClick={() => setRunning(true)} disabled={!runtime || running}>Run</button>
          <button className="button" onClick={() => setRunning(false)} disabled={!running}>Pause</button>
          {assignmentId && mode !== 'grade' && <button className="button primary" onClick={saveSubmission}>Save submission</button>}
          {mode === 'grade' && submissionId && <button className="button primary" onClick={gradeSubmission}>Grade</button>}
        </div>

        <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
          <div>
            <label>Input tapes</label>
            <div className="small" style={{ marginBottom: 6, opacity: 0.85 }}>
              This machine uses <b>{tapesK}</b> tape{tapesK === 1 ? '' : 's'}. Tape 1 is the main input; the rest can start empty (or you can prefill them).
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {Array.from({ length: tapesK }, (_, i) => (
                <div key={i} style={{ display: 'grid', gap: 4 }}>
                  <div className="small">Tape {i + 1}</div>
                  <input
                    value={tapeInputs[i] ?? ''}
                    onChange={e => setTapeInputs(prev => {
                      const next = [...prev];
                      next[i] = e.target.value;
                      return next;
                    })}
                    placeholder={i === 0 ? 'e.g. 0011' : 'optional (leave empty if not needed)'}
                  />
                </div>
              ))}
            </div>
            <div className="small" style={{ marginTop: 6 }}>Blank symbol: "_" (default)</div>
          </div>

          {validation && !validation.ok && (
            <div className="card" style={{ border: '1px solid rgba(255,0,0,0.35)' }}>
              <b style={{ color: 'rgb(180,0,0)' }}>Spec validation errors</b>
              <div className="small" style={{ marginTop: 6 }}>
                Fix these before running. Showing first {Math.min(12, validation.errors.length)}.
              </div>
              <ul className="small" style={{ marginTop: 6 }}>
                {validation.errors.slice(0, 12).map((e, idx) => (
                  <li key={idx}>{e}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="card">
            <b>Runtime</b>
            {loading && <div className="small">Loading…</div>}
            {!loading && !runtime && <div className="small">Press Reset to initialize runtime.</div>}
            {runtime && (
              <>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="badge">step: {runtime.step}</span>
                  {haltedReason && <span className="badge">HALT: {haltedReason}</span>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
                  <div>
                    <label className="small">Speed (ms/step)</label>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <input
                        type="range"
                        min={10}
                        max={500}
                        step={5}
                        value={speedMs}
                        onChange={(e) => setSpeedMs(Number(e.target.value))}
                        style={{ flex: 1 }}
                      />
                      <input
                        type="number"
                        min={10}
                        max={2000}
                        value={speedMs}
                        onChange={e => setSpeedMs(Number(e.target.value))}
                        style={{ width: 90 }}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="small">Max steps</label>
                    <input
                      type="number"
                      min={1}
                      value={maxSteps}
                      onChange={e => setMaxSteps(Number(e.target.value))}
                    />
                  </div>
                </div>
                <div style={{ marginTop: 10 }}>
                  <label className="small">Breakpoints (comma separated, format machineId:state)</label>
                  <input
                    value={breakpointsText}
                    onChange={e => setBreakpointsText(e.target.value)}
                    placeholder="e.g. m1:q5, add:q0"
                  />
                  <div className="small" style={{ marginTop: 6, opacity: 0.85 }}>
                    Tip: Alt/Option-click (or ⌘-click) a state in the graph to toggle a breakpoint.
                  </div>
                </div>

                <div style={{ marginTop: 12 }}>
                  <div className="small">Timeline / replay</div>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                    <button className="button" onClick={() => scrubTo(0)} disabled={history.length <= 1 || historyIndex === 0}>|&lt;</button>
                    <button className="button" onClick={() => scrubTo(Math.max(0, historyIndex - 1))} disabled={history.length <= 1 || historyIndex === 0}>&lt;</button>
                    <button className="button" onClick={() => scrubTo(Math.min(history.length - 1, historyIndex + 1))} disabled={history.length <= 1 || historyIndex >= history.length - 1}>&gt;</button>
                    <button className="button" onClick={() => scrubTo(history.length - 1)} disabled={history.length <= 1 || historyIndex >= history.length - 1}>&gt;|</button>
                    <span className="badge">{history.length ? `${historyIndex + 1}/${history.length}` : '0/0'}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, history.length - 1)}
                    value={Math.min(historyIndex, Math.max(0, history.length - 1))}
                    onChange={(e) => scrubTo(Number(e.target.value))}
                    disabled={history.length <= 1}
                    style={{ width: '100%', marginTop: 8 }}
                  />
                  <div className="small" style={{ marginTop: 6, opacity: 0.85 }}>
                    Scrubbing pauses execution and lets you replay past steps. If you scrub back and press Step/Run, the timeline branches from there.
                  </div>
                </div>

                <div className="row" style={{ gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
                  <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="checkbox" checked={followRuntime} onChange={(e) => setFollowRuntime(e.target.checked)} />
                    Follow runtime in editor
                  </label>
                  <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="checkbox" checked={pauseOnCall} onChange={(e) => setPauseOnCall(e.target.checked)} />
                    Pause on CALL
                  </label>
                  <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="checkbox" checked={pauseOnReturn} onChange={(e) => setPauseOnReturn(e.target.checked)} />
                    Pause on RETURN
                  </label>
                </div>
                {lastAction && (
                  <div style={{ marginTop: 10 }}>
                    <div className="small">Last action</div>
                    <pre style={{ marginTop: 6 }}>{JSON.stringify(lastAction, null, 2)}</pre>
                  </div>
                )}
                <hr />
                <div className="small">Call stack (top = current) — click a frame to inspect</div>
                <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                  {runtime.frames.map((f, i) => {
                    const isTop = i === runtime.frames.length - 1;
                    const isSel = (selectedFrame ?? runtime.frames.length - 1) === i;
                    return (
                      <button
                        key={`${f.machineId}:${i}`}
                        className={`button ${isSel ? 'primary' : ''}`}
                        onClick={() => setSelectedFrame(i)}
                        style={{ justifyContent: 'space-between' }}
                      >
                        <span>{isTop ? '➡ ' : ''}{f.machineId}:{f.state}</span>
                        {f.returnState && <span className="badge">return→{f.returnState}</span>}
                      </button>
                    );
                  })}
                </div>

                {runtime.spec.kind === 'composite' && selectedFrame != null && runtime.frames[selectedFrame] && (
                  <div className="card" style={{ marginTop: 10, padding: 10 }}>
                    <div className="small">Frame inspector</div>
                    <div style={{ marginTop: 6 }}>
                      <div><b>machineId:</b> {runtime.frames[selectedFrame].machineId}</div>
                      <div><b>state:</b> {runtime.frames[selectedFrame].state}</div>
                      {runtime.frames[selectedFrame].returnState && (
                        <div><b>returnState:</b> {runtime.frames[selectedFrame].returnState}</div>
                      )}
                    </div>
                  </div>
                )}
                <hr />
                <div className="small">Tape window</div>
                {tapeWindows && (
                  <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
                    {tapeWindows.map((w, idx) => (
                      <div key={idx} className="card" style={{ padding: 10 }}>
                        <div className="small" style={{ marginBottom: 6 }}>Tape {idx + 1}</div>
                        <pre style={{ margin: 0 }}>
                          {w.text}
                          {' '.repeat(runtime.tapes[idx].head - w.min) + '^'}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ flex: 1, minWidth: 360 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Machine editor</h3>
          <div className="row" style={{ gap: 8 }}>
            <button
              className={`button ${editorMode === 'visual' ? 'primary' : ''}`}
              onClick={() => setEditorMode('visual')}
            >
              Visual
            </button>
            <button
              className={`button ${editorMode === 'json' ? 'primary' : ''}`}
              onClick={() => setEditorMode('json')}
            >
              JSON
            </button>
          </div>
        </div>

        {editorMode === 'visual' && (
          <VisualEditor
            spec={spec}
            onChangeSpec={next => setSpecText(JSON.stringify(next, null, 2))}
            lastAction={lastAction}
            activeRuntimeMachineId={activeRuntimeMachineId}
            followRuntime={followRuntime}
            breakpoints={breakpoints}
            onToggleBreakpoint={toggleBreakpoint}
          />
        )}

        {editorMode === 'json' && (
          <>
            <textarea
              value={specText}
              onChange={e => setSpecText(e.target.value)}
              rows={28}
              style={{ width: '100%', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas', fontSize: 12 }}
            />
            {!spec && <p className="small">⚠️ Invalid JSON</p>}
          </>
        )}
      </div>
    </div>
  );
}

function VisualEditor({
  spec,
  onChangeSpec,
  lastAction,
  activeRuntimeMachineId,
  followRuntime,
  breakpoints,
  onToggleBreakpoint
}: {
  spec: MachineSpec | null;
  onChangeSpec: (next: MachineSpec) => void;
  lastAction: StepAction | null;
  activeRuntimeMachineId: string | null;
  followRuntime: boolean;
  breakpoints: string[];
  onToggleBreakpoint: (machineId: string, state: string) => void;
}) {
  if (!spec) return <p className="small">⚠️ Invalid JSON</p>;

  if (spec.kind === 'composite') {
    return (
      <CompositeEditor
        spec={spec}
        onChangeSpec={(next) => onChangeSpec(next)}
        lastAction={lastAction}
        activeRuntimeMachineId={activeRuntimeMachineId}
        followRuntime={followRuntime}
        breakpoints={breakpoints}
        onToggleBreakpoint={onToggleBreakpoint}
      />
    );
  }

  const bm: BaseMachine = spec;

  const highlight = lastAction?.type === 'STEP' ? lastAction : null;

  const k = Number((bm as any).tapes ?? 1);
  const tupleToText = (v: any) => Array.isArray(v) ? v.join(',') : String(v);
  const parseSymbols = (raw: string): any => k <= 1 ? raw : raw.split(',').map(s => s.trim());
  const parseMoves = (raw: string): any => {
    if (k <= 1) return raw.trim().toUpperCase();
    const arr = raw.split(',').map(s => s.trim().toUpperCase());
    return arr;
  };

  const [visualTab, setVisualTab] = useState<'table' | 'graph'>('graph');

  function updateTransition(i: number, patch: Partial<BaseMachine['transitions'][number]>) {
    const next: BaseMachine = {
      ...bm,
      transitions: bm.transitions.map((t, idx) => (idx === i ? { ...t, ...patch } : t))
    };
    onChangeSpec(next);
  }

  function addRow() {
    const kk = Number((bm as any).tapes ?? 1);
    const read = kk === 1 ? bm.blank : Array.from({ length: kk }, () => bm.blank);
    const write = kk === 1 ? bm.blank : Array.from({ length: kk }, () => bm.blank);
    const move = kk === 1 ? 'S' : Array.from({ length: kk }, () => 'S');
    const next: BaseMachine = {
      ...bm,
      transitions: [
        ...bm.transitions,
        { fromState: bm.startState, read: read as any, toState: bm.startState, write: write as any, move: move as any }
      ]
    };
    onChangeSpec(next);
  }

  function removeRow(i: number) {
    const next: BaseMachine = { ...bm, transitions: bm.transitions.filter((_, idx) => idx !== i) };
    onChangeSpec(next);
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div className="small">Kind: base • Machine: {bm.id} • Start: {bm.startState}</div>

      <div className="row" style={{ gap: 10, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
        <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          Tapes
          <input
            type="number"
            min={1}
            max={10}
            value={k}
            onChange={(e) => onChangeSpec({ ...bm, tapes: Math.max(1, Number(e.target.value) || 1) })}
            style={{ width: 80 }}
          />
        </label>
        {k > 1 && (
          <span className="small" style={{ opacity: 0.85 }}>
            For {k}-tape transitions, use comma-separated tuples in Table (e.g. read: 0,_, write: 0,_, move: R,S). Graph connect prompts support tuples too.
          </span>
        )}
      </div>

      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
        <b>Editor</b>
        <div className="row" style={{ gap: 8 }}>
          <button
            className={`button ${visualTab === 'graph' ? 'primary' : ''}`}
            onClick={() => setVisualTab('graph')}
          >
            Graph
          </button>
          <button
            className={`button ${visualTab === 'table' ? 'primary' : ''}`}
            onClick={() => setVisualTab('table')}
          >
            Table
          </button>
        </div>
      </div>

      {visualTab === 'graph' && (
        <GraphEditor
          spec={bm}
          onChangeSpec={(next) => onChangeSpec(next)}
          highlight={highlight?.type === 'STEP' ? highlight : null}
          focusOnHighlight={true}
          breakpointStates={new Set(breakpoints.filter((bp) => bp.startsWith(`${bm.id}:`)).map((bp) => bp.slice(bm.id.length + 1)))}
          onToggleBreakpoint={(stateId) => onToggleBreakpoint(bm.id, stateId)}
        />
      )}

      {visualTab === 'table' && (
        <>

          <div className="row" style={{ justifyContent: 'space-between', marginTop: 10 }}>
            <b>Transitions</b>
            <button className="button" onClick={addRow}>+ Add</button>
          </div>

          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th align="left">from</th>
              <th align="left">read</th>
              <th align="left">to</th>
              <th align="left">write</th>
              <th align="left">move</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {bm.transitions.map((t, i) => {
              const isHi = !!(
                highlight &&
                highlight.machineId === bm.id &&
                highlight.fromState === t.fromState &&
                tupleToText(highlight.read) === tupleToText(t.read)
              );
              return (
                <tr key={i} style={{ background: isHi ? 'rgba(99, 102, 241, 0.12)' : undefined }}>
                  <td>
                    <input value={t.fromState} onChange={e => updateTransition(i, { fromState: e.target.value })} />
                  </td>
                  <td>
                    <input value={tupleToText(t.read)} onChange={e => updateTransition(i, { read: parseSymbols(e.target.value) as any })} style={{ width: 140 }} />
                  </td>
                  <td>
                    <input value={t.toState} onChange={e => updateTransition(i, { toState: e.target.value })} />
                  </td>
                  <td>
                    <input value={tupleToText(t.write)} onChange={e => updateTransition(i, { write: parseSymbols(e.target.value) as any })} style={{ width: 140 }} />
                  </td>
                  <td>
                    <input value={tupleToText(t.move)} onChange={e => updateTransition(i, { move: parseMoves(e.target.value) as any })} style={{ width: 120 }} />
                  </td>
                  <td align="right">
                    <button className="button" onClick={() => removeRow(i)}>Remove</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
            </table>
          </div>

          <div style={{ marginTop: 10 }}>
            <details>
              <summary className="small">Quick tips</summary>
              <ul className="small">
                <li>Στο graph: σύρε states, και κάνε connect για να προσθέσεις transition.</li>
                <li>Το highlight πιάνει το τελευταίο STEP (όχι CALL/RETURN).</li>
                <li>Για "no transition" σε ένα state/symbol, απλά μην έχεις γραμμή.</li>
                <li>Blank είναι {JSON.stringify(bm.blank)} — βάλε το στα read/write όπου χρειάζεται.</li>
              </ul>
            </details>
          </div>
        </>
      )}
    </div>
  );
}
