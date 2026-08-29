const RATIOS = ['4:5', '1:1', '3:4', '4:3', '3:2', '2:3', '16:9', '9:16', 'auto'];
const $app = document.getElementById('app');

const state = {
  file: null,
  imageDataUrl: '',
  analysisSegments: [],
  analysis: null,
  analyzing: false,
  mode: 'balanced',
  reasoning: 'medium',
  activeId: '',
  globalError: ''
};

const uid = () => Math.random().toString(36).slice(2, 9);
const esc = (v='') => String(v).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

async function api(path, options = {}) {
  const res = await fetch(`/api/${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  let data;
  try { data = await res.json(); } catch { data = { error: `HTTP ${res.status}` }; }
  if (!res.ok) throw new Error(data?.error || data?.message || `Request failed (${res.status})`);
  return data;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function prepareAnalysisSegments(file) {
  const bitmap = await createImageBitmap(file);
  const maxWidth = 1600;
  const scale = Math.min(1, maxWidth / bitmap.width);
  const outW = Math.max(1, Math.round(bitmap.width * scale));
  const outH = Math.max(1, Math.round(bitmap.height * scale));
  const segmentH = 1800;
  const total = Math.ceil(outH / segmentH);
  const segments = [];

  for (let i = 0; i < total; i++) {
    const y = i * segmentH;
    const h = Math.min(segmentH, outH - y);
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, outW, h);
    ctx.drawImage(bitmap, 0, y / scale, bitmap.width, h / scale, 0, 0, outW, h);
    segments.push({
      dataUrl: canvas.toDataURL('image/jpeg', 0.82),
      index: i,
      startPercent: (y / outH) * 100,
      endPercent: ((y + h) / outH) * 100
    });
  }
  bitmap.close?.();
  return segments;
}

function cleanAnalysis(data) {
  const slots = Array.isArray(data?.image_slots) ? data.image_slots : [];
  return {
    page_summary: data?.page_summary || '',
    detected_language: data?.detected_language || '',
    image_slots: slots.map((s, i) => ({
      id: uid(),
      title: s.title || `Image ${i + 1}`,
      placement_reason: s.placement_reason || '',
      section_context: s.section_context || '',
      y_percent: Math.min(99, Math.max(1, Number(s.y_percent) || ((i + 1) * 100) / (slots.length + 1))),
      source: s.source === 'existing_placeholder' ? 'existing_placeholder' : 'ai_suggested',
      google_search: s.google_search || '',
      image_prompt: s.image_prompt || '',
      recommended_ratio: RATIOS.includes(s.recommended_ratio) ? s.recommended_ratio : '4:5',
      generatedUrl: '', generating: false, error: '', taskId: ''
    }))
  };
}

function icon(name, size=16) {
  const paths = {
    scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10"/>',
    upload: '<path d="M12 3v12M7 8l5-5 5 5M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/>',
    clipboard: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4.5h6V2H9z"/>',
    spark: '<path d="m12 3-1.5 4.5L6 9l4.5 1.5L12 15l1.5-4.5L18 9l-4.5-1.5z"/><path d="m19 15-.8 2.2L16 18l2.2.8L19 21l.8-2.2L22 18l-2.2-.8z"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/>',
    rotate: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    sliders: '<path d="M4 6h16M4 18h16M8 6v6M16 12v6M4 12h16"/>',
    wand: '<path d="m15 4 5 5L9 20l-5-5zM14 5l5 5M6 4V2M4 6H2M19 18v4M17 20h4"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    refresh: '<path d="M20 7h-5V2M4 17h5v5M19 5a9 9 0 0 0-15 4M5 19a9 9 0 0 0 15-4"/>',
    alert: '<path d="M10.3 3.4 2.5 17a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.4a2 2 0 0 0-3.4 0Z"/><path d="M12 8v4M12 16h.01"/>',
    external: '<path d="M14 3h7v7M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>'
  };
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
}

function render() {
  $app.innerHTML = `
    <div class="app-shell">
      ${headerHtml()}
      ${state.globalError ? `<div class="global-error">${icon('alert',15)}<span>${esc(state.globalError)}</span><button data-action="dismiss-error">×</button></div>` : ''}
      ${!state.imageDataUrl ? uploadHtml() : workspaceHtml()}
    </div>`;
  bindEvents();
}

function headerHtml() {
  return `<header class="topbar">
    <div class="brand"><div class="brandmark">${icon('scan',18)}</div><div><div class="brandname">Advertorial Image Generator</div><div class="brandsub">Screenshot → image plan → generate</div></div></div>
    <div class="top-actions">
      <span class="model-pill">${icon('spark',13)} Gemini 3.7 Flash</span>
      <span class="model-pill">${icon('image',13)} GPT Image 2</span>
      ${state.imageDataUrl ? `<button class="ghost-btn" data-action="reset">${icon('rotate',15)} New scan</button>` : ''}
    </div>
  </header>`;
}

function uploadHtml() {
  return `<main class="upload-page">
    <div class="upload-intro">
      <div class="eyebrow">ONE SCREENSHOT IN. EVERY IMAGE DECIDED.</div>
      <h1>Stop searching for advertorial images manually.</h1>
      <p>Upload a full-page screenshot. AI detects empty image slots, decides where more visuals are needed, then gives you a Google search phrase and a ready-to-generate image prompt for every placement.</p>
    </div>
    <div class="dropzone" id="dropzone">
      <input id="fileInput" type="file" accept="image/*" hidden>
      <div class="drop-icon">${icon('upload',25)}</div>
      <h2>Drop your full-page screenshot</h2>
      <p>or click to upload</p>
      <div class="paste-hint">${icon('clipboard',15)} You can also paste an image with ⌘V / Ctrl+V</div>
    </div>
    <div class="workflow-strip">
      <div><b>01</b><span>Upload advertorial</span></div><div><b>02</b><span>AI maps image slots</span></div><div><b>03</b><span>Search or generate</span></div><div><b>04</b><span>Copy / download</span></div>
    </div>
  </main>`;
}

function workspaceHtml() {
  const slots = state.analysis?.image_slots || [];
  return `
    <div class="scan-settings">
      <div class="setting-group"><label>${icon('sliders',14)} Placement mode</label><div class="segmented">
        ${['balanced','placeholders','visual'].map(m => `<button data-mode="${m}" class="${state.mode===m?'active':''}">${m==='balanced'?'Balanced':m==='placeholders'?'Placeholders only':'More visual'}</button>`).join('')}
      </div></div>
      <div class="setting-group compact"><label>Reasoning</label><select id="reasoningSelect">
        <option value="low" ${state.reasoning==='low'?'selected':''}>Low / cheapest</option><option value="medium" ${state.reasoning==='medium'?'selected':''}>Medium</option><option value="high" ${state.reasoning==='high'?'selected':''}>High</option>
      </select></div>
      <button class="primary-btn analyze-btn" data-action="analyze" ${state.analyzing?'disabled':''}>${state.analyzing?'<span class="spinner"></span> Analyzing…':`${icon('wand',17)} Analyze advertorial`}</button>
    </div>
    <div class="workspace">
      <aside class="screenshot-pane">
        <div class="pane-title"><div><span class="dot green"></span>SOURCE SCREENSHOT</div><span>${slots.length} image slots</span></div>
        <div class="screenshot-scroll"><div class="screenshot-wrap"><img src="${state.imageDataUrl}" alt="Advertorial screenshot">${slots.map((s,i)=>`<button class="pin ${state.activeId===s.id?'active':''}" data-slot-pin="${s.id}" style="top:${Number(s.y_percent)}%">${i+1}</button>`).join('')}</div></div>
      </aside>
      <main class="analysis-pane">${analysisHtml()}</main>
    </div>`;
}

function analysisHtml() {
  const a = state.analysis || {page_summary:'', image_slots:[]};
  const slots = a.image_slots || [];
  if (state.analyzing) return `<div class="analysis-summary"><div><span class="tiny-label">ANALYSIS</span><h2>Reading your advertorial…</h2><p>Gemini is reading layout, copy, placeholders and visual gaps.</p></div></div><div class="analysis-loading"><div class="scan-anim">${icon('scan',32)}</div><h3>Mapping image placements</h3><p>Detecting placeholders, reading surrounding sections and writing search phrases + generation prompts.</p></div>`;

  return `<div class="analysis-summary"><div><span class="tiny-label">ANALYSIS</span><h2>${slots.length ? `${slots.length} image opportunities found` : 'Ready to scan'}</h2><p>${esc(a.page_summary || 'Run the analysis to map every image opportunity in the page.')}</p></div>${slots.length?`<button class="outline-btn" data-action="add-slot">${icon('plus',15)} Add image slot</button>`:''}</div>
  ${slots.length ? `<div class="slots-list">${slots.map((s,i)=>slotHtml(s,i)).join('')}</div>` : `<div class="empty-results">${icon('image',28)}<h3>No image slots yet</h3><p>Run the analysis. You can also add a slot manually after the first scan.</p></div>`}`;
}

function slotHtml(slot, i) {
  const sourceText = slot.source==='existing_placeholder'?'Detected placeholder':slot.source==='manual'?'Manual slot':'AI suggested';
  return `<section class="slot-card ${state.activeId===slot.id?'active-card':''}" id="slot-${slot.id}" data-slot-card="${slot.id}">
    <div class="slot-head"><div class="slot-number">${String(i+1).padStart(2,'0')}</div><div class="slot-heading">
      <input class="title-input" data-field="title" data-id="${slot.id}" value="${esc(slot.title)}">
      <div class="slot-meta"><span class="source-tag ${slot.source}">${sourceText}</span>${slot.section_context?`<span class="context-tag">${esc(slot.section_context)}</span>`:''}<span class="context-tag">Y ${Number(slot.y_percent).toFixed(0)}%</span></div>
    </div><button class="icon-btn danger" data-action="delete-slot" data-id="${slot.id}">${icon('trash',15)}</button></div>
    ${slot.placement_reason?`<p class="placement-reason">${esc(slot.placement_reason)}</p>`:''}
    <div class="slot-block"><div class="block-label">${icon('search',14)} GOOGLE IMAGE SEARCH</div><div class="copy-field">
      <textarea data-field="google_search" data-id="${slot.id}" rows="2">${esc(slot.google_search)}</textarea>
      <div class="field-actions"><button class="small-btn" data-action="copy-search" data-id="${slot.id}">${icon('copy',14)} Copy search</button><button class="small-btn" data-action="google-search" data-id="${slot.id}">${icon('external',14)} Search Google</button></div>
    </div></div>
    <div class="slot-block"><div class="block-label">${icon('spark',14)} AI IMAGE PROMPT</div><div class="prompt-box">
      <textarea data-field="image_prompt" data-id="${slot.id}" rows="8">${esc(slot.image_prompt)}</textarea>
      <div class="prompt-actions"><button class="small-btn" data-action="copy-prompt" data-id="${slot.id}">${icon('copy',14)} Copy prompt</button>
        <div class="position-control"><span>Position</span><input type="number" min="1" max="99" data-field="y_percent" data-id="${slot.id}" value="${Number(slot.y_percent).toFixed(0)}"><span>%</span></div>
        <div class="ratio-select"><span>Ratio</span><select data-field="recommended_ratio" data-id="${slot.id}">${RATIOS.map(r=>`<option ${slot.recommended_ratio===r?'selected':''}>${r}</option>`).join('')}</select></div>
        <button class="generate-btn" data-action="generate" data-id="${slot.id}" ${slot.generating||!slot.image_prompt.trim()?'disabled':''}>${slot.generating?'<span class="spinner dark"></span> Generating…':`${icon('wand',15)} Generate`}</button>
      </div>
    </div></div>
    ${slot.error?`<div class="error-box">${icon('alert',15)} ${esc(slot.error)}</div>`:''}
    ${slot.generatedUrl?`<div class="generated-block"><img src="${esc(slot.generatedUrl)}" alt="${esc(slot.title)}"><div class="generated-actions"><button class="small-btn" data-action="copy-image" data-id="${slot.id}">${icon('copy',14)} Copy image</button><button class="small-btn" data-action="download-image" data-id="${slot.id}">${icon('download',14)} Download</button><button class="small-btn" data-action="generate" data-id="${slot.id}">${icon('refresh',14)} Regenerate</button></div></div>`:''}
  </section>`;
}

function bindEvents() {
  document.querySelectorAll('[data-action]').forEach(el => el.addEventListener('click', handleAction));
  document.querySelectorAll('[data-mode]').forEach(el => el.addEventListener('click', () => { state.mode=el.dataset.mode; render(); }));
  document.querySelectorAll('[data-slot-pin]').forEach(el => el.addEventListener('click', () => focusSlot(el.dataset.slotPin, true)));
  document.querySelectorAll('[data-slot-card]').forEach(el => el.addEventListener('click', e => { if (!e.target.closest('button,input,textarea,select')) focusSlot(el.dataset.slotCard, false); }));
  document.querySelectorAll('[data-field]').forEach(el => {
    const evt = el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(evt, () => updateField(el.dataset.id, el.dataset.field, el.value));
  });
  document.getElementById('reasoningSelect')?.addEventListener('change', e => state.reasoning=e.target.value);

  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  if (dropzone && fileInput) {
    dropzone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', e => e.target.files?.[0] && handleFile(e.target.files[0]));
    ['dragenter','dragover'].forEach(evt => dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.classList.add('dragging'); }));
    ['dragleave','drop'].forEach(evt => dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.classList.remove('dragging'); }));
    dropzone.addEventListener('drop', e => e.dataTransfer.files?.[0] && handleFile(e.dataTransfer.files[0]));
  }
}

async function handleAction(e) {
  e.stopPropagation();
  const { action, id } = e.currentTarget.dataset;
  if (action==='dismiss-error') { state.globalError=''; render(); }
  if (action==='reset') reset();
  if (action==='analyze') analyze();
  if (action==='add-slot') addSlot();
  if (action==='delete-slot') deleteSlot(id);
  if (action==='copy-search') copyText(getSlot(id)?.google_search, e.currentTarget);
  if (action==='copy-prompt') copyText(getSlot(id)?.image_prompt, e.currentTarget);
  if (action==='google-search') window.open(`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(getSlot(id)?.google_search || '')}`, '_blank', 'noopener');
  if (action==='generate') generate(id);
  if (action==='download-image') downloadImage(id);
  if (action==='copy-image') copyImage(id);
}

async function handleFile(file) {
  if (!file.type.startsWith('image/')) { state.globalError='Please upload an image screenshot.'; render(); return; }
  try {
    state.globalError='';
    state.file=file;
    state.imageDataUrl=await fileToDataUrl(file);
    state.analysisSegments=await prepareAnalysisSegments(file);
    state.analysis=null; state.activeId='';
    render();
  } catch (e) { state.globalError=e.message || 'Could not read screenshot.'; render(); }
}

async function analyze() {
  if (!state.imageDataUrl || state.analyzing) return;
  state.analyzing=true; state.globalError=''; render();
  try {
    const segments = state.analysisSegments.length ? state.analysisSegments : [{dataUrl:state.imageDataUrl,index:0,startPercent:0,endPercent:100}];
    const images = [];
    for (let i = 0; i < segments.length; i++) {
      const uploaded = await api('upload-screenshot', {
        method: 'POST',
        body: JSON.stringify({ dataUrl: segments[i].dataUrl, fileName: `advertorial-segment-${i+1}.jpg` })
      });
      images.push({
        url: uploaded.url,
        index: segments[i].index,
        startPercent: segments[i].startPercent,
        endPercent: segments[i].endPercent
      });
    }
    const data = await api('analyze-advertorial', {method:'POST', body:JSON.stringify({images, fileName:state.file?.name || 'advertorial.jpg', mode:state.mode, reasoning:state.reasoning})});
    state.analysis=cleanAnalysis(data.analysis);
    state.activeId=state.analysis.image_slots[0]?.id || '';
  } catch (e) { state.globalError=e.message; }
  finally { state.analyzing=false; render(); }
}

function getSlot(id) { return state.analysis?.image_slots.find(s => s.id===id); }
function updateField(id, field, value) {
  const s=getSlot(id); if (!s) return;
  s[field]=field==='y_percent' ? Math.min(99,Math.max(1,Number(value)||1)) : value;
  if (field==='y_percent') {
    const pin=document.querySelector(`[data-slot-pin="${id}"]`); if (pin) pin.style.top=`${s[field]}%`;
  }
}
function focusSlot(id, scroll) { state.activeId=id; render(); if (scroll) setTimeout(()=>document.getElementById(`slot-${id}`)?.scrollIntoView({behavior:'smooth',block:'center'}),0); }
function addSlot() {
  if (!state.analysis) state.analysis={page_summary:'',detected_language:'',image_slots:[]};
  const s={id:uid(),title:'New image slot',placement_reason:'',section_context:'Manual placement',y_percent:50,source:'manual',google_search:'',image_prompt:'',recommended_ratio:'4:5',generatedUrl:'',generating:false,error:'',taskId:''};
  state.analysis.image_slots.push(s); state.activeId=s.id; render(); setTimeout(()=>document.getElementById(`slot-${s.id}`)?.scrollIntoView({behavior:'smooth',block:'center'}),0);
}
function deleteSlot(id) { if (!state.analysis) return; state.analysis.image_slots=state.analysis.image_slots.filter(s=>s.id!==id); if(state.activeId===id)state.activeId=''; render(); }

async function copyText(text, button) {
  try { await navigator.clipboard.writeText(text || ''); const old=button.innerHTML; button.textContent='Copied'; setTimeout(()=>button.innerHTML=old,1000); }
  catch { state.globalError='Clipboard access was blocked by the browser.'; render(); }
}

async function generate(id) {
  const slot=getSlot(id); if(!slot || slot.generating || !slot.image_prompt.trim()) return;
  slot.generating=true; slot.error=''; slot.generatedUrl=''; render();
  try {
    const created=await api('generate-image',{method:'POST',body:JSON.stringify({prompt:slot.image_prompt,aspectRatio:slot.recommended_ratio})});
    slot.taskId=created.taskId;
    let url='';
    for(let i=0;i<80;i++){
      await new Promise(r=>setTimeout(r,i<5?1500:2500));
      const st=await api(`task-status?taskId=${encodeURIComponent(slot.taskId)}`);
      if(st.state==='success' && st.resultUrls?.[0]){url=st.resultUrls[0];break;}
      if(['fail','failed'].includes(st.state))throw new Error(st.failMsg||'Image generation failed');
    }
    if(!url)throw new Error('Generation is taking too long. Try regenerate.');
    slot.generatedUrl=url;
  } catch(e){slot.error=e.message;}
  finally{slot.generating=false;render();setTimeout(()=>document.getElementById(`slot-${id}`)?.scrollIntoView({behavior:'smooth',block:'center'}),0);}
}

function proxyUrl(url,name='image.png'){return `/api/proxy-image?url=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}`;}
function downloadImage(id){const s=getSlot(id);if(!s?.generatedUrl)return;const name=`advertorial-${String((state.analysis?.image_slots.indexOf(s)||0)+1).padStart(2,'0')}-${s.title.replace(/[^a-z0-9]+/gi,'-').toLowerCase()}.png`;const a=document.createElement('a');a.href=proxyUrl(s.generatedUrl,name);a.download='';document.body.appendChild(a);a.click();a.remove();}
async function copyImage(id){const s=getSlot(id);if(!s?.generatedUrl)return;try{const res=await fetch(proxyUrl(s.generatedUrl));if(!res.ok)throw new Error();const blob=await res.blob();const png=blob.type==='image/png'?blob:await toPngBlob(blob);await navigator.clipboard.write([new ClipboardItem({'image/png':png})]);}catch{state.globalError='Copy image is not supported here. Use Download instead.';render();}}
async function toPngBlob(blob){const bmp=await createImageBitmap(blob);const c=document.createElement('canvas');c.width=bmp.width;c.height=bmp.height;c.getContext('2d').drawImage(bmp,0,0);return await new Promise(r=>c.toBlob(r,'image/png'));}
function reset(){state.file=null;state.imageDataUrl='';state.analysisSegments=[];state.analysis=null;state.analyzing=false;state.activeId='';state.globalError='';render();}

window.addEventListener('paste', e => {
  if (state.imageDataUrl) return;
  const item=Array.from(e.clipboardData?.items||[]).find(i=>i.type.startsWith('image/'));
  const file=item?.getAsFile(); if(file) handleFile(file);
});

render();
