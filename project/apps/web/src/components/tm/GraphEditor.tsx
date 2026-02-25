/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  MarkerType,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type OnConnect,
  type ReactFlowInstance
} from 'reactflow';
import 'reactflow/dist/style.css';

import type { BaseMachine, StepAction } from '@tm-studio/tm-engine';

export type LocalCallTransition = {
  fromState: string; // state id in THIS machine
  read: any;
  callMachineId: string;
  returnState: string; // state id in THIS machine
};

type LayoutMap = Record<string, { x: number; y: number }>;

function getLayout(spec: BaseMachine): LayoutMap {
  const ui = (spec as any).ui;
  return (ui?.layout?.nodes ?? {}) as LayoutMap;
}

function setLayout(spec: BaseMachine, nextLayout: LayoutMap): BaseMachine {
  const ui = { ...((spec as any).ui ?? {}) };
  const layout = { ...(ui.layout ?? {}) };
  layout.nodes = nextLayout;
  (ui as any).layout = layout;
  return { ...(spec as any), ui } as BaseMachine;
}

function tupleToText(v: any): string {
  return Array.isArray(v) ? v.join(',') : String(v);
}

function toTuple(v: any, k: number): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  // In k-tape mode we expect arrays, but keep this resilient for older specs.
  const s = String(v ?? '');
  if (k <= 1) return [s];
  return Array.from({ length: k }, (_, i) => (i === 0 ? s : ''));
}

function EdgeLabel({ t, k }: { t: BaseMachine['transitions'][number]; k: number }) {
  if (k <= 1) return <span>{edgeLabel(t)}</span>;
  const r = toTuple(t.read, k);
  const w = toTuple(t.write, k);
  const m = toTuple(t.move, k);
  return (
    <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas', fontSize: 11, lineHeight: 1.1 }}>
      <div style={{ whiteSpace: 'nowrap' }}>r: {r.map((x, i) => (<span key={i} style={{ padding: '0 2px' }}>{x || '∅'}</span>))}</div>
      <div style={{ whiteSpace: 'nowrap' }}>w: {w.map((x, i) => (<span key={i} style={{ padding: '0 2px' }}>{x || '∅'}</span>))}</div>
      <div style={{ whiteSpace: 'nowrap' }}>m: {m.map((x, i) => (<span key={i} style={{ padding: '0 2px' }}>{x || '∅'}</span>))}</div>
    </div>
  );
}

function edgeId(from: string, read: any) {
  return `e:${from}::${tupleToText(read)}`;
}

function edgeLabel(t: BaseMachine['transitions'][number]) {
  return `${tupleToText(t.read)} → ${tupleToText(t.write)},${tupleToText(t.move)}`;
}

function buildNodes(
  spec: BaseMachine,
  k: number,
  highlightState?: string,
  breakpointStates?: Set<string>,
  callTransitions?: LocalCallTransition[],
  callHighlight?: Extract<StepAction, { type: 'CALL' }>
): Node[] {
  const layout = getLayout(spec);

  const positions = spec.states.reduce<Record<string, { x: number; y: number }>>((acc, s, idx) => {
    acc[s] = layout[s] ?? { x: (idx % 6) * 160, y: Math.floor(idx / 6) * 120 };
    return acc;
  }, {});

  const stateNodes = spec.states.map((s) => {
    const isStart = s === spec.startState;
    const isAcc = spec.acceptStates.includes(s);
    const isRej = spec.rejectStates.includes(s);
    const isHi = !!highlightState && s === highlightState;

    const hasBp = !!breakpointStates?.has(s);

    return {
      id: s,
      type: 'state',
      position: positions[s],
      data: {
        label: s,
        isStart,
        isAcc,
        isRej,
        isHi,
        hasBp
      }
    } as Node;
  });

  // Visual CALL edges: represent each call as a small “call” node near the caller state.
  const calls = (callTransitions ?? []).map((ct, idx) => {
    const base = positions[ct.fromState] ?? { x: (idx % 6) * 160, y: Math.floor(idx / 6) * 120 };
    const id = `call:${ct.fromState}::${tupleToText(ct.read)}::${ct.callMachineId}::${ct.returnState}`;
    const isHi = !!(
      callHighlight &&
      callHighlight.machineId === spec.id &&
      callHighlight.callerState === ct.fromState &&
      tupleToText(callHighlight.read) === tupleToText(ct.read) &&
      callHighlight.calleeMachineId === ct.callMachineId
    );
    return {
      id,
      type: 'call',
      position: { x: base.x + 180, y: base.y + 10 + (idx % 3) * 48 },
      data: { label: ct.callMachineId, returnState: ct.returnState, read: ct.read, k, isHi }
    } as Node;
  });

  return [...stateNodes, ...calls];
}

function buildEdges(
  spec: BaseMachine,
  k: number,
  highlight?: Extract<StepAction, { type: 'STEP' }>,
  callTransitions?: LocalCallTransition[],
  callHighlight?: Extract<StepAction, { type: 'CALL' }> | null,
  returnHighlight?: Extract<StepAction, { type: 'RETURN' }> | null
): Edge[] {
  const baseEdges = spec.transitions.map((t) => {
    const isHi = !!(
      highlight &&
      highlight.machineId === spec.id &&
      highlight.fromState === t.fromState &&
      tupleToText(highlight.read) === tupleToText(t.read)
    );

    return {
      id: edgeId(t.fromState, t.read),
      source: t.fromState,
      target: t.toState,
      label: <EdgeLabel t={t} k={k} />,
      animated: isHi,
      style: isHi ? { strokeWidth: 2.5 } : undefined,
      markerEnd: { type: MarkerType.ArrowClosed }
    } as Edge;
  });

  const callEdges: Edge[] = (callTransitions ?? []).flatMap((ct) => {
    const callNodeId = `call:${ct.fromState}::${tupleToText(ct.read)}::${ct.callMachineId}::${ct.returnState}`;
    const isCallHi = !!(
      callHighlight &&
      (callHighlight as any).callerMachineId === spec.id &&
      (callHighlight as any).callerState === ct.fromState &&
      tupleToText(callHighlight.read) === tupleToText(ct.read) &&
      (callHighlight as any).calleeMachineId === ct.callMachineId
    );

    const isReturnHi = !!(
      returnHighlight &&
      returnHighlight.toMachineId === spec.id &&
      returnHighlight.returnState === ct.returnState
    );

    const readTuple = toTuple(ct.read, k);
    const readTxt = k <= 1 ? readTuple[0] : readTuple.join(' ');

    const e1: Edge = {
      id: `ce:${ct.fromState}::${tupleToText(ct.read)}::${ct.callMachineId}`,
      source: ct.fromState,
      target: callNodeId,
      label: `CALL on ${readTxt}`,
      animated: isCallHi,
      style: { strokeDasharray: '6 4', strokeWidth: isCallHi ? 2.5 : 1.5 },
      markerEnd: { type: MarkerType.ArrowClosed }
    };
    const e2: Edge = {
      id: `re:${callNodeId}::${ct.returnState}`,
      source: callNodeId,
      target: ct.returnState,
      label: `return → ${ct.returnState}`,
      animated: isReturnHi,
      style: { strokeDasharray: '6 4', strokeWidth: isReturnHi ? 2.5 : 1.5, opacity: 0.85 },
      markerEnd: { type: MarkerType.ArrowClosed }
    };
    return [e1, e2];
  });

  return [...baseEdges, ...callEdges];
}
      returnHighlight.returnState === ct.returnState
    );

    const callEdge: Edge = {
      id: `ce:${ct.fromState}::${tupleToText(ct.read)}::${ct.callMachineId}`,
      source: ct.fromState,
      target: callNodeId,
      label: k <= 1 ? `CALL ${ct.callMachineId}` : <span>CALL {ct.callMachineId}</span>,
      animated: isCallHi,
      style: {
        strokeDasharray: '6 4',
        strokeWidth: isCallHi ? 2.6 : 1.6,
        opacity: 0.95
      },
      markerEnd: { type: MarkerType.ArrowClosed }
    };

    const retEdge: Edge = {
      id: `re:${ct.callMachineId}::${ct.returnState}::${ct.fromState}`,
      source: callNodeId,
      target: ct.returnState,
      label: k <= 1 ? `return → ${ct.returnState}` : <span>return → {ct.returnState}</span>,
      animated: isRetHi,
      style: {
        strokeDasharray: '2 6',
        strokeWidth: isRetHi ? 2.6 : 1.3,
        opacity: 0.85
      },
      markerEnd: { type: MarkerType.ArrowClosed }
    };

    return [callEdge, retEdge];
  });
}

function StateNode({ data }: { data: any }) {
  const { label, isStart, isAcc, isRej, isHi, hasBp } = data;
  const border = isHi ? '2px solid rgba(99,102,241,.9)' : '1px solid rgba(127,127,127,.35)';
  const bg = isAcc
    ? 'rgba(34,197,94,.12)'
    : isRej
      ? 'rgba(239,68,68,.12)'
      : isStart
        ? 'rgba(59,130,246,.10)'
        : 'rgba(127,127,127,.06)';

  return (
    <div
      style={{
        minWidth: 90,
        padding: '10px 12px',
        borderRadius: 999,
        border,
        background: bg,
        textAlign: 'center',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas'
      }}
    >
      <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        {label}
        {hasBp && (
          <span
            title="Breakpoint"
            style={{
              width: 10,
              height: 10,
              borderRadius: 999,
              background: 'rgba(239, 68, 68, .85)',
              display: 'inline-block'
            }}
          />
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 6, flexWrap: 'wrap' }}>
        {isStart && <span style={{ fontSize: 11, opacity: 0.85 }}>start</span>}
        {isAcc && <span style={{ fontSize: 11, opacity: 0.85 }}>accept</span>}
        {isRej && <span style={{ fontSize: 11, opacity: 0.85 }}>reject</span>}
      </div>
    </div>
  );
}

function CallNode({ data }: { data: any }) {
  const { label, returnState, read, k, isHi } = data;
  const r = toTuple(read, Number(k ?? 1));
  return (
    <div
      style={{
        minWidth: 120,
        padding: '8px 10px',
        borderRadius: 14,
        border: isHi ? '2px dashed rgba(168,85,247,.95)' : '1px dashed rgba(168,85,247,.55)',
        background: 'rgba(168,85,247,.08)',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas'
      }}
    >
      <div style={{ fontWeight: 800 }}>CALL {label}</div>
      <div style={{ fontSize: 11, opacity: 0.9, marginTop: 4 }}>on: {Number(k ?? 1) <= 1 ? r[0] : r.join(' ')}</div>
      <div style={{ fontSize: 11, opacity: 0.85 }}>ret: {returnState}</div>
    </div>
  );
}

function CallNode({ data }: { data: any }) {
  const { label, returnState, read, k, isHi } = data;
  const r = toTuple(read, k).map((x: string) => x || '∅');
  return (
    <div
      style={{
        minWidth: 110,
        padding: '10px 12px',
        borderRadius: 14,
        border: isHi ? '2px dashed rgba(99,102,241,.9)' : '1px dashed rgba(127,127,127,.45)',
        background: 'rgba(250,204,21,.10)',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas'
      }}
    >
      <div style={{ fontWeight: 700 }}>CALL {label}</div>
      <div style={{ fontSize: 11, opacity: 0.9, marginTop: 4, whiteSpace: 'nowrap' }}>on: {k <= 1 ? r[0] : r.join(' ')}</div>
      <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2, whiteSpace: 'nowrap' }}>ret: {returnState}</div>
    </div>
  );
}

function CallNode({ data }: { data: any }) {
  const { label, read, returnState, k } = data;
  const r = toTuple(read, k);
  return (
    <div
      style={{
        minWidth: 150,
        padding: '10px 12px',
        borderRadius: 14,
        border: '1px dashed rgba(99,102,241,.8)',
        background: 'rgba(99,102,241,.10)',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas'
      }}
    >
      <div style={{ fontWeight: 800 }}>{label}</div>
      <div style={{ fontSize: 11, opacity: 0.9, marginTop: 6 }}>
        on r: {k <= 1 ? r[0] : r.join(' ')}
      </div>
      <div style={{ fontSize: 11, opacity: 0.85 }}>return: {returnState}</div>
    </div>
  );
}

export function GraphEditor({
  spec,
  onChangeSpec,
  highlight,
  callTransitions,
  callHighlight,
  returnHighlight,
  focusOnHighlight = false,
  breakpointStates,
  onToggleBreakpoint
}: {
  spec: BaseMachine;
  onChangeSpec: (next: BaseMachine) => void;
  highlight: Extract<StepAction, { type: 'STEP' }> | null;
  callTransitions?: LocalCallTransition[];
  callHighlight?: Extract<StepAction, { type: 'CALL' }> | null;
  returnHighlight?: Extract<StepAction, { type: 'RETURN' }> | null;
  focusOnHighlight?: boolean;
  breakpointStates?: Set<string>;
  onToggleBreakpoint?: (stateId: string) => void;
}) {
  const k = Number((spec as any).tapes ?? 1);
  const highlightState = useMemo(() => {
    if (!highlight || highlight.machineId !== spec.id) return undefined;
    return highlight.toState;
  }, [highlight, spec.id]);

  const initialNodes = useMemo(
    () => buildNodes(spec, k, highlightState, breakpointStates, callTransitions, callHighlight ?? undefined),
    [spec, k, highlightState, breakpointStates, callTransitions, callHighlight]
  );
  const initialEdges = useMemo(
    () => buildEdges(spec, k, highlight ?? undefined, callTransitions, callHighlight ?? null, returnHighlight ?? null),
    [spec, k, highlight, callTransitions, callHighlight, returnHighlight]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const rf = useRef<ReactFlowInstance | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // keep graph in sync when spec changes externally
  useEffect(() => {
    setNodes(buildNodes(spec, k, highlightState, breakpointStates, callTransitions, callHighlight ?? undefined));
    setEdges(buildEdges(spec, k, highlight ?? undefined, callTransitions, callHighlight ?? null, returnHighlight ?? null));
  }, [spec, k, highlight, highlightState, breakpointStates, callTransitions, callHighlight, returnHighlight, setNodes, setEdges]);

  // Edge edit modal (multi-tape friendly)
  const [editEdge, setEditEdge] = useState<null | { from: string; read: any }>(null);
  const [editRead, setEditRead] = useState<string[]>([]);
  const [editWrite, setEditWrite] = useState<string[]>([]);
  const [editMove, setEditMove] = useState<string[]>([]);

  const openEdgeEditor = useCallback(
    (from: string, read: any) => {
      const t = spec.transitions.find((x) => x.fromState === from && tupleToText(x.read) === tupleToText(read));
      if (!t) return;
      setEditEdge({ from, read: t.read });
      setEditRead(toTuple(t.read, k));
      setEditWrite(toTuple(t.write, k));
      setEditMove(toTuple(t.move, k).map((m) => (m || 'S').toUpperCase()));
    },
    [k, spec.transitions]
  );

  const saveEdgeEditor = useCallback(() => {
    if (!editEdge) return;
    const moves = editMove.map((m) => (m || 'S').toUpperCase());
    if (moves.some((m) => !['L', 'R', 'S'].includes(m))) {
      alert('Move must be L, R, or S');
      return;
    }
    const nextTransitions = spec.transitions.map((t) => {
      if (t.fromState !== editEdge.from) return t;
      if (tupleToText(t.read) !== tupleToText(editEdge.read)) return t;
      return {
        ...t,
        read: k <= 1 ? (editRead[0] ?? spec.blank) : editRead,
        write: k <= 1 ? (editWrite[0] ?? spec.blank) : editWrite,
        move: k <= 1 ? (moves[0] ?? 'S') : moves
      } as any;
    });
    onChangeSpec({ ...spec, transitions: nextTransitions });
    setEditEdge(null);
  }, [editEdge, editMove, editRead, editWrite, k, onChangeSpec, spec]);

  // Step 5: when running, keep the highlighted state in view
  useEffect(() => {
    if (!focusOnHighlight) return;
    if (!highlightState) return;
    const inst = rf.current;
    if (!inst) return;
    const n = inst.getNode(highlightState);
    if (!n) return;
    // Center on the node with a gentle animation
    inst.setCenter(n.position.x + 60, n.position.y + 30, { zoom: 1.1, duration: 350 });
  }, [focusOnHighlight, highlightState]);

  const persistNodePositions = useCallback(
    (nextNodes: Node[]) => {
      const nextLayout: LayoutMap = {};
      for (const n of nextNodes) {
        nextLayout[n.id] = { x: n.position.x, y: n.position.y };
      }
      onChangeSpec(setLayout(spec, nextLayout));
    },
    [onChangeSpec, spec]
  );

  const onConnect: OnConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target) return;
      if (conn.source === conn.target) {
        // allow self-loop; ok
      }

      const k = Number((spec as any).tapes ?? 1);
      const readRaw = window.prompt(
        k === 1 ? 'read symbol (e.g. 0, 1, _):' : `read symbols (comma separated, ${k} tapes):`,
        k === 1 ? spec.blank : Array.from({ length: k }, () => spec.blank).join(',')
      ) ?? '';
      if (!readRaw) return;
      const read = k === 1 ? readRaw.trim() : readRaw.split(',').map(s => s.trim());
      if (k > 1 && (read as string[]).length !== k) {
        alert(`Expected ${k} read symbols`);
        return;
      }

      const writeRaw = window.prompt(
        k === 1 ? 'write symbol:' : `write symbols (comma separated, ${k} tapes):`,
        k === 1 ? String(read) : (read as string[]).join(',')
      ) ?? '';
      if (!writeRaw) return;
      const write = k === 1 ? writeRaw.trim() : writeRaw.split(',').map(s => s.trim());
      if (k > 1 && (write as string[]).length !== k) {
        alert(`Expected ${k} write symbols`);
        return;
      }

      const moveRaw = (window.prompt(
        k === 1 ? 'move (L/R/S):' : `moves (comma separated, ${k} tapes; each L/R/S):`,
        k === 1 ? 'R' : Array.from({ length: k }, () => 'R').join(',')
      ) ?? 'S').trim();
      const move = k === 1 ? moveRaw.toUpperCase() : moveRaw.split(',').map(s => s.trim().toUpperCase());
      const moves = Array.isArray(move) ? move : [move];
      if (moves.some(m => !['L', 'R', 'S'].includes(m))) {
        alert('Move must be L, R, or S');
        return;
      }
      if (k > 1 && moves.length !== k) {
        alert(`Expected ${k} moves`);
        return;
      }

      // update spec transitions
      const next: BaseMachine = {
        ...spec,
        transitions: [
          ...spec.transitions,
          { fromState: conn.source, read: read as any, toState: conn.target, write: write as any, move: (Array.isArray(move) ? move : move) as any }
        ]
      };
      onChangeSpec(next);

      // optimistic edge
      setEdges((eds) =>
        addEdge(
          {
            id: edgeId(conn.source!, read),
            source: conn.source!,
            target: conn.target!,
            label:
              k <= 1 ? (
                `${tupleToText(read)} → ${tupleToText(write)},${tupleToText(move)}`
              ) : (
                <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas', fontSize: 11, lineHeight: 1.1 }}>
                  <div style={{ whiteSpace: 'nowrap' }}>r: {(read as string[]).map((x, i) => (<span key={i} style={{ padding: '0 2px' }}>{x || '∅'}</span>))}</div>
                  <div style={{ whiteSpace: 'nowrap' }}>w: {(write as string[]).map((x, i) => (<span key={i} style={{ padding: '0 2px' }}>{x || '∅'}</span>))}</div>
                  <div style={{ whiteSpace: 'nowrap' }}>m: {(Array.isArray(move) ? move : [move]).map((x, i) => (<span key={i} style={{ padding: '0 2px' }}>{String(x) || '∅'}</span>))}</div>
                </div>
              ),
            markerEnd: { type: MarkerType.ArrowClosed }
          },
          eds
        )
      );
    },
    [onChangeSpec, setEdges, spec]
  );

  const addState = useCallback(() => {
    const name = (window.prompt('New state name (e.g. q7):') ?? '').trim();
    if (!name) return;
    if (spec.states.includes(name)) {
      alert('State already exists');
      return;
    }
    const next: BaseMachine = { ...spec, states: [...spec.states, name] };
    onChangeSpec(next);
    // give it a position near center
    const center = rf.current?.getViewport() ?? { x: 0, y: 0, zoom: 1 };
    const pos = { x: -center.x / center.zoom + 80, y: -center.y / center.zoom + 80 };
    const layout = { ...getLayout(spec), [name]: pos };
    onChangeSpec(setLayout(next, layout));
  }, [onChangeSpec, spec]);

  const deleteSelected = useCallback(() => {
    if (selectedEdgeId) {
      const raw = selectedEdgeId.startsWith('e:') ? selectedEdgeId.slice(2) : selectedEdgeId;
      const [from, read] = raw.split('::');
      const next: BaseMachine = {
        ...spec,
        transitions: spec.transitions.filter((t) => !(t.fromState === from && tupleToText(t.read) === tupleToText(read)))
      };
      onChangeSpec(next);
      setSelectedEdgeId(null);
      return;
    }
    if (selectedNodeId) {
      if (selectedNodeId === spec.startState) {
        alert('Cannot delete startState (change startState first)');
        return;
      }
      const nextStates = spec.states.filter((s) => s !== selectedNodeId);
      const next: BaseMachine = {
        ...spec,
        states: nextStates,
        acceptStates: spec.acceptStates.filter((s) => s !== selectedNodeId),
        rejectStates: spec.rejectStates.filter((s) => s !== selectedNodeId),
        transitions: spec.transitions.filter((t) => t.fromState !== selectedNodeId && t.toState !== selectedNodeId)
      };
      const layout = { ...getLayout(spec) };
      delete layout[selectedNodeId];
      onChangeSpec(setLayout(next, layout));
      setSelectedNodeId(null);
    }
  }, [onChangeSpec, selectedEdgeId, selectedNodeId, spec]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelected();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deleteSelected]);

  return (
    <div style={{ marginTop: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="small">Drag nodes • Connect states to add transitions • Delete key removes selected</div>
        <div className="row" style={{ gap: 8 }}>
          <button className="button" onClick={addState}>+ State</button>
          <button
            className="button"
            onClick={() => {
              if (!selectedEdgeId) return;
              const raw = selectedEdgeId.startsWith('e:') ? selectedEdgeId.slice(2) : selectedEdgeId;
              const [from, read] = raw.split('::');
              openEdgeEditor(from, read);
            }}
            disabled={!selectedEdgeId}
            title={k <= 1 ? 'Edit selected transition' : 'Edit selected transition (multi-tape friendly)'}
          >
            Edit edge
          </button>
          <button className="button" onClick={deleteSelected} disabled={!selectedEdgeId && !selectedNodeId}>Delete</button>
        </div>
      </div>

      <div style={{ height: 560, borderRadius: 16, overflow: 'hidden', border: '1px solid rgba(127,127,127,.25)', marginTop: 10 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={{ state: StateNode, call: CallNode }}
          onInit={(inst) => (rf.current = inst)}
          onNodeClick={(_, node) => {
            // Breakpoints: click on a node while holding Alt/Option (or use right click if your OS steals Alt)
            // Keeping it modifier-gated avoids fighting with selection/drag.
            const e = _ as unknown as MouseEvent;
            const wantsToggle = (e as any)?.altKey || (e as any)?.metaKey;
            if (wantsToggle && onToggleBreakpoint) {
              onToggleBreakpoint(node.id);
            }
          }}
          onNodesChange={(chs) => {
            onNodesChange(chs);
          }}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={() => {
            const nextNodes = rf.current?.getNodes?.() ?? nodes;
            persistNodePositions(nextNodes);
          }}
          onConnect={onConnect}
          fitView
          onSelectionChange={(sel) => {
            const n = sel.nodes?.[0];
            const e = sel.edges?.[0];
            setSelectedNodeId(n?.id ?? null);
            setSelectedEdgeId(e?.id ?? null);
          }}
        >
          <Background />
          <MiniMap />
          <Controls />
        </ReactFlow>
      </div>

      {editEdge && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            zIndex: 50
          }}
          onMouseDown={() => setEditEdge(null)}
        >
          <div
            style={{
              width: 720,
              maxWidth: '100%',
              background: 'rgba(20,20,20,.96)',
              border: '1px solid rgba(127,127,127,.25)',
              borderRadius: 16,
              padding: 16
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
              <div style={{ fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas' }}>
                Edit transition • {editEdge.from}
              </div>
              <button className="button" onClick={() => setEditEdge(null)}>Close</button>
            </div>

            <div style={{ marginTop: 12, border: '1px solid rgba(127,127,127,.25)', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: `140px repeat(${Math.max(1, k)}, 1fr)`, gap: 0 }}>
                <div style={{ padding: 10, opacity: 0.85, borderBottom: '1px solid rgba(127,127,127,.25)' }} />
                {Array.from({ length: Math.max(1, k) }, (_, i) => (
                  <div key={i} style={{ padding: 10, opacity: 0.85, borderBottom: '1px solid rgba(127,127,127,.25)' }}>
                    Tape {i + 1}
                  </div>
                ))}

                {(['read', 'write', 'move'] as const).map((row) => (
                  <div key={row} style={{ display: 'contents' }}>
                    <div style={{ padding: 10, borderTop: '1px solid rgba(127,127,127,.2)', opacity: 0.9 }}>{row}</div>
                    {Array.from({ length: Math.max(1, k) }, (_, i) => {
                      const val = row === 'read' ? editRead[i] : row === 'write' ? editWrite[i] : editMove[i];
                      const setVal = row === 'read' ? setEditRead : row === 'write' ? setEditWrite : setEditMove;
                      return (
                        <div key={i} style={{ padding: 8, borderTop: '1px solid rgba(127,127,127,.2)' }}>
                          {row === 'move' ? (
                            <select
                              value={(val ?? 'S').toUpperCase()}
                              onChange={(e) =>
                                setVal((prev) => {
                                  const next = [...prev];
                                  next[i] = e.target.value;
                                  return next;
                                })
                              }
                              style={{ width: '100%', padding: '8px 10px', borderRadius: 10, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(127,127,127,.25)', color: 'white' }}
                            >
                              <option value="L">L</option>
                              <option value="R">R</option>
                              <option value="S">S</option>
                            </select>
                          ) : (
                            <input
                              value={val ?? ''}
                              onChange={(e) =>
                                setVal((prev) => {
                                  const next = [...prev];
                                  next[i] = e.target.value;
                                  return next;
                                })
                              }
                              placeholder={spec.blank}
                              style={{ width: '100%', padding: '8px 10px', borderRadius: 10, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(127,127,127,.25)', color: 'white' }}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button className="button" onClick={saveEdgeEditor}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
