// Per-runId AbortController registry — same shape and same single-process
// caveat as runBus.ts's pub/sub map (see that file's comment). This is
// deliberately NOT a global lock: cancelling run A only ever touches run
// A's own entry, and has zero effect on any other run's controller. It
// exists purely so a *different* HTTP request (the cancel route) can reach
// into an in-flight executeChatRun call it isn't otherwise connected to.
const controllers = new Map<string, AbortController>();

export function registerRun(runId: string): AbortController {
  const controller = new AbortController();
  controllers.set(runId, controller);
  return controller;
}

export function unregisterRun(runId: string): void {
  controllers.delete(runId);
}

// Returns false if the run isn't currently tracked — already finished,
// never existed, or (if this ever runs as more than one instance) owned by
// a different process. The caller treats that as "nothing to cancel"
// rather than an error.
export function cancelRun(runId: string): boolean {
  const controller = controllers.get(runId);
  if (!controller) return false;
  controller.abort();
  return true;
}
