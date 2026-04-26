type Env = {
  OPENAI_API_KEY: string;
};

const RESPONSES_API_URL = "https://api.openai.com/v1/responses";
const OPENAI_RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callResponsesApi(
  payload: Record<string, unknown>,
  apiKey: string,
  maxRetries = 1,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(RESPONSES_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      if (OPENAI_RETRYABLE_STATUS.has(response.status)) {
        const errorText = await response.text();
        if (attempt === maxRetries) {
          throw new Error(`OpenAI API ${response.status}: ${errorText}`);
        }
        const delay = Math.min(300 * Math.pow(2, attempt) + Math.random() * 200, 1500);
        await sleep(delay);
        continue;
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API ${response.status}: ${errorText}`);
      }

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === maxRetries) break;
      await sleep(250);
    }
  }

  throw lastError ?? new Error("OpenAI 호출 실패");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return jsonError("Method Not Allowed", 405);
    }

    const apiKey = env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return jsonError("OPENAI_API_KEY missing", 500);
    }

    let body: { payload?: unknown; maxRetries?: unknown };
    try {
      body = (await request.json()) as { payload?: unknown; maxRetries?: unknown };
    } catch {
      return jsonError("invalid_json", 400);
    }

    if (!body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)) {
      return jsonError("invalid_payload", 400);
    }

    try {
      return await callResponsesApi(
        body.payload as Record<string, unknown>,
        apiKey,
        typeof body.maxRetries === "number" ? body.maxRetries : 1,
      );
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error), 502);
    }
  },
};
