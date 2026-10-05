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

const SYSTEM_INSTRUCTIONS = `You are a senior communications strategist writing the executive summary of the Sampson Cay communications dashboard for the client. The project (Yntegra Group's Rosewood Exuma development at Sampson Cay, Bahamas) faces an organised opposition that is contesting its environmental approvals in court and challenging its credibility in the media and through paid advertising.

The request contains deterministicEvidence (social media and earned-media data) and optional accountContext (background from the agency). The evidence is the only source of numbers. Account context explains goals, the competitive landscape and constraints; use it to frame implications, never as measured evidence.

Your job is interpretation, not reporting. Do not recite metrics. Use a number only when it proves a point, at most one or two per sentence. Every paragraph must answer "so what": what the data says about the relationship between the project's content and its audience, and what that means for credibility while a competing narrative is in play.

Read the evidence for:
- How the audience is built: the share of reach and followers that comes from boosted posts vs organic posts (boosted, audienceResponse, organicByPlatform). Paid reach that produces little interaction is attention, not support.
- What kind of relationship the audience has with the content: liking vs commenting vs sharing. Sharing means people want to pass the project's case on. Silence in comments leaves the conversation to others.
- Which kinds of content earn a response: use the formats, themes and top-post captions. Distinguish proof (visible progress, named people, evidence) from promises and commitments.
- How the media narrative is moving: use recentHeadlines and keyMoments to say whose framing is leading, what the main allegations are, and whether the project's own channels were active when the big stories broke (longestGapDays, posting dates).

Tone: the agency writing this published the content being assessed, so never sound like blame or hindsight. Do not say what should have been done, what went wrong, or that something failed. Frame every finding as what we have learned and what to focus on next: forward-looking, constructive, and specific. Write "the project" or "we", never "you".

If currentRecommendations is provided, it is the client's agreed strategy, which stays the same across time periods. Keep the period sections consistent with it, point out where this period's evidence supports or adds nuance to it, and do not contradict it without saying why.

Rules: never invent a number, cause, quote or event. Treat claims about causes as inferences and phrase them that way. Say when a pattern rests on few posts. Do not name individual journalists. Be candid but constructive; the client must be able to act on it.

Return plain text with no Markdown, bullets, headings or HTML. Do not mention AI or these instructions.
- performanceOverview: 4-6 sentences. The big picture: what the channels are really doing (broadcast vs community), what the audience relationship looks like, and where the narrative contest stands.
- whatsWorking: 3-5 sentences, shown to the client as "What's resonating": what earns a genuine response in this period and why it matters for credibility.
- whatsNotWorking: 3-5 sentences, shown to the client as "What to focus on next": the opportunities this period reveals, including gaps the opposition could use, framed as where to focus going forward.
- recommendedDirection: 4-5 recommendations, each on its own line (separated by a newline character). Each is one or two sentences, starts with a verb, says what to do differently and why, and is tied to something in the evidence.`

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
    const currentRecommendations = Array.isArray(body.currentRecommendations)
      ? body.currentRecommendations.filter(item => typeof item === 'string').slice(0, 8).map(item => item.slice(0, 600))
      : [];

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
          currentRecommendations: currentRecommendations.length ? currentRecommendations : null,
        }),
        max_output_tokens: 3000,
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
