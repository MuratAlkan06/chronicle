/**
 * Chronicle — SSE helpers.
 *
 * Per docs/BACKEND-STANDARDS.md §J.2:
 *  - one event per `data: <json>\n\n` frame
 *  - heartbeat (`: ping\n\n`) every 15s to defeat aggressive proxy timeouts
 *  - propagate AbortSignal: close the stream + clear the heartbeat when the
 *    client disconnects
 */

const HEARTBEAT_MS = 15_000;

/** Format an SSE data frame. Caller passes a JSON-serializable payload. */
export function sseEvent(type: string, payload: Record<string, unknown> = {}): string {
  return `data: ${JSON.stringify({ type, ...payload })}\n\n`;
}

export interface CreateSseStreamOptions {
  /**
   * Producer function. Receives an `enqueue` callback that the producer uses
   * to push frames (already in `data: ...\n\n` format) to the client. The
   * stream closes when this Promise resolves OR when `signal` aborts.
   */
  start: (enqueue: (frame: string) => void) => Promise<void>;
  /** AbortSignal from the originating Request (closes stream on disconnect). */
  signal?: AbortSignal;
}

/**
 * Wrap a producer in a ReadableStream<Uint8Array>. Manages the heartbeat
 * interval and tears it down on close/abort.
 */
export function createSseStream({ start, signal }: CreateSseStreamOptions): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | null = null;

      const safeClose = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };

      const enqueue = (frame: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          // Controller errored / closed — give up silently.
          safeClose();
        }
      };

      // Heartbeat: comment frame, ignored by the EventSource consumer but
      // keeps any intermediary from idling-out the connection.
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          safeClose();
        }
      }, HEARTBEAT_MS);

      // Honor caller cancellation immediately.
      const onAbort = () => safeClose();
      if (signal) {
        if (signal.aborted) {
          safeClose();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }

      try {
        await start(enqueue);
      } catch (err) {
        // Producer errored — try to send a final SSE error frame so the
        // client knows the stream is done, then close.
        try {
          const message = err instanceof Error ? err.message : String(err);
          controller.enqueue(
            encoder.encode(sseEvent("error", { code: "internal_error", message, retryable: false })),
          );
        } catch {
          // Ignore.
        }
      } finally {
        if (signal) signal.removeEventListener("abort", onAbort);
        safeClose();
      }
    },
    cancel() {
      // Consumer cancelled — nothing else to do; the start() finally
      // clause already cleans up if the producer is still running.
    },
  });
}

/** Standard `Response` wrapper for an SSE stream. Headers per J.2. */
export function sseResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Defeats nginx-style buffering even on local dev (paranoia, cheap).
      "X-Accel-Buffering": "no",
    },
  });
}
