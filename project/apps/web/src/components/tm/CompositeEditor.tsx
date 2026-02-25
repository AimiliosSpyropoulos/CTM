/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useEffect, useMemo, useState } from 'react';
import type { BaseMachine, CallTransition, CompositeMachine, StepAction } from '@tm-studio/tm-engine';
import { GraphEditor } from '@/components/tm/GraphEditor';

function makeNewBaseMachine(id: string, tapes: number): BaseMachine {
  return {
    kind: 'base',
    id,
    name: id,
    tapes,
    states: ['q0', 'qacc', 'qrej'],
    startState: 'q0',
    acceptStates: ['qacc'],
    rejectStates: ['qrej'],
    blank: '_',
    alphabet: ['0', '1', '_'],
    transitions: [{ fromState: 'q0', read: '_', toState: 'qacc', write: '_', move: 'S' }]
  };
}

function parseFromState(fromState: string): { machineId: string; state: string } {
  const idx = fromState.indexOf(':');
  if (idx === -1) return { machineId: '', state: fromState };
  return { machineId: fromState.slice(0, idx), state: fromState.slice(idx + 1) };
}

function formatFromState(machineId: string, state: string) {
  return `${machineId}:${state}`;
}

export function CompositeEditor({
  spec,
  onChangeSpec,
  lastAction,
  activeRuntimeMachineId,
  followRuntime,
  breakpoints,
  onToggleBreakpoint
}: {
  spec: CompositeMachine;
  onChangeSpec: (next: CompositeMachine) => void;
  lastAction: StepAction | null;
  activeRuntimeMachineId: string | null;
  followRuntime: boolean;
  breakpoints: string[];
  onToggleBreakpoint: (machineId: string, state: string) => void;
}) {
  const machineIds = useMemo(() => Object.keys(spec.machines).sort(), [spec.machines]);
  const [activeMachineId, setActiveMachineId] = useState<string>(spec.startMachineId);
  const [tab, setTab] = useState<'machines' | 'calls'>('machines');
  const active = spec.machines[activeMachineId];

  // Step 5: auto-follow runtime machine during execution
  useEffect(() => {
    if (!followRuntime) return;
    if (!activeRuntimeMachineId) return;
    if (spec.machines[activeRuntimeMachineId] && activeRuntimeMachineId !== activeMachineId) {
      setActiveMachineId(activeRuntimeMachineId);
      setTab('machines');
    }
  }, [followRuntime, activeRuntimeMachineId, spec.machines, activeMachineId]);

  function updateMachine(next: BaseMachine) {
    onChangeSpec({ ...spec, machines: { ...spec.machines, [next.id]: next } });
  }

  function renameMachine(oldId: string, newId: string) {
    if (!newId || newId === oldId) return;
    if (spec.machines[newId]) {
      alert('Machine id already exists');
      return;
    }
    const { [oldId]: m, ...rest } = spec.machines;
    const renamed: BaseMachine = { ...m, id: newId, name: m.name === oldId ? newId : m.name };
    const nextMachines = { ...rest, [newId]: renamed };
    const nextCalls = spec.callTransitions.map((ct) => {
      const from = parseFromState(ct.fromState);
      const nextFrom = from.machineId === oldId ? formatFromState(newId, from.state) : ct.fromState;
      const nextCallee = ct.callMachineId === oldId ? newId : ct.callMachineId;
      return { ...ct, fromState: nextFrom, callMachineId: nextCallee };
    });
    const nextStart = spec.startMachineId === oldId ? newId : spec.startMachineId;
    onChangeSpec({ ...spec, startMachineId: nextStart, machines: nextMachines, callTransitions: nextCalls });
    setActiveMachineId(newId);
  }

  function addMachine() {
    const id = (prompt('New submachine id (e.g. add, inc, dec):', `m${machineIds.length + 1}`) ?? '').trim();
    if (!id) return;
    if (spec.machines[id]) {
      alert('Machine already exists');
      return;
    }
    const k = Number((spec as any).tapes ?? 1);
    const next = makeNewBaseMachine(id, k);
    onChangeSpec({ ...spec, machines: { ...spec.machines, [id]: next } });
    setActiveMachineId(id);
    setTab('machines');
  }

  function deleteMachine(id: string) {
    if (id === spec.startMachineId) {
      alert('Cannot delete startMachineId. Change start machine first.');
      return;
    }
    if (!confirm(`Delete machine '${id}'? This will also remove call transitions referencing it.`)) return;
    const { [id]: _, ...rest } = spec.machines;
    const nextCalls = spec.callTransitions.filter((ct) => {
      const from = parseFromState(ct.fromState);
      return from.machineId !== id && ct.callMachineId !== id;
    });
    const nextId = Object.keys(rest)[0] ?? spec.startMachineId;
    onChangeSpec({ ...spec, machines: rest, callTransitions: nextCalls });
    setActiveMachineId(nextId);
  }

  function addCallTransition() {
    const fromState = (prompt('Caller (format machineId:state)', formatFromState(activeMachineId, active?.startState ?? 'q0')) ?? '').trim();
    if (!fromState || !fromState.includes(':')) {
      alert('Caller must be machineId:state');
      return;
    }
    const k = Number((spec as any).tapes ?? (active as any)?.tapes ?? 1);
    const readRaw = (prompt(
      k === 1 ? 'Read symbol:' : `Read symbols (comma separated, ${k} tapes):`,
      k === 1 ? '_' : Array.from({ length: k }, () => '_').join(',')
    ) ?? '').trim();
    if (!readRaw) return;
    const read = k === 1 ? readRaw : readRaw.split(',').map(s => s.trim());
    if (k > 1 && (read as string[]).length !== k) {
      alert(`Expected ${k} read symbols`);
      return;
    }
    const callMachineId = (prompt('Callee machineId:', machineIds[0] ?? '') ?? '').trim();
    if (!callMachineId || !spec.machines[callMachineId]) {
      alert('Unknown callee machineId');
      return;
    }
    const returnState = (prompt('Return state (state in caller machine):', 'q0') ?? '').trim();
    if (!returnState) return;

    const next: CallTransition = { fromState, read: read as any, callMachineId, returnState };
    onChangeSpec({ ...spec, callTransitions: [...spec.callTransitions, next] });
    setTab('calls');
  }

  function updateCall(i: number, patch: Partial<CallTransition>) {
    onChangeSpec({
      ...spec,
      callTransitions: spec.callTransitions.map((c, idx) => (idx === i ? { ...c, ...patch } : c))
    });
  }

  function removeCall(i: number) {
    onChangeSpec({ ...spec, callTransitions: spec.callTransitions.filter((_, idx) => idx !== i) });
  }

  const stepHighlight = lastAction?.type === 'STEP' ? lastAction : null;
  const callHighlight = lastAction?.type === 'CALL' ? lastAction : null;
  const returnHighlight = lastAction?.type === 'RETURN' ? lastAction : null;

  const activeCalls = useMemo(() => {
    return spec.callTransitions
      .map((ct) => {
        const from = parseFromState(ct.fromState);
        return { ...ct, _fromMachineId: from.machineId, _fromState: from.state };
      })
      .filter((ct) => ct._fromMachineId === activeMachineId)
      .map((ct) => ({
        fromState: ct._fromState,
        read: ct.read as any,
        callMachineId: ct.callMachineId,
        returnState: ct.returnState
      }));
  }, [spec.callTransitions, activeMachineId]);

  return (
    <div style={{ marginTop: 12 }}>
      <div className="small">Kind: composite • Spec: {spec.id} • Start machine: {spec.startMachineId}</div>

      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
        <b>Composite editor</b>
        <div className="row" style={{ gap: 8 }}>
          <button className={`button ${tab === 'machines' ? 'primary' : ''}`} onClick={() => setTab('machines')}>Machines</button>
          <button className={`button ${tab === 'calls' ? 'primary' : ''}`} onClick={() => setTab('calls')}>Call transitions</button>
        </div>
      </div>

      {tab === 'machines' && (
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 12, marginTop: 10 }}>
          <div className="card" style={{ padding: 12 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <b>Submachines</b>
              <button className="button" onClick={addMachine}>+ Add</button>
            </div>
            <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
              {machineIds.map((id) => (
                <button
                  key={id}
                  className={`button ${id === activeMachineId ? 'primary' : ''}`}
                  onClick={() => setActiveMachineId(id)}
                  style={{ justifyContent: 'space-between' }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {id}
                    {callHighlight && id === callHighlight.calleeMachineId && <span className="badge">CALL</span>}
                    {returnHighlight && id === returnHighlight.toMachineId && <span className="badge">RETURN</span>}
                  </span>
                  {id === spec.startMachineId && <span className="badge">start</span>}
                </button>
              ))}
            </div>

            <hr />

            <button
              className="button"
              onClick={() => {
                const next = (prompt('Set startMachineId:', spec.startMachineId) ?? '').trim();
                if (next && spec.machines[next]) onChangeSpec({ ...spec, startMachineId: next });
                else if (next) alert('Unknown machine');
              }}
            >
              Set start machine
            </button>
          </div>

          <div>
            {!active && <div className="small">Select a machine.</div>}
            {active && (
              <>
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <div className="small">Editing: <b>{activeMachineId}</b></div>
                  <div className="row" style={{ gap: 8 }}>
                    <button
                      className="button"
                      onClick={() => {
                        const next = (prompt('Rename machine id:', activeMachineId) ?? '').trim();
                        if (next) renameMachine(activeMachineId, next);
                      }}
                    >
                      Rename
                    </button>
                    <button className="button" onClick={() => deleteMachine(activeMachineId)} disabled={activeMachineId === spec.startMachineId}>
                      Delete
                    </button>
                    <button className="button" onClick={addCallTransition}>+ Call transition</button>
                  </div>
                </div>

                {(callHighlight || returnHighlight) && (
                  <div className="card" style={{ padding: 10, marginTop: 10 }}>
                    <div className="small"><b>Runtime event</b></div>
                    {callHighlight && (
                      <div className="small" style={{ marginTop: 6 }}>
                        CALL: <b>{callHighlight.callerMachineId}:{callHighlight.callerState}</b> on <b>{JSON.stringify(callHighlight.read)}</b> → <b>{callHighlight.calleeMachineId}</b> (return → <b>{callHighlight.returnState}</b>)
                      </div>
                    )}
                    {returnHighlight && (
                      <div className="small" style={{ marginTop: 6 }}>
                        RETURN: <b>{returnHighlight.fromMachineId}</b> → <b>{returnHighlight.toMachineId}</b> (resume at <b>{returnHighlight.returnState}</b>, reason: <b>{returnHighlight.reason}</b>)
                      </div>
                    )}
                  </div>
                )}

                <div style={{ marginTop: 10 }}>
                  <GraphEditor
                    spec={active}
                    onChangeSpec={updateMachine}
                    highlight={stepHighlight && stepHighlight.machineId === active.id ? stepHighlight : null}
                    callTransitions={activeCalls}
                    callHighlight={callHighlight as any}
                    returnHighlight={returnHighlight as any}
                    focusOnHighlight={followRuntime}
                    breakpointStates={new Set(
                      breakpoints
                        .filter((bp) => bp.startsWith(`${active.id}:`))
                        .map((bp) => bp.slice(active.id.length + 1))
                    )}
                    onToggleBreakpoint={(stateId) => onToggleBreakpoint(active.id, stateId)}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {tab === 'calls' && (
        <div style={{ marginTop: 10 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b>Call transitions</b>
            <button className="button" onClick={addCallTransition}>+ Add</button>
          </div>
          <p className="small" style={{ marginTop: 8 }}>
            Format: <code>fromState = machineId:state</code> • On read symbol → CALL callee machine and resume at returnState when callee halts.
          </p>

          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th align="left">caller (machine:state)</th>
                  <th align="left">read</th>
                  <th align="left">callee</th>
                  <th align="left">returnState</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {spec.callTransitions.map((c, i) => (
                  <tr key={i}>
                    <td style={{ minWidth: 220 }}>
                      <input
                        value={c.fromState}
                        onChange={(e) => updateCall(i, { fromState: e.target.value })}
                        placeholder="add:q0"
                      />
                    </td>
                    <td>
                      <input value={c.read} onChange={(e) => updateCall(i, { read: e.target.value })} style={{ width: 70 }} />
                    </td>
                    <td>
                      <select value={c.callMachineId} onChange={(e) => updateCall(i, { callMachineId: e.target.value })}>
                        {machineIds.map((id) => (
                          <option key={id} value={id}>{id}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input value={c.returnState} onChange={(e) => updateCall(i, { returnState: e.target.value })} />
                    </td>
                    <td align="right">
                      <button className="button" onClick={() => removeCall(i)}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
