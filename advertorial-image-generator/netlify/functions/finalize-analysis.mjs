import { json, kieFetch, parseJsonLoose, extractChatContent } from './_shared.mjs';

const schema={
  type:'object',additionalProperties:false,
  properties:{
    page_summary:{type:'string'},detected_language:{type:'string'},
    image_slots:{type:'array',items:{
      type:'object',additionalProperties:false,
      properties:{
        title:{type:'string'},section_title:{type:'string'},section_context:{type:'string'},
        slot_type:{type:'string',enum:['problem_image','lifestyle_image','ingredient_image','mechanism_image','testimonial_support','authority_trust','product_support','before_after_support','section_opener','other']},
        source_type:{type:'string',enum:['existing_image','empty_placeholder','ai_suggested','manual']},
        action:{type:'string',enum:['keep','replace','add','review']},confidence:{type:'number'},priority:{type:'string',enum:['high','medium','low']},
        reason:{type:'string'},current_image_description:{type:'string'},google_search:{type:'string'},image_prompt:{type:'string'},
        recommended_ratio:{type:'string',enum:['4:5','1:1','3:4','4:3','3:2','2:3','16:9','9:16','auto']},y_percent:{type:'number'},
        bbox:{type:'object',additionalProperties:false,properties:{x_percent:{type:'number'},y_percent:{type:'number'},width_percent:{type:'number'},height_percent:{type:'number'}},required:['x_percent','y_percent','width_percent','height_percent']}
      },
      required:['title','section_title','section_context','slot_type','source_type','action','confidence','priority','reason','current_image_description','google_search','image_prompt','recommended_ratio','y_percent','bbox']
    }}
  },required:['page_summary','detected_language','image_slots']
};

function auditRule(mode){
  if(mode==='empty')return 'Output only add slots. Remove existing-image entries.';
  if(mode==='replace')return 'Output only existing_image slots and action must be replace.';
  if(mode==='force')return 'Every existing_image must be replace. Empty/new slots may remain add.';
  return 'Smart audit: existing images may be keep/replace/review; empty/new slots must be add.';
}

function compactSlot(s){return {title:s.title,section_title:s.section_title,section_context:s.section_context,slot_type:s.slot_type,source_type:s.source_type,action:s.action,confidence:s.confidence,priority:s.priority,reason:s.reason,current_image_description:s.current_image_description,google_search:s.google_search,image_prompt:s.image_prompt,recommended_ratio:s.recommended_ratio,y_percent:s.y_percent,bbox:s.bbox};}

async function call(body,withSchema=true){
  const slots=(body.analysis?.image_slots||[]).slice(0,50).map(compactSlot);
  const prompt=`You are finalizing a segmented advertorial image audit. You do NOT have the screenshots now; preserve visual facts from the candidate slots.\n\nRules:\n- Deduplicate overlapping entries caused by screenshot segment overlap.\n- Keep slots ordered top-to-bottom by y_percent.\n- Preserve bbox and y_percent of the best matching candidate; do not invent radically different positions.\n- ${auditRule(body.auditMode)}\n- Keep the plan practical and conversion-relevant, not visually overcrowded.\n- Tighten titles, reasons, Google search phrases and generation prompts where needed.\n- Search phrases must sound like a human Google Images query.\n- Image prompts must be detailed, native/editorial, section-specific and avoid unnecessary text overlays, watermarks, fake UI or fake endorsements.\n- Prefer 4:5 for portrait story/problem visuals, 1:1 for ingredients/mechanisms when appropriate, and wide ratios for wide editorial placements.\n\nPage summary fragments: ${String(body.analysis?.page_summary||'').slice(0,3000)}\nDetected language: ${String(body.analysis?.detected_language||'unknown')}\nPlacement mode: ${body.mode||'balanced'}\n\nCandidate slots JSON:\n${JSON.stringify(slots)}\n\nReturn only valid JSON matching the schema.`;
  const req={messages:[{role:'user',content:[{type:'text',text:prompt}]}],stream:false,include_thoughts:false,reasoning_effort:['low','medium','high'].includes(body.reasoning)?body.reasoning:'medium'};
  if(withSchema)req.response_format={type:'json_schema',json_schema:{name:'final_advertorial_image_audit',strict:true,schema}};
  return kieFetch('/gemini-3-7-flash-openai/v1/chat/completions',{method:'POST',body:JSON.stringify(req)});
}

export async function handler(event){
  if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed'});
  try{
    const body=JSON.parse(event.body||'{}');
    if(!Array.isArray(body.analysis?.image_slots))return json(400,{error:'No candidate slots received.'});
    if(body.analysis.image_slots.length>50)return json(400,{error:'Too many candidate slots.'});
    let response;
    try{response=await call(body,true);}catch(e){if(e.status===400)response=await call(body,false);else throw e;}
    const analysis=parseJsonLoose(extractChatContent(response));
    if(!Array.isArray(analysis?.image_slots))throw new Error('Gemini finalization did not contain image_slots.');
    analysis.image_slots=analysis.image_slots.filter(Boolean).sort((a,b)=>(Number(a.y_percent)||0)-(Number(b.y_percent)||0));
    return json(200,{analysis});
  }catch(e){console.error(e);return json(e.status&&e.status>=400&&e.status<600?e.status:500,{error:e.message||'Finalization failed.'});}
}
