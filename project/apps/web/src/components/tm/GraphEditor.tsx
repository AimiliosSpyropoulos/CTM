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
  fromState: string;
  read: any;
  callMachineId: string;
  returnState: string;
};

function tupleToText(v: any): string {
  return Array.isArray(v) ? v.join(',') : String(v);
}

function edgeId(from: string, read: any) {
  return `e:${from}::${tupleToText(read)}`;
}

function buildNodes(
  spec: BaseMachine,
  highlightState?: string
): Node[] {
  return spec.states.map((s, idx) => ({
    id: s,
    type: 'state',
    position: { x: (idx % 6) * 160, y: Math.floor(idx / 6) * 120 },
    data: {
      label: s,
      isStart: s === spec.startState,
      isAcc: spec.acceptStates.includes(s),
      isRej: spec.rejectStates.includes(s),
      isHi: highlightState === s
    }
  }));
}

function buildEdges(
  spec: BaseMachine,
  highlight?: Extract<StepAction, { type: 'STEP' }> | null
): Edge[] {
  return spec.transitions.map((t) => {
    const isHi =
      highlight &&
      highlight.machineId === spec.id &&
      highlight.fromState === t.fromState &&
      tupleToText(highlight.read) === tupleToText(t.read);

    return {
      id: edgeId(t.fromState, t.read),
      source: t.fromState,
      target: t.toState,
      label: `${tupleToText(t.read)} → ${tupleToText(t.write)},${tupleToText(t.move)}`,
      animated: !!isHi,
      style: isHi ? { strokeWidth: 2.5 } : undefined,
      markerEnd: { type: MarkerType.ArrowClosed }
    };
  });
}

function StateNode({ data }: { data: any }) {
  const { label, isStart, isAcc, isRej, isHi } = data;

  const border = isHi ? '2px solid #6366f1' : '1px solid rgba(127,127,127,.35)';
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
        textAlign: 'center'
      }}
    >
      <b>{label}</b>
    </div>
  );
}

export function GraphEditor({
  spec,
  onChangeSpec,
  highlight
}: {
  spec: BaseMachine;
  onChangeSpec: (next: BaseMachine) => void;
  highlight: Extract<StepAction, { type: 'STEP' }> | null;
}) {
  const highlightState = useMemo(() => {
    if (!highlight || highlight.machineId !== spec.id) return undefined;
    return highlight.toState;
  }, [highlight, spec.id]);

  const initialNodes = useMemo(
    () => buildNodes(spec, highlightState),
    [spec, highlightState]
  );

  const initialEdges = useMemo(
    () => buildEdges(spec, highlight ?? null),
    [spec, highlight]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const rf = useRef<ReactFlowInstance | null>(null);

  useEffect(() => {
    setNodes(buildNodes(spec, highlightState));
    setEdges(buildEdges(spec, highlight ?? null));
  }, [spec, highlightState, highlight, setNodes, setEdges]);

  const onConnect: OnConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target) return;

      const read = window.prompt('read symbol:') ?? '';
      if (!read) return;

      const write = window.prompt('write symbol:') ?? read;
      const move = window.prompt('move (L/R/S):') ?? 'R';

      const next: BaseMachine = {
        ...spec,
        transitions: [
          ...spec.transitions,
          {
            fromState: conn.source,
            read,
            toState: conn.target,
            write,
            move
          } as any
        ]
      };

      onChangeSpec(next);

      setEdges((eds) =>
        addEdge(
          {
            id: edgeId(conn.source!, read),
            source: conn.source!,
            target: conn.target!,
            label: `${read} → ${write},${move}`,
            markerEnd: { type: MarkerType.ArrowClosed }
          },
          eds
        )
      );
    },
    [onChangeSpec, spec, setEdges]
  );

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ height: 560, borderRadius: 16, overflow: 'hidden' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={{ state: StateNode }}
          onInit={(inst) => (rf.current = inst)}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          fitView
        >
          <Background />
          <MiniMap />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}
