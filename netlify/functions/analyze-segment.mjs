import { json, kieFetch, parseJsonLoose, extractChatContent } from './_shared.mjs';

const slotSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    title: { type: 'string' },
    section_title: { type: 'string' },
    section_context: { type: 'string' },
    slot_type: { type: 'string', enum: ['problem_image','lifestyle_image','ingredient_image','mechanism_image','testimonial_support','authority_trust','product_support','before_after_support','section_opener','other'] },
    source_type: { type: 'string', enum: ['existing_image','empty_placeholder','ai_suggested'] },
    action: { type: 'string', enum: ['keep','replace','add','review'] },
    confidence: { type: 'number' },
    priority: { type: 'string', enum: ['high','medium','low'] },
    reason: { type: 'string' },
    current_image_description: { type: 'string' },
    google_search: { type: 'string' },
    image_prompt: { type: 'string' },
    recommended_ratio: { type: 'string', enum: ['4:5','1:1','3:4','4:3','3:2','2:3','16:9','9:16','auto'] },
    bbox: {
      type: 'object', additionalProperties: false,
      properties: {
        x_percent: { type: 'number' }, y_percent: { type: 'number' }, width_percent: { type: 'number' }, height_percent: { type: 'number' }
      },
      required: ['x_percent','y_percent','width_percent','height_percent']
    }
  },
  required: ['title','section_title','section_context','slot_type','source_type','action','confidence','priority','reason','current_image_description','google_search','image_prompt','recommended_ratio','bbox']
};

const schema = {
  type:'object', additionalProperties:false,
  properties:{
    page_summary:{type:'string'}, detected_language:{type:'string'}, image_slots:{type:'array',items:slotSchema}
  },
  required:['page_summary','detected_language','image_slots']
};

function placementInstruction(mode) {
  if (mode === 'placeholders') return 'For NEW placements, only use visually obvious empty/missing image placeholders. Do not invent additional image locations.';
  if (mode === 'visual') return 'Be visually proactive: besides visible media blocks, add high-value visual opportunities that improve emotion, comprehension, trust, mechanism explanation or pacing. Avoid filler and avoid overcrowding.';
  return 'Balanced placement: prioritize obvious media blocks and add only a small number of genuinely high-value missing visuals. Do not overpopulate the page.';
}

function auditInstruction(auditMode) {
  if (auditMode === 'empty') return `IGNORE all existing images as candidates. Return only visible empty image placeholders plus appropriate missing image opportunities allowed by placement mode. Every returned action must be "add".`;
  if (auditMode === 'replace') return `Return ONLY existing content images in this segment. Every returned action must be "replace" and you must create a materially better Google search phrase and generation prompt for the same role in the advertorial. Do not return empty/new slots.`;
  if (auditMode === 'force') return `Audit existing content images and treat EVERY existing content image as "replace", even if it is acceptable. Also return obvious empty placeholders or strong missing image opportunities as "add" when the placement rule allows it. Never output "keep" for an existing image.`;
  return `SMART AUDIT: inspect every meaningful existing content image and decide "keep" or "replace" based on relevance to nearby copy, emotional match, credibility/trust value, native advertorial fit, clarity and whether it looks generic/stock/polished like an ad. Also return empty placeholders and strong missing image opportunities as "add". Use "review" only when genuinely ambiguous.`;
}

function promptFor({ image, segmentNumber, totalSegments, auditMode, mode }) {
  return `You are a direct-response advertorial visual editor. You are analyzing SEGMENT ${segmentNumber} of ${totalSegments} from one long advertorial/listicle screenshot.

GLOBAL LOCATION
This screenshot segment corresponds to approximately ${Number(image.startPercent).toFixed(2)}%–${Number(image.endPercent).toFixed(2)}% of the full page.

GOAL
Create a production-ready image audit for THIS segment. The full page may already contain good images, weak images, empty placeholders, or no image placeholders at all.

AUDIT MODE
${auditInstruction(auditMode)}

PLACEMENT MODE
${placementInstruction(mode)}

WHAT COUNTS AS AN IMAGE SLOT
- Meaningful editorial/content photography
- Product-support imagery
- Ingredient imagery
- Mechanism/explanatory visuals
- Testimonial-support visuals
- Authority/trust visuals
- Before/after-support visuals when present or contextually appropriate
- Obvious empty media placeholders
- Strong missing visual opportunities allowed by the placement mode

IGNORE
- Site logos, tiny icons, nav elements, stars, buttons, payment icons, generic badges, separators, decorative shapes and UI chrome unless they are clearly a major content visual.

FOR EXISTING IMAGES
Describe what the current image appears to show in current_image_description. Judge it against the nearby copy. "Replace" when it is generic, emotionally weak, visually mismatched, too polished/ad-like, confusing, repetitive, low-trust, poor storytelling, or simply a weaker choice than a clearly better visual. "Keep" only when it already supports the exact section effectively.

FOR EACH REPLACE OR ADD SLOT
1. google_search: write the short phrase a human would type into Google Images. Natural, concrete, no SEO wording.
2. image_prompt: write a full detailed production prompt tailored to the surrounding advertorial copy. Specify subject, approximate age only when appropriate, emotion, action, setting, composition, camera distance/angle, lighting, realism, useful imperfections, wardrobe/props, editorial/native advertorial feel, and what to avoid. Unless an illustration/diagram is genuinely better, favor believable native/editorial photography rather than glossy ad creative. Avoid text overlays, logos, watermarks, fake UI and invented media endorsements.
3. recommended_ratio: choose the practical ratio for the placement.

FOR KEEP SLOTS
Still provide an alternative Google search phrase and image prompt so the user can later switch the action to Replace without re-running the audit.

BBOX
Return bbox as percentages RELATIVE TO THIS SEGMENT: x_percent, y_percent, width_percent, height_percent. For an existing image or empty placeholder, tightly approximate the visible region. For an AI-suggested new location, approximate the intended content width and vertical location where it should be inserted.

PRIORITY
- high = main story/problem/proof/mechanism/trust visual with meaningful conversion or comprehension value
- medium = useful supporting visual
- low = optional visual

Use confidence from 0 to 1. Keep outputs in visual top-to-bottom order. Do not duplicate the same visual idea within the segment.
Return ONLY valid JSON matching the schema.`;
}

function validKieUrl(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && (u.hostname.endsWith('.redpandaai.co') || u.hostname === 'redpandaai.co' || u.hostname.endsWith('.kie.ai') || u.hostname === 'kie.ai');
  } catch { return false; }
}

async function callGemini(payload, withSchema=true) {
  const content = [
    { type:'text', text:promptFor(payload) },
    { type:'image_url', image_url:{ url:payload.image.url } }
  ];
  const body = {
    messages:[{role:'user',content}], stream:false, include_thoughts:false,
    reasoning_effort:['low','medium','high'].includes(payload.reasoning) ? payload.reasoning : 'medium'
  };
  if (withSchema) body.response_format={type:'json_schema',json_schema:{name:'advertorial_segment_audit',strict:true,schema}};
  return kieFetch('/gemini-3-7-flash-openai/v1/chat/completions',{method:'POST',body:JSON.stringify(body)});
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405,{error:'Method not allowed'});
  try {
    const body=JSON.parse(event.body||'{}');
    const image=body.image||{};
    if (!validKieUrl(image.url)) return json(400,{error:'Invalid screenshot URL.'});
    if (!Number.isFinite(Number(image.startPercent)) || !Number.isFinite(Number(image.endPercent))) return json(400,{error:'Invalid segment range.'});
    const payload={...body,image};
    let response;
    try { response=await callGemini(payload,true); }
    catch(e){ if(e.status===400) response=await callGemini(payload,false); else throw e; }
    const analysis=parseJsonLoose(extractChatContent(response));
    if(!Array.isArray(analysis?.image_slots)) throw new Error('Gemini response did not contain image_slots.');
    analysis.image_slots=analysis.image_slots.filter(Boolean).map(s=>({
      ...s,
      confidence:Math.min(1,Math.max(0,Number(s.confidence)||0.5)),
      bbox:{
        x_percent:Math.min(99,Math.max(0,Number(s.bbox?.x_percent)||0)),
        y_percent:Math.min(99,Math.max(0,Number(s.bbox?.y_percent)||0)),
        width_percent:Math.min(100,Math.max(1,Number(s.bbox?.width_percent)||80)),
        height_percent:Math.min(100,Math.max(1,Number(s.bbox?.height_percent)||15))
      }
    }));
    return json(200,{analysis,creditsConsumed:response?.credits_consumed??response?.usage?.credits_consumed??null});
  } catch(e) {
    console.error(e);
    return json(e.status&&e.status>=400&&e.status<600?e.status:500,{error:e.message||'Segment analysis failed.'});
  }
}
