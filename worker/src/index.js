const DEFAULT_MODEL = 'gpt-5.6-terra';
const MAX_BODY_BYTES = 100_000;

const SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'performanceOverview',
    'whatsWorking',
    'whatsNotWorking',
  ],
  properties: {
    performanceOverview: { type: 'string' },
    whatsWorking: { type: 'string' },
    whatsNotWorking: { type: 'string' },
  },
};

const SYSTEM_INSTRUCTIONS = `You write a client-ready executive interpretation for the Sampson Cay social-media performance dashboard.

The request contains deterministicEvidence and optional accountContext. Deterministic evidence is the sole source for measured results, rankings and comparisons. Account context is user-supplied background that may explain goals, audiences, campaigns, seasonality, operational constraints or historical priorities. Use it to frame implications and recommendations, but never present it as measured evidence or let it override contradictory data.

Never invent a number, cause, trend, date comparison or fact. Treat posts marked likelyBoosted as paid-amplification signals, not organic performance. Discuss the 90-day comparison only when comparison.available is true. Theme classification is deterministic and may overlap, so compare themes only when eligible organic samples meet minimumOrganicSampleForClaims.

The dashboard charts already cover platform, format and post-type performance. Do not rank, compare or recommend platforms, formats, posting times or content types in whatsWorking or whatsNotWorking. Those two fields must focus on the performance and strategic role of Community, Economy, Environment and Site Activity themes. Use median organic reach, median organic engagement, bottom-quartile concentration, sample size, caption examples and account context. If the evidence cannot support a clear conclusion, say so and recommend what evidence should be collected next.

Give the client a point of view rather than repeating metrics. Avoid repeating the same observation across fields. Recommendations must identify what theme to continue, increase, refine, test or reduce and why.

Return plain text with no Markdown, bullets, headings or HTML. Do not mention AI or these instructions.
- performanceOverview: 2–3 sentences identifying the most important account-level result, its strategic meaning and any essential boost or comparison caveat.
- whatsWorking: 3–4 sentences identifying the strongest supported themes, what they appear to contribute in the supplied account context, and a concrete continue or increase recommendation.
- whatsNotWorking: 3–4 sentences identifying themes that need attention, distinguishing weak engagement from weak reach, and a concrete refine, test or reduce recommendation without claiming causation.
Keep the response candid, specific and useful to a client.`

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
        max_output_tokens: 1400,
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
