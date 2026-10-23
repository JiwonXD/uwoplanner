// Cloudflare Worker for the trade assistant. Holds the Claude API key (secret ANTHROPIC_API_KEY), checks the
// caller's origin and a per-IP daily limit, and streams the answer back as server-sent events:
//   data: {"text": "..."}   text as it arrives
//   data: {"done": true}    end of answer
//   data: {"error": "..."}  failure (message is safe to show)
import Anthropic from '@anthropic-ai/sdk';
import {staticContext, dynamicContext} from './context.js';
import {cleanMessages} from './validate.js';

const STATIC = staticContext();

function cors(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  return allowed.includes(origin) ? {'Access-Control-Allow-Origin': origin, 'Vary': 'Origin'} : null;
}
const json = (body, status, headers) => new Response(JSON.stringify(body), {status, headers: {...headers, 'Content-Type': 'application/json'}});

// Per-IP daily counter in KV. Optional: without the LIMITS binding the Worker relies on the account's
// Anthropic spend limit alone.
async function overLimit(request, env) {
  if (!env.LIMITS) return false;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const key = `${new Date().toISOString().slice(0, 10)}:${ip}`;
  const used = Number(await env.LIMITS.get(key)) || 0;
  if (used >= Number(env.DAILY_LIMIT || 30)) return true;
  await env.LIMITS.put(key, String(used + 1), {expirationTtl: 60 * 60 * 26});
  return false;
}

export default {
  async fetch(request, env) {
    const headers = cors(request.headers.get('Origin') || '', env);
    if (!headers) return new Response('Forbidden', {status: 403});
    if (request.method === 'OPTIONS') {
      return new Response(null, {status: 204, headers: {...headers, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400'}});
    }
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/chat') return json({error: '지원하지 않는 요청이에요.'}, 404, headers);

    let body;
    try { body = await request.json(); } catch { return json({error: '요청 형식이 올바르지 않아요.'}, 400, headers); }
    const messages = cleanMessages(body?.messages);
    if (!messages) return json({error: '질문을 다시 입력해 주세요.'}, 400, headers);
    if (await overLimit(request, env)) return json({error: '오늘 질문 횟수를 모두 썼어요. 내일 다시 이용해 주세요.'}, 429, headers);

    const client = new Anthropic({apiKey: env.ANTHROPIC_API_KEY});
    const {readable, writable} = new TransformStream();
    const writer = writable.getWriter(), encoder = new TextEncoder();
    const send = data => writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

    (async () => {
      try {
        const stream = client.beta.messages.stream({
          model: env.MODEL || 'claude-opus-5-5',
          max_tokens: 4000,
          output_config: {effort: 'low'}, // short factual chat answers
          // Re-run a safety-declined request on Anthropic's recommended fallback model instead of failing.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          system: [
            {type: 'text', text: STATIC, cache_control: {type: 'ephemeral'}}, // identical every request: cached
            {type: 'text', text: dynamicContext(Date.now())},
          ],
          messages,
        });
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') await send({text: event.delta.text});
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === 'refusal') await send({error: '이 질문에는 답할 수 없어요. 교역 이벤트에 대해 물어봐 주세요.'});
        await send({done: true});
      } catch (error) {
        const status = error instanceof Anthropic.APIError ? error.status : 0;
        console.error('chat failed', status, error?.message); // visible in `wrangler tail`; no user text logged
        await send({error: status === 429 || status === 529 ? '지금 요청이 많아요. 잠시 뒤 다시 시도해 주세요.' : '답변을 만들지 못했어요. 잠시 뒤 다시 시도해 주세요.'});
      } finally {
        await writer.close();
      }
    })();

    return new Response(readable, {headers: {...headers, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store'}});
  },
};
