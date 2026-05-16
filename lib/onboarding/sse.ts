/**
 * SSE (Server-Sent Events) primitives for Next.js 15 Route Handlers.
 *
 * Produces ReadableStream<Uint8Array> compatible with:
 *   new Response(stream, { headers: { "Content-Type": "text/event-stream", ... } })
 */

const encoder = new TextEncoder();

/**
 * Formats a single SSE frame.
 * Returns the literal string:
 *   "event: <event>\ndata: <JSON.stringify(data)>\n\n"
 */
export function sseFrame(event: string, data: unknown): string {
  return "event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n";
}

/**
 * Wraps an async producer function in a ReadableStream<Uint8Array>.
 *
 * The `generate` function receives a `write(event, data)` callback that
 * enqueues UTF-8 encoded SSE frames into the stream.
 *
 * If `signal` is provided and aborted mid-stream, the controller is closed
 * cleanly without throwing.
 *
 * Any error thrown by `generate` that reaches the top level is swallowed
 * (the producer should emit an `error` frame before throwing, but the
 * finally block ensures the stream is always closed).
 */
export function sseEventStream(
  generate: (write: (event: string, data: unknown) => void) => Promise<void>,
  signal?: AbortSignal,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (event: string, data: unknown) => {
        // Silently ignore writes after close (e.g. if AbortSignal fired)
        try {
          controller.enqueue(encoder.encode(sseFrame(event, data)));
        } catch {
          // controller already closed — ignore
        }
      };

      // Handle abort: close the stream cleanly without throwing
      let aborted = false;
      const onAbort = () => {
        aborted = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      signal?.addEventListener("abort", onAbort);

      try {
        await generate(write);
      } catch {
        // The producer should have emitted an error frame already.
        // We do NOT re-throw — just let the finally block close the stream.
      } finally {
        signal?.removeEventListener("abort", onAbort);
        if (!aborted) {
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      }
    },
  });
}
