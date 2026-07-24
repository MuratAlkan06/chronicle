import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nextGatePhase,
  shouldStartRun,
  canConfirm,
  ARM_GUARD_MS,
  type GatePhase,
} from "./eval-gate";

// ---------------------------------------------------------------------------
// nextGatePhase — two-step transition table
// ---------------------------------------------------------------------------

test("nextGatePhase: arm reveals the confirm step", () => {
  assert.equal(nextGatePhase("arm"), "armed");
});

test("nextGatePhase: cancel returns to the step-1 button", () => {
  assert.equal(nextGatePhase("cancel"), "idle");
});

test("nextGatePhase: confirm closes the gate", () => {
  assert.equal(nextGatePhase("confirm"), "idle");
});

// ---------------------------------------------------------------------------
// shouldStartRun — the single safety guard on firing the live held-out run
// ---------------------------------------------------------------------------

test("shouldStartRun: only fires from the armed phase", () => {
  // A confirm must have been explicitly armed first — an un-armed gate can never
  // spend the final Case 3 measurement event.
  assert.equal(shouldStartRun("armed", false), true);
  assert.equal(shouldStartRun("idle", false), false);
});

test("shouldStartRun: never fires while a run is already streaming (no double run)", () => {
  assert.equal(shouldStartRun("armed", true), false);
  assert.equal(shouldStartRun("idle", true), false);
});

// ---------------------------------------------------------------------------
// Sequences — the two reachable user paths through the gate
// ---------------------------------------------------------------------------

test("sequence: idle → arm → confirm starts exactly one run, then disarms", () => {
  let phase: GatePhase = "idle";
  assert.equal(shouldStartRun(phase, false), false); // step-1 button showing: no run

  phase = nextGatePhase("arm"); // user clicks "Run live extraction…"
  assert.equal(phase, "armed");
  assert.equal(shouldStartRun(phase, false), true); // confirm would fire the run

  phase = nextGatePhase("confirm"); // caller calls start() on this transition
  assert.equal(phase, "idle");
  // Run is now streaming (running = true) → the disarmed gate cannot re-fire.
  assert.equal(shouldStartRun(phase, true), false);
});

test("sequence: idle → arm → cancel returns to idle without ever arming a run", () => {
  let phase: GatePhase = nextGatePhase("arm");
  assert.equal(phase, "armed");

  phase = nextGatePhase("cancel");
  assert.equal(phase, "idle");
  assert.equal(shouldStartRun(phase, false), false);
});

// ---------------------------------------------------------------------------
// canConfirm — the arming-guard window that stops an arm-and-fire in one
// keydown/key-repeat motion (the safety fix for issue #9's held/double Enter)
// ---------------------------------------------------------------------------

test("canConfirm: never confirms while un-armed", () => {
  assert.equal(canConfirm(null, 10_000), false);
});

test("canConfirm: blocked inside the guard window (double-Enter / key-repeat)", () => {
  const armedAt = 1_000;
  assert.equal(canConfirm(armedAt, armedAt), false); // same instant as arming
  assert.equal(canConfirm(armedAt, armedAt + 1), false);
  assert.equal(canConfirm(armedAt, armedAt + ARM_GUARD_MS - 1), false); // last blocked ms
});

test("canConfirm: allowed once the guard window has elapsed", () => {
  const armedAt = 1_000;
  assert.equal(canConfirm(armedAt, armedAt + ARM_GUARD_MS), true); // window edge fires
  assert.equal(canConfirm(armedAt, armedAt + ARM_GUARD_MS + 5_000), true);
});

test("canConfirm: guard window is a positive span", () => {
  assert.ok(ARM_GUARD_MS > 0);
});
