type Env = {
  OPENAI_API_KEY: string;
};

const RESPONSES_API_URL = "https://api.openai.com/v1/responses";
const OPENAI_RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);

function logExecutor(event: string, fields: Record<string, unknown> = {}) {
  console.info(JSON.stringify({ service: "worker-executor", component: "openai", event, ...fields }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function textResponse(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

async function callResponsesApi(
  payload: Record<string, unknown>,
  apiKey: string,
  maxRetries: number,
): Promise<Response> {
  let lastError: Error | null = null;
  const model = typeof payload.model === "string" ? payload.model : null;
  const stream = payload.stream === true;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      logExecutor("openai_responses_call_start", { model, stream, attempt, max_retries: maxRetries });
      const response = await fetch(RESPONSES_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });
      logExecutor("openai_responses_call_status", { model, stream, attempt, status: response.status });

      if (OPENAI_RETRYABLE_STATUS.has(response.status) && attempt < maxRetries) {
        const delay = Math.min(300 * Math.pow(2, attempt) + Math.random() * 200, 1500);
        await sleep(delay);
        continue;
      }

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logExecutor("openai_responses_call_error", {
        model,
        stream,
        attempt,
        error: lastError.message.slice(0, 500),
      });
      if (attempt < maxRetries) {
        const delay = Math.min(300 * Math.pow(2, attempt) + Math.random() * 200, 1500);
        await sleep(delay);
        continue;
      }
    }
  }

  throw lastError ?? new Error("OpenAI API request failed");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      logExecutor("executor_rejected_method", { method: request.method });
      return textResponse("Method not allowed", 405);
    }

    const apiKey = env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      logExecutor("executor_missing_openai_key");
      return textResponse("OPENAI_API_KEY missing", 500);
    }

    let body: { payload?: unknown; maxRetries?: unknown };
    try {
      body = (await request.json()) as { payload?: unknown; maxRetries?: unknown };
    } catch {
      logExecutor("executor_invalid_json");
      return textResponse("Invalid JSON", 400);
    }

    if (!body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)) {
      logExecutor("executor_invalid_payload");
      return textResponse("Invalid payload", 400);
    }

    const maxRetries =
      typeof body.maxRetries === "number" && Number.isFinite(body.maxRetries)
        ? Math.max(0, Math.min(4, Math.floor(body.maxRetries)))
        : 1;
    const payload = body.payload as Record<string, unknown>;
    logExecutor("executor_request_received", {
      model: typeof payload.model === "string" ? payload.model : null,
      stream: payload.stream === true,
      max_retries: maxRetries,
    });

    try {
      return await callResponsesApi(payload, apiKey, maxRetries);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logExecutor("executor_request_failed", { error: message.slice(0, 500) });
      return textResponse(message, 502);
    }
  },
};
