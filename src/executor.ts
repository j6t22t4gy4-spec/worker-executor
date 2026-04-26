type Env = {
  OPENAI_API_KEY: string;
};

const RESPONSES_API_URL = "https://api.openai.com/v1/responses";
const OPENAI_RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);

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

      if (OPENAI_RETRYABLE_STATUS.has(response.status) && attempt < maxRetries) {
        const delay = Math.min(300 * Math.pow(2, attempt) + Math.random() * 200, 1500);
        await sleep(delay);
        continue;
      }

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
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
      return textResponse("Method not allowed", 405);
    }

    const apiKey = env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return textResponse("OPENAI_API_KEY missing", 500);
    }

    let body: { payload?: unknown; maxRetries?: unknown };
    try {
      body = (await request.json()) as { payload?: unknown; maxRetries?: unknown };
    } catch {
      return textResponse("Invalid JSON", 400);
    }

    if (!body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)) {
      return textResponse("Invalid payload", 400);
    }

    const maxRetries =
      typeof body.maxRetries === "number" && Number.isFinite(body.maxRetries)
        ? Math.max(0, Math.min(4, Math.floor(body.maxRetries)))
        : 1;

    try {
      return await callResponsesApi(body.payload as Record<string, unknown>, apiKey, maxRetries);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return textResponse(message, 502);
    }
  },
};
