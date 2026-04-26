# noruct-chat-openai-executor

Cloudflare Worker invoked only via **service binding** from the Noruct chat Gate (`CHAT_OPENAI_EXECUTOR`). Forwards OpenAI **Responses API** `POST /v1/responses` with the Gate’s JSON body `{ "payload": { … }, "maxRetries"?: number }`.

## Deploy

```bash
npm install
npx wrangler secret put OPENAI_API_KEY
npx wrangler deploy
```

Worker name in `wrangler.toml` must match the Gate binding `service` (default: `noruct-chat-openai-executor`).

Source of truth in the monorepo: `nonopro/workers/chat-openai/src/executor.ts` and `wrangler.executor.toml` — keep in sync when changing executor behavior.
