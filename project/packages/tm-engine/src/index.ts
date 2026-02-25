export type Direction = 'L' | 'R' | 'S';

export type Symbol = string; // single-char recommended but we don't enforce

export interface Tape {
  cells: Record<number, Symbol>; // sparse
  head: number;
  blank: Symbol;
}

// Multi-tape support:
// For 1-tape machines you can keep using scalar values.
// For k-tape machines, use tuples of length k.
export type ReadTuple = Symbol | Symbol[];
export type WriteTuple = Symbol | Symbol[];
export type MoveTuple = Direction | Direction[];

export interface Transition {
  fromState: string;
  read: ReadTuple;
  toState: string;
  write: WriteTuple;
  move: MoveTuple;
}

export interface BaseMachine {
  kind: 'base';
  id: string;
  name: string;
  tapes?: number; // default 1
  states: string[];
  startState: string;
  acceptStates: string[];
  rejectStates: string[];
  blank: Symbol;
  alphabet: Symbol[];
  transitions: Transition[];
}

// Composite: allows "call" into another machine by id.
export interface CallTransition {
  fromState: string;
  read: ReadTuple;
  callMachineId: string;
  returnState: string; // state to continue after callee halts
}

export interface CompositeMachine {
  kind: 'composite';
  id: string;
  name: string;
  tapes?: number; // default 1
  startMachineId: string;
  machines: Record<string, BaseMachine>; // internal library
  callTransitions: CallTransition[];
}

export type MachineSpec = BaseMachine | CompositeMachine;

export type StepAction =
  | { type: 'STEP'; machineId: string; fromState: string; read: ReadTuple; toState: string; write: WriteTuple; move: MoveTuple }
  | { type: 'CALL'; callerMachineId: string; callerState: string; read: ReadTuple; calleeMachineId: string; returnState: string }
  | { type: 'RETURN'; fromMachineId: string; toMachineId: string; returnState: string; reason: 'ACCEPT' | 'REJECT' }
  | { type: 'HALT'; reason: StepResult['haltingReason'] };

export interface StepResult {
  halted: boolean;
  haltingReason?: 'ACCEPT' | 'REJECT' | 'NO_TRANSITION' | 'MAX_STEPS';
  action?: StepAction;
}

export interface RuntimeFrame {
  machineId: string;
  state: string;
  returnState?: string;
}

export interface Runtime {
  spec: MachineSpec;
  tapes: Tape[];
  step: number;
  frames: RuntimeFrame[]; // call stack; top is current
  maxSteps: number;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

function tapesCount(spec: MachineSpec): number {
  if ((spec as any).tapes && Number((spec as any).tapes) > 0) return Number((spec as any).tapes);
  if (spec.kind === 'composite') {
    const m = spec.machines[spec.startMachineId];
    const k = (m as any)?.tapes;
    if (k && Number(k) > 0) return Number(k);
  }
  return 1;
}

function normalizeTuple<T>(value: T | T[], k: number, fill: T): T[] {
  if (Array.isArray(value)) {
    if (value.length !== k) throw new Error(`Tuple length mismatch: expected ${k}, got ${value.length}`);
    return value;
  }
  return Array.from({ length: k }, () => value ?? fill);
}

function isDir(x: any): x is Direction {
  return x === 'L' || x === 'R' || x === 'S';
}

function asArrayInput(input: string | string[], k: number): string[] {
  if (Array.isArray(input)) {
    const arr = input.slice(0, k);
    while (arr.length < k) arr.push('');
    return arr;
  }
  const arr = Array.from({ length: k }, () => '');
  arr[0] = input;
  return arr;
}

function validateTupleLen(value: any, k: number): boolean {
  if (k === 1) return !Array.isArray(value) || value.length === 1;
  return Array.isArray(value) && value.length === k;
}

function tupleToString(v: any): string {
  return Array.isArray(v) ? `[${v.join(',')}]` : String(v);
}

export function validateSpec(spec: MachineSpec): ValidationResult {
  const errors: string[] = [];
  const k = tapesCount(spec);

  const validateBase = (m: BaseMachine) => {
    const states = new Set(m.states);
    const alphabet = new Set([...m.alphabet, m.blank]);
    if (!states.has(m.startState)) errors.push(`${m.id}: startState '${m.startState}' not in states`);
    for (const s of m.acceptStates) if (!states.has(s)) errors.push(`${m.id}: acceptState '${s}' not in states`);
    for (const s of m.rejectStates) if (!states.has(s)) errors.push(`${m.id}: rejectState '${s}' not in states`);

    for (let i = 0; i < m.transitions.length; i++) {
      const t = m.transitions[i];
      const where = `${m.id}: transition[${i}] (${t.fromState} -> ${t.toState})`;
      if (!states.has(t.fromState)) errors.push(`${where}: fromState not in states`);
      if (!states.has(t.toState)) errors.push(`${where}: toState not in states`);
      if (!validateTupleLen(t.read, k)) errors.push(`${where}: read tuple length mismatch, got ${tupleToString(t.read)} expected k=${k}`);
      if (!validateTupleLen(t.write, k)) errors.push(`${where}: write tuple length mismatch, got ${tupleToString(t.write)} expected k=${k}`);
      if (!validateTupleLen(t.move, k)) errors.push(`${where}: move tuple length mismatch, got ${tupleToString(t.move)} expected k=${k}`);

      const rr = normalizeTuple<Symbol>(t.read as any, k, m.blank);
      const ww = normalizeTuple<Symbol>(t.write as any, k, m.blank);
      const mm = normalizeTuple<Direction>(t.move as any, k, 'S');
      rr.forEach((sym, j) => { if (!alphabet.has(sym)) errors.push(`${where}: read[${j}] symbol '${sym}' not in alphabet`); });
      ww.forEach((sym, j) => { if (!alphabet.has(sym)) errors.push(`${where}: write[${j}] symbol '${sym}' not in alphabet`); });
      mm.forEach((dir, j) => { if (!isDir(dir)) errors.push(`${where}: move[${j}] invalid '${dir}' (expected L/R/S)`); });
    }
  };

  if (spec.kind === 'base') {
    validateBase(spec);
  } else {
    if (!spec.machines[spec.startMachineId]) errors.push(`${spec.id}: startMachineId '${spec.startMachineId}' not found in machines`);
    for (const m of Object.values(spec.machines)) validateBase(m);

    for (let i = 0; i < spec.callTransitions.length; i++) {
      const t = spec.callTransitions[i];
      const where = `${spec.id}: callTransition[${i}] (${t.fromState} -> CALL ${t.callMachineId})`;
      if (!t.fromState.includes(':')) errors.push(`${where}: fromState should be 'machineId:state'`);
      if (!spec.machines[t.callMachineId]) errors.push(`${where}: callMachineId '${t.callMachineId}' not found`);
      if (!validateTupleLen(t.read, k)) errors.push(`${where}: read tuple length mismatch, got ${tupleToString(t.read)} expected k=${k}`);
      // returnState is validated implicitly by runtime; still check if machineId part exists
    }
  }

  return { ok: errors.length === 0, errors };
}

export function createTape(input: string, blank: Symbol = '_'): Tape {
  const cells: Record<number, Symbol> = {};
  for (let i = 0; i < input.length; i++) cells[i] = input[i];
  return { cells, head: 0, blank };
}

export function readSymbol(tape: Tape): Symbol {
  return tape.cells[tape.head] ?? tape.blank;
}

export function writeSymbol(tape: Tape, sym: Symbol) {
  if (sym === tape.blank) delete tape.cells[tape.head];
  else tape.cells[tape.head] = sym;
}

export function moveHead(tape: Tape, dir: Direction) {
  if (dir === 'L') tape.head -= 1;
  else if (dir === 'R') tape.head += 1;
}

function findTransition(m: BaseMachine, state: string, read: Symbol): Transition | undefined {
  // 1-tape legacy path
  return m.transitions.find(t => t.fromState === state && (Array.isArray(t.read) ? t.read[0] : t.read) === read);
}

function findCallTransition(spec: CompositeMachine, machineId: string, state: string, readSyms: Symbol[], blank: Symbol): CallTransition | undefined {
  const k = tapesCount(spec);
  return spec.callTransitions.find(t => {
    if (t.fromState !== `${machineId}:${state}`) return false;
    if (k === 1) return (Array.isArray(t.read) ? t.read[0] : t.read) === readSyms[0];
    const rr = normalizeTuple<Symbol>(t.read as any, k, blank);
    return rr.every((v, i) => v === readSyms[i]);
  });
}

export function initRuntime(spec: MachineSpec, input: string | string[], maxSteps = 2000): Runtime {
  const blank = spec.kind === 'base' ? spec.blank : spec.machines[spec.startMachineId].blank;
  const k = tapesCount(spec);
  const inputs = asArrayInput(input, k);
  const tapes: Tape[] = Array.from({ length: k }, (_, i) => createTape(inputs[i] ?? '', blank));
  const frames: RuntimeFrame[] =
    spec.kind === 'base'
      ? [{ machineId: spec.id, state: spec.startState }]
      : [{ machineId: spec.startMachineId, state: spec.machines[spec.startMachineId].startState }];
  return { spec, tapes, step: 0, frames, maxSteps };
}

export function currentMachine(runtime: Runtime): BaseMachine {
  const top = runtime.frames[runtime.frames.length - 1];
  if (runtime.spec.kind === 'base') return runtime.spec;
  return runtime.spec.machines[top.machineId];
}

export function stepRuntime(runtime: Runtime): StepResult {
  if (runtime.step >= runtime.maxSteps) {
    return { halted: true, haltingReason: 'MAX_STEPS', action: { type: 'HALT', reason: 'MAX_STEPS' } };
  }

  const top = runtime.frames[runtime.frames.length - 1];
  const m = currentMachine(runtime);
  const k = tapesCount(runtime.spec);
  const readSyms = runtime.tapes.map(t => readSymbol(t));

  // halting states
  if (m.acceptStates.includes(top.state)) {
    // if composite and not at base frame, return
    if (runtime.spec.kind === 'composite' && runtime.frames.length > 1) {
      const frame = runtime.frames.pop()!;
      const caller = runtime.frames[runtime.frames.length - 1];
      caller.state = frame.returnState ?? caller.state;
      runtime.step += 1;
      return {
        halted: false,
        action: {
          type: 'RETURN',
          fromMachineId: frame.machineId,
          toMachineId: caller.machineId,
          returnState: caller.state,
          reason: 'ACCEPT'
        }
      };
    }
    return { halted: true, haltingReason: 'ACCEPT', action: { type: 'HALT', reason: 'ACCEPT' } };
  }
  if (m.rejectStates.includes(top.state)) {
    if (runtime.spec.kind === 'composite' && runtime.frames.length > 1) {
      // propagate reject upward by turning caller into reject (simple policy)
      const frame = runtime.frames.pop()!;
      const caller = runtime.frames[runtime.frames.length - 1];
      caller.state = frame.returnState ?? caller.state;
      runtime.step += 1;
      return {
        halted: false,
        action: {
          type: 'RETURN',
          fromMachineId: frame.machineId,
          toMachineId: caller.machineId,
          returnState: caller.state,
          reason: 'REJECT'
        }
      };
    }
    return { halted: true, haltingReason: 'REJECT', action: { type: 'HALT', reason: 'REJECT' } };
  }

  // composite call transition takes precedence
  if (runtime.spec.kind === 'composite') {
    const call = findCallTransition(runtime.spec, top.machineId, top.state, readSyms, m.blank);
    if (call) {
      const callee = runtime.spec.machines[call.callMachineId];
      if (!callee) throw new Error(`Unknown callee machineId: ${call.callMachineId}`);
      runtime.frames.push({ machineId: call.callMachineId, state: callee.startState, returnState: call.returnState });
      runtime.step += 1;
      return {
        halted: false,
        action: {
          type: 'CALL',
          callerMachineId: top.machineId,
          callerState: top.state,
          read: call.read,
          calleeMachineId: call.callMachineId,
          returnState: call.returnState
        }
      };
    }
  }

  // Multi-tape lookup: exact tuple match when k>1; legacy scalar match when k===1
  const tr =
    k === 1
      ? findTransition(m, top.state, readSyms[0])
      : m.transitions.find(t => {
          if (t.fromState !== top.state) return false;
          const rr = normalizeTuple<Symbol>(t.read as any, k, m.blank);
          return rr.every((v, i) => v === readSyms[i]);
        });
  if (!tr) {
    return { halted: true, haltingReason: 'NO_TRANSITION', action: { type: 'HALT', reason: 'NO_TRANSITION' } };
  }

  const ww = normalizeTuple<Symbol>(tr.write as any, k, m.blank);
  const mm = normalizeTuple<Direction>(tr.move as any, k, 'S');
  for (let i = 0; i < k; i++) {
    writeSymbol(runtime.tapes[i], ww[i]);
    moveHead(runtime.tapes[i], mm[i]);
  }
  top.state = tr.toState;
  runtime.step += 1;
  return {
    halted: false,
    action: {
      type: 'STEP',
      machineId: top.machineId,
      fromState: tr.fromState,
      read: tr.read,
      toState: tr.toState,
      write: tr.write,
      move: tr.move
    }
  };
}

export function tapeToString(tape: Tape, window = 25): { text: string; min: number; max: number } {
  const head = tape.head;
  const min = head - window;
  const max = head + window;
  let text = '';
  for (let i = min; i <= max; i++) {
    const ch = tape.cells[i] ?? tape.blank;
    text += ch;
  }
  return { text, min, max };
}
