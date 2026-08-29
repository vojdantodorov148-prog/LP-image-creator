import { json, kieFetch, parseJsonLoose, extractChatContent } from './_shared.mjs';

const schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page_summary: { type: 'string' },
    detected_language: { type: 'string' },
    image_slots: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          placement_reason: { type: 'string' },
          section_context: { type: 'string' },
          y_percent: { type: 'number' },
          source: { type: 'string', enum: ['existing_placeholder', 'ai_suggested'] },
          google_search: { type: 'string' },
          image_prompt: { type: 'string' },
          recommended_ratio: { type: 'string', enum: ['4:5','1:1','3:4','4:3','3:2','2:3','16:9','9:16','auto'] }
        },
        required: ['title','placement_reason','section_context','y_percent','source','google_search','image_prompt','recommended_ratio']
      }
    }
  },
  required: ['page_summary','detected_language','image_slots']
};

function modeInstruction(mode) {
  if (mode === 'placeholders') return 'Use ONLY visibly empty image placeholders/obvious missing-image blocks. Do not invent extra placements.';
  if (mode === 'visual') return 'Be visually proactive. Detect placeholders AND add useful image placements where a strong visual would improve comprehension, credibility, emotion, pacing, mechanism explanation, product proof or storytelling. Avoid decorative filler.';
  return 'Balanced mode: detect all visible placeholders first, then add only high-value placements where the advertorial clearly benefits from a visual. Do not overpopulate the page.';
}

function buildPrompt(images, mode) {
  const segmentMap = images.map((im, i) => `Segment ${i+1}: global vertical range ${Number(im.startPercent).toFixed(2)}%–${Number(im.endPercent).toFixed(2)}%`).join('\n');
  return `You are an expert direct-response advertorial visual editor and performance creative strategist.

You are given sequential vertical screenshots of ONE finished advertorial or listicle page with images missing. The screenshots together form the complete page from top to bottom.

TASK
1. Read the actual page copy and understand the story, offer, avatar, product, claims, sections and layout.
2. Detect every obvious empty image placeholder, blank image frame, missing media block, or image-shaped gap.
3. ${modeInstruction(mode)}
4. For every selected placement, output TWO parallel production paths:
   A) a short natural-language Google Images search phrase that can realistically find a usable reference/photo (example: "middle aged woman awake in bed at 3am tired"). Do NOT write an SEO sentence; write what a human would type into Google Images.
   B) a production-ready detailed prompt for an image generator. It must be specific to the surrounding advertorial copy and describe subject, approximate age/identity only when supported or strategically appropriate, emotion, action, environment, composition, camera distance/angle, lighting, photographic realism/style, imperfections, wardrobe/props when relevant, and what to avoid. Default to believable native advertorial/editorial photography, not glossy ad creative. Unless the page clearly needs a diagram/illustration, avoid text overlays, logos, UI, watermarks and typography in generated images.
5. Recommend the best aspect ratio for the specific placement. Prefer 4:5 for portrait/editorial blocks, 1:1 when square fits, 16:9/3:2/4:3 for wide editorial images, and 9:16 only when clearly useful.
6. Return y_percent as the GLOBAL vertical center of the placement on the FULL page, from 0 at the top to 100 at the bottom. Use the segment ranges below to estimate it accurately.
7. Keep placements ordered top-to-bottom. Avoid duplicate visuals that communicate the same idea.
8. If a section makes a medical/scientific mechanism claim, prefer an explanatory but non-deceptive illustration/diagram prompt rather than fake clinical evidence. If social proof is present, do not fabricate identifiable real people or fake news/media endorsements.

SEGMENT MAP
${segmentMap}

The output must be valid JSON matching the requested schema. Do not add commentary outside JSON.`;
}

async function callGemini(imageUrls, images, mode, reasoning, withSchema = true) {
  const content = [{ type: 'text', text: buildPrompt(images, mode) }];
  imageUrls.forEach((url, i) => {
    content.push({ type: 'text', text: `SEGMENT ${i+1} — global y ${images[i].startPercent.toFixed(2)}% to ${images[i].endPercent.toFixed(2)}%` });
    content.push({ type: 'image_url', image_url: { url } });
  });
  const body = {
    messages: [{ role: 'user', content }],
    stream: false,
    include_thoughts: false,
    reasoning_effort: ['low','medium','high'].includes(reasoning) ? reasoning : 'medium'
  };
  if (withSchema) body.response_format = { type: 'json_schema', json_schema: { name: 'advertorial_image_plan', strict: true, schema } };
  return kieFetch('/gemini-3-7-flash-openai/v1/chat/completions', { method: 'POST', body: JSON.stringify(body) });
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  try {
    const body = JSON.parse(event.body || '{}');
    const images = Array.isArray(body.images) ? body.images.slice(0, 16) : [];
    if (!images.length) return json(400, { error: 'No screenshot segments received.' });
    const valid = images.every(x => {
      try {
        const u = new URL(x?.url);
        return u.protocol === 'https:' && (u.hostname.endsWith('.redpandaai.co') || u.hostname === 'redpandaai.co' || u.hostname.endsWith('.kie.ai') || u.hostname === 'kie.ai');
      } catch { return false; }
    });
    if (!valid) return json(400, { error: 'Invalid screenshot URL.' });
    const uploaded = images.map(x => x.url);

    let response;
    try {
      response = await callGemini(uploaded, images, body.mode || 'balanced', body.reasoning || 'medium', true);
    } catch (e) {
      if (e.status === 400) response = await callGemini(uploaded, images, body.mode || 'balanced', body.reasoning || 'medium', false);
      else throw e;
    }
    const raw = extractChatContent(response);
    const analysis = parseJsonLoose(raw);
    if (!Array.isArray(analysis?.image_slots)) throw new Error('Gemini response did not contain image_slots.');
    analysis.image_slots = analysis.image_slots
      .filter(Boolean)
      .map(s => ({ ...s, y_percent: Math.min(99, Math.max(1, Number(s.y_percent) || 50)) }))
      .sort((a,b) => a.y_percent - b.y_percent);
    return json(200, { analysis, creditsConsumed: response?.credits_consumed ?? response?.usage?.credits_consumed ?? null });
  } catch (e) {
    console.error(e);
    return json(e.status && e.status >= 400 && e.status < 600 ? e.status : 500, { error: e.message || 'Analysis failed.' });
  }
}
