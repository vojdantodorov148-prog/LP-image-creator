import { json, kieFetch, parseJsonLoose, extractChatContent } from './_shared.mjs';

const schema={type:'object',additionalProperties:false,properties:{slots:{type:'array',items:{type:'object',additionalProperties:false,properties:{client_id:{type:'string'},google_search:{type:'string'},image_prompt:{type:'string'},recommended_ratio:{type:'string',enum:['4:5','1:1','3:4','4:3','3:2','2:3','16:9','9:16','auto']}},required:['client_id','google_search','image_prompt','recommended_ratio']}}},required:['slots']};

async function call(body,withSchema=true){
  const slots=(body.slots||[]).slice(0,50);
  const prompt=`Rewrite the Google Images search phrase and AI image-generation prompt for every provided advertorial image slot. Preserve each client_id exactly. Do not change the slot decision itself.\n\nRequirements:\n- Google search: short, concrete, natural human query; no SEO copy.\n- AI prompt: detailed and production-ready, tightly matched to the section, subject/emotion/action/environment/composition/camera/lighting/realism/native advertorial feel. Include useful imperfections when photographic. Avoid glossy ad styling unless the slot requires product presentation. Avoid text overlays, watermarks, fake UI and fabricated endorsements.\n- Keep medical/scientific mechanism visuals explanatory rather than fake clinical proof.\n- Choose practical aspect ratio.\n\nPage summary: ${String(body.page_summary||'').slice(0,2500)}\nDetected language: ${String(body.detected_language||'unknown')}\n\nSlots:\n${JSON.stringify(slots)}\nReturn only valid JSON.`;
  const req={messages:[{role:'user',content:[{type:'text',text:prompt}]}],stream:false,include_thoughts:false,reasoning_effort:['low','medium','high'].includes(body.reasoning)?body.reasoning:'medium'};
  if(withSchema)req.response_format={type:'json_schema',json_schema:{name:'advertorial_prompt_refresh',strict:true,schema}};
  return kieFetch('/gemini-3-7-flash-openai/v1/chat/completions',{method:'POST',body:JSON.stringify(req)});
}

export async function handler(event){
  if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed'});
  try{
    const body=JSON.parse(event.body||'{}');
    if(!Array.isArray(body.slots)||!body.slots.length)return json(400,{error:'No slots received.'});
    if(body.slots.length>50)return json(400,{error:'Too many slots.'});
    let response;
    try{response=await call(body,true);}catch(e){if(e.status===400)response=await call(body,false);else throw e;}
    const out=parseJsonLoose(extractChatContent(response));
    if(!Array.isArray(out?.slots))throw new Error('Gemini response did not contain slots.');
    return json(200,out);
  }catch(e){console.error(e);return json(e.status&&e.status>=400&&e.status<600?e.status:500,{error:e.message||'Prompt regeneration failed.'});}
}
