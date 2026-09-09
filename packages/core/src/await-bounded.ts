/**
 * Wait for `promise`, but no longer than `timeoutMs`.
 *
 * Shutdown is full of waits that must not become hangs: a handler that never settles, a socket
 * whose close callback never arrives, a job that ignores the signal. Each of them needs the same
 * shape — wait, but give up — and each of them needs the timer cleared afterwards, or a drain that
 * finishes in a millisecond holds the event loop open for the rest of the bound and turns a
 * graceful shutdown into a pause the length of the timeout.
 *
 * Never rejects: a failed wait is still a finished wait, and the caller's next step is the same
 * either way.
 */
export async function awaitBounded(promise: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  await Promise.race([
    promise.then(() => undefined, () => undefined),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    }),
  ]);

  if (timer !== undefined) {
    clearTimeout(timer);
  }
}
