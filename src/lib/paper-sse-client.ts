/**
 * Authenticated fetch-based SSE stream client for MAET paper trading.
 * Replaces native EventSource to send Bearer token in Authorization headers.
 */

export interface SseEvent {
  type: string;
  data: unknown;
}

export interface ConnectPaperTradingStreamOptions {
  accessToken: string;
  signal?: AbortSignal;
  onOpen?: () => void;
  onEvent?: (event: SseEvent) => void;
  onHeartbeat?: () => void;
  onError?: (error: Error) => void;
}

export async function connectPaperTradingStream(
  options: ConnectPaperTradingStreamOptions
): Promise<void> {
  const { accessToken, signal, onOpen, onEvent, onHeartbeat, onError } = options;

  if (signal?.aborted) {
    return;
  }

  try {
    const res = await fetch("/api/paper/stream", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "text/event-stream",
      },
      signal,
    });

    if (!res.ok) {
      const errorMsg = `SSE connection failed with HTTP status ${res.status}`;
      onError?.(new Error(errorMsg));
      return;
    }

    if (!res.body) {
      onError?.(new Error("SSE stream body unavailable"));
      return;
    }

    onOpen?.();

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    let currentEventName = "message";
    let currentDataLines: string[] = [];

    const processLine = (line: string) => {
      // SSE comments / heartbeats
      if (line.startsWith(":")) {
        if (line.toLowerCase().includes("heartbeat") || line.toLowerCase().includes("ping")) {
          onHeartbeat?.();
        }
        return;
      }

      if (line.trim() === "") {
        // Frame boundary
        if (currentDataLines.length > 0) {
          const rawData = currentDataLines.join("\n");
          let parsedData: unknown = rawData;
          try {
            parsedData = JSON.parse(rawData);
          } catch {
            // Raw text
          }

          if (currentEventName === "heartbeat") {
            onHeartbeat?.();
          } else {
            onEvent?.({ type: currentEventName, data: parsedData });
          }
        }
        currentEventName = "message";
        currentDataLines = [];
        return;
      }

      if (line.startsWith("event:")) {
        currentEventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        const val = line.slice(5);
        currentDataLines.push(val.startsWith(" ") ? val.slice(1) : val);
      }
    };

    while (!signal?.aborted) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r\n|\r|\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        processLine(line);
      }
    }

    if (buffer.length > 0) {
      processLine(buffer);
      processLine("");
    }
  } catch (err) {
    if (signal?.aborted || (err instanceof Error && err.name === "AbortError")) {
      return;
    }
    onError?.(err instanceof Error ? err : new Error(String(err)));
  }
}
