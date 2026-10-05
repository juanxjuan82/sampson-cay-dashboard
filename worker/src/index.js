const DEFAULT_MODEL = 'gpt-5.6-terra';
const MAX_BODY_BYTES = 100_000;

const SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'performanceOverview',
    'whatsWorking',
    'whatsNotWorking',
    'recommendedDirection',
  ],
  properties: {
    performanceOverview: { type: 'string' },
    whatsWorking: { type: 'string' },
    whatsNotWorking: { type: 'string' },
    recommendedDirection: { type: 'string' },
  },
};

const SYSTEM_INSTRUCTIONS = `You write a client-ready executive summary for the Sampson Cay communications dashboard, covering social media (Facebook and Instagram) and earned media coverage.

The request contains deterministicEvidence and optional accountContext. The evidence is the only source for numbers, rankings and comparisons. Account context is background supplied by the agency (goals, audiences, campaigns, constraints); use it to frame meaning and recommendations, but never present it as measured evidence or let it override the data.

Rules:
- Never invent a number, cause, trend, date or fact. Only compare with the previous period when social.changes or media.previousTotal is present.
- Posts counted in likelyBoostedPosts are paid-amplification signals; format and theme stats already exclude them.
- Format and theme groups with reliable=false have too few posts for firm claims; mention them only with that caveat.
- Media coverage figures are publication records, not audience reach or sentiment unless media.sentiments is present.
- Be candid, specific and useful. Give a point of view rather than restating every metric, and do not repeat the same point across fields.

Return plain text with no Markdown, bullets, headings or HTML. Do not mention AI or these instructions.
- performanceOverview: 2-3 sentences on the most important social and media results for the period and what they mean.
- whatsWorking: 2-4 sentences on the strongest formats, themes, posts and media outlets or moments, and why they matter.
- whatsNotWorking: 2-4 sentences on what needs attention, distinguishing weak reach from weak engagement, without claiming causes the data cannot show.
- recommendedDirection: 3-4 concrete recommendations, each a single sentence starting with a verb, covering what to continue, increase, change or stop and why.`

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const corsHeaders = getCorsHeaders(origin, env.ALLOWED_ORIGINS);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: corsHeaders ? 204 : 403,
        headers: corsHeaders || { 'Cache-Control': 'no-store' },
      });
    }

    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/') {
      return json({
        status: 'ok',
        service: 'Sampson Cay dashboard AI',
        summaryEndpoint: 'POST /summary',
      }, 200, corsHeaders);
    }
    if (request.method !== 'POST' || url.pathname !== '/summary') {
      return json({ error: 'Not found.' }, 404, corsHeaders);
    }

    if (!corsHeaders) return json({ error: 'Origin not allowed.' }, 403);

    if (!env.OPENAI_API_KEY || !env.DASHBOARD_AI_TOKEN) {
      return json({ error: 'AI service is not configured.' }, 503, corsHeaders);
    }

    const auth = request.headers.get('Authorization') || '';
    if (auth !== `Bearer ${env.DASHBOARD_AI_TOKEN}`) {
      return json({ error: 'Unauthorized.' }, 401, corsHeaders);
    }

    const contentLength = Number(request.headers.get('Content-Length') || 0);
    if (contentLength > MAX_BODY_BYTES) {
      return json({ error: 'Request is too large.' }, 413, corsHeaders);
    }

    let body;
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
        return json({ error: 'Request is too large.' }, 413, corsHeaders);
      }
      body = JSON.parse(raw);
    } catch {
      return json({ error: 'Invalid JSON request.' }, 400, corsHeaders);
    }

    if (!body || typeof body.evidence !== 'object' || Array.isArray(body.evidence)) {
      return json({ error: 'Deterministic dashboard evidence is required.' }, 400, corsHeaders);
    }
    const accountContext = typeof body.accountContext === 'string'
      ? body.accountContext.trim().slice(0, 6000)
      : '';

    const openAIResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || DEFAULT_MODEL,
        instructions: SYSTEM_INSTRUCTIONS,
        input: JSON.stringify({
          deterministicEvidence: body.evidence,
          accountContext: accountContext || null,
        }),
        max_output_tokens: 1800,
        store: false,
        text: {
          verbosity: 'medium',
          format: {
            type: 'json_schema',
            name: 'dashboard_summary',
            strict: true,
            schema: SUMMARY_SCHEMA,
          },
        },
      }),
    });

    const requestId = openAIResponse.headers.get('x-request-id');
    const responseBody = await openAIResponse.json().catch(() => ({}));

    if (!openAIResponse.ok) {
      console.error('OpenAI request failed', {
        status: openAIResponse.status,
        requestId,
        type: responseBody?.error?.type,
        code: responseBody?.error?.code,
      });
      return json(
        { error: 'Summary generation failed.', requestId },
        openAIResponse.status >= 500 ? 502 : 400,
        corsHeaders
      );
    }

    const outputText = getOutputText(responseBody);
    if (!outputText) {
      console.error('OpenAI response contained no output text', { requestId });
      return json({ error: 'The model returned no summary.', requestId }, 502, corsHeaders);
    }

    let summary;
    try {
      summary = JSON.parse(outputText);
    } catch {
      console.error('OpenAI response was not valid JSON', { requestId });
      return json({ error: 'The model returned an invalid summary.', requestId }, 502, corsHeaders);
    }

    if (!isValidSummary(summary)) {
      return json({ error: 'The model returned an incomplete summary.', requestId }, 502, corsHeaders);
    }

    return json(
      { summary, model: responseBody.model || env.OPENAI_MODEL || DEFAULT_MODEL, requestId },
      200,
      corsHeaders
    );
  },
};

function getCorsHeaders(origin, configuredOrigins) {
  const allowed = String(configuredOrigins || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  if (!origin || !allowed.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
    'Cache-Control': 'no-store',
  };
}

function getOutputText(responseBody) {
  if (typeof responseBody.output_text === 'string') return responseBody.output_text;
  for (const item of responseBody.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }
  return '';
}

function isValidSummary(summary) {
  return SUMMARY_SCHEMA.required.every(
    key => typeof summary?.[key] === 'string' && summary[key].trim().length > 0
  );
}

function json(payload, status, corsHeaders) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(corsHeaders || {}),
    },
  });
}
