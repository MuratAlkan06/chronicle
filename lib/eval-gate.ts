/**
 * Pure state logic for the /eval live-run confirm gate (issue #9).
 *
 * The Case 3 live extraction spends the FINAL remaining scored held-out
 * measurement event (docs/EVAL.md §6), so it must never fire on route mount or
 * from a single stray click. The `/eval` live tab opens on the cached fallback
 * and only starts a real held-out run behind an explicit two-step "arm → confirm"
 * gate. These helpers model that gate as pure functions so the transitions and
 * the start-guard are unit-testable without a DOM (`npm test` only runs
 * `lib/*.test.ts`).
 */

/** Which step of the two-step confirm the gate is currently on. */
export type GatePhase = "idle" | "armed";

/** A user intent dispatched against the gate. */
export type GateIntent = "arm" | "cancel" | "confirm";

/**
 * Pure transition for the two-step gate. The next phase depends only on the
 * intent (the transitions are the same from either phase, by design):
 *
 * - `arm`     → `armed`  — reveal the confirm copy (step 2).
 * - `cancel`  → `idle`   — escape back to the step-1 button.
 * - `confirm` → `idle`   — close the gate; the caller fires the live run on this
 *                          transition, guarded separately by {@link shouldStartRun}
 *                          so this function stays free of side effects.
 */
export function nextGatePhase(intent: GateIntent): GatePhase {
  return intent === "arm" ? "armed" : "idle";
}

/**
 * Safety guard for the confirm action: a live held-out run may start ONLY from
 * the armed phase and ONLY when no run is already streaming. The second clause
 * is what prevents a double run (the gate is hidden while a run is in flight,
 * and this predicate is the belt-and-suspenders check the component makes before
 * calling `start()`).
 */
export function shouldStartRun(phase: GatePhase, running: boolean): boolean {
  return phase === "armed" && !running;
}

/**
 * Arming-guard window, in milliseconds.
 *
 * After the gate is armed, the confirm action is inert for this long. React
 * reuses the arm button's DOM node for the Confirm button (same element type at
 * the same position), so keyboard focus — and an in-flight key-repeat — can
 * carry straight from the arm keydown onto Confirm. Without this window a held
 * or double-tapped Enter could arm the gate AND fire the terminal Case 3 run in
 * a single motion. 400ms comfortably spans a fast double-Enter and a typical OS
 * key-repeat delay while staying imperceptible to a deliberate two-step confirm.
 */
export const ARM_GUARD_MS = 400;

/**
 * Timing guard for the confirm action: a live held-out run may be confirmed only
 * once at least {@link ARM_GUARD_MS} has elapsed since the gate was armed. Kept
 * pure (the component supplies `armedAtMs` — the arm timestamp, or `null` when
 * the gate is idle — and `nowMs`) so the window is unit-testable without a DOM.
 *
 * Returns `false` while un-armed or still inside the guard window; `true` once
 * the window has elapsed.
 */
export function canConfirm(armedAtMs: number | null, nowMs: number): boolean {
  if (armedAtMs === null) return false;
  return nowMs - armedAtMs >= ARM_GUARD_MS;
}
