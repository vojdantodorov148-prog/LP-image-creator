const RATIOS = ['4:5', '1:1', '3:4', '4:3', '3:2', '2:3', '16:9', '9:16', 'auto'];
const SLOT_TYPES = [
  ['problem_image', 'Problem image'],
  ['lifestyle_image', 'Lifestyle image'],
  ['ingredient_image', 'Ingredient image'],
  ['mechanism_image', 'Mechanism image'],
  ['testimonial_support', 'Testimonial support'],
  ['authority_trust', 'Authority / trust'],
  ['product_support', 'Product support'],
  ['before_after_support', 'Before / after support'],
  ['section_opener', 'Section opener'],
  ['other', 'Other']
];
const IMAGE_COST_USD = 0.03;
const $app = document.getElementById('app');

const state = {
  view: 'workspace',
  file: null,
  imageDataUrl: '',
  imageWidth: 0,
  imageHeight: 0,
  analysisSegments: [],
  analysis: null,
  analyzing: false,
  regeneratingPrompts: false,
  auditMode: 'smart',
  mode: 'balanced',
  reasoning: 'medium',
  activeId: '',
  selectedIds: new Set(),
  globalError: '',
  progress: { pct: 0, message: '' },
  zoom: 100,
  projectId: '',
  projectName: '',
  projects: [],
  saving: false
};

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const esc = (v='') => String(v).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const clamp = (n, min, max) => Math.min(max, Math.max(min, Number(n) || 0));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(path, options = {}) {
  const res = await fetch(`/api/${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  let data;
  try { data = await res.json(); } catch { data = { error: `HTTP ${res.status}` }; }
  if (!res.ok) {
    const err = new Error(data?.error || data?.message || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function apiRetry(path, options = {}, retries = 1) {
  let last;
  for (let i = 0; i <= retries; i++) {
    try { return await api(path, options); }
    catch (e) {
      last = e;
      if (![429, 500, 502, 503, 504].includes(Number(e.status)) || i === retries) throw e;
      await sleep(1200 * (i + 1));
    }
  }
  throw last;
}

async function backgroundAnalysis(kind, payload, onWait) {
  const { jobId } = await apiRetry('create-analysis-job', {
    method: 'POST', body: JSON.stringify({ kind, payload })
  }, 1);
  if (!jobId) throw new Error('Analysis did not return a job ID.');
  for (;;) {
    await sleep(2500);
    const job = await apiRetry(`analysis-job-status?id=${encodeURIComponent(jobId)}`, {}, 2);
    if (job.status === 'done') return job.result;
    if (job.status === 'failed') throw new Error(job.error || 'Background analysis failed.');
    onWait?.();
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function prepareScreenshot(fileOrBlob) {
  const bitmap = await createImageBitmap(fileOrBlob);
  const previewMaxWidth = 1800;
  const previewScale = Math.min(1, previewMaxWidth / bitmap.width);
  const previewW = Math.max(1, Math.round(bitmap.width * previewScale));
  const previewH = Math.max(1, Math.round(bitmap.height * previewScale));
  const previewCanvas = document.createElement('canvas');
  previewCanvas.width = previewW;
  previewCanvas.height = previewH;
  const pctx = previewCanvas.getContext('2d', { alpha: false });
  pctx.fillStyle = '#fff'; pctx.fillRect(0, 0, previewW, previewH);
  pctx.drawImage(bitmap, 0, 0, previewW, previewH);
  const previewDataUrl = previewCanvas.toDataURL('image/jpeg', 0.86);

  const maxWidth = 1600;
  const scale = Math.min(1, maxWidth / bitmap.width);
  const outW = Math.max(1, Math.round(bitmap.width * scale));
  const outH = Math.max(1, Math.round(bitmap.height * scale));
  const segmentH = 1750;
  const overlap = 180;
  const step = segmentH - overlap;
  const segments = [];
  let i = 0;
  for (let y = 0; y < outH; y += step) {
    const h = Math.min(segmentH, outH - y);
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, outW, h);
    ctx.drawImage(bitmap, 0, y / scale, bitmap.width, h / scale, 0, 0, outW, h);
    segments.push({
      dataUrl: canvas.toDataURL('image/jpeg', 0.80),
      index: i++,
      startPercent: (y / outH) * 100,
      endPercent: ((y + h) / outH) * 100
    });
    if (y + h >= outH) break;
  }
  bitmap.close?.();
  return { previewDataUrl, width: previewW, height: previewH, segments };
}

function cleanSlot(s, i = 0) {
  const action = ['keep','replace','add','review'].includes(s?.action) ? s.action : (s?.source_type === 'existing_image' ? 'replace' : 'add');
  const source = ['existing_image','empty_placeholder','ai_suggested','manual'].includes(s?.source_type) ? s.source_type : 'ai_suggested';
  const box = s?.bbox || s?.global_bbox || {};
  const cleanBox = {
    x_percent: clamp(box.x_percent ?? 8, 0, 99),
    y_percent: clamp(box.y_percent ?? ((Number(s?.y_percent) || 50) - 6), 0, 99),
    width_percent: clamp(box.width_percent ?? 84, 1, 100),
    height_percent: clamp(box.height_percent ?? 12, 1, 100)
  };
  if (cleanBox.x_percent + cleanBox.width_percent > 100) cleanBox.width_percent = 100 - cleanBox.x_percent;
  if (cleanBox.y_percent + cleanBox.height_percent > 100) cleanBox.height_percent = 100 - cleanBox.y_percent;
  return {
    id: s?.id || uid(),
    title: s?.title || s?.prompt_title || `Image ${i + 1}`,
    section_title: s?.section_title || s?.section_context || 'Advertorial section',
    section_context: s?.section_context || '',
    placement_reason: s?.placement_reason || s?.reason || '',
    reason: s?.reason || s?.placement_reason || '',
    y_percent: clamp(s?.y_percent ?? (cleanBox.y_percent + cleanBox.height_percent / 2), 1, 99),
    bbox: cleanBox,
    source_type: source,
    action,
    confidence: clamp(s?.confidence ?? 0.75, 0, 1),
    priority: ['high','medium','low'].includes(s?.priority) ? s.priority : 'medium',
    slot_type: SLOT_TYPES.some(([v]) => v === s?.slot_type) ? s.slot_type : 'lifestyle_image',
    current_image_description: s?.current_image_description || '',
    google_search: s?.google_search || '',
    image_prompt: s?.image_prompt || '',
    recommended_ratio: RATIOS.includes(s?.recommended_ratio) ? s.recommended_ratio : '4:5',
    generatedUrl: s?.generatedUrl || '',
    generatedDataUrl: s?.generatedDataUrl || '',
    generating: false,
    error: '',
    taskId: s?.taskId || '',
    creditsConsumed: s?.creditsConsumed ?? null
  };
}

function cleanAnalysis(data) {
  const slots = Array.isArray(data?.image_slots) ? data.image_slots.map(cleanSlot) : [];
  slots.sort((a,b) => a.y_percent - b.y_percent);
  return {
    page_summary: data?.page_summary || '',
    detected_language: data?.detected_language || '',
    image_slots: slots
  };
}

function slotTypeLabel(type) { return SLOT_TYPES.find(([v]) => v === type)?.[1] || 'Other'; }
function actionLabel(a) { return ({keep:'Keep',replace:'Replace',add:'Add',review:'Needs review'})[a] || 'Review'; }
function sourceLabel(s) { return ({existing_image:'Existing image',empty_placeholder:'Empty placeholder',ai_suggested:'New opportunity',manual:'Manual'})[s] || 'Image slot'; }
function priorityLabel(p) { return p ? p[0].toUpperCase()+p.slice(1) : 'Medium'; }

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
    minus: '<path d="M5 12h14"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    refresh: '<path d="M20 7h-5V2M4 17h5v5M19 5a9 9 0 0 0-15 4M5 19a9 9 0 0 0 15-4"/>',
    alert: '<path d="M10.3 3.4 2.5 17a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.4a2 2 0 0 0-3.4 0Z"/><path d="M12 8v4M12 16h.01"/>',
    external: '<path d="M14 3h7v7M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
    folder: '<path d="M3 6h6l2 2h10v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    save: '<path d="M5 4h12l2 2v14H5z"/><path d="M8 4v6h8V4M8 20v-6h8v6"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    duplicate: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    file: '<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/>'
  };
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
}

function render() {
  $app.innerHTML = `
    <div class="app-shell">
      ${headerHtml()}
      ${state.globalError ? `<div class="global-error">${icon('alert',15)}<span>${esc(state.globalError)}</span><button data-action="dismiss-error">×</button></div>` : ''}
      ${state.view === 'projects' ? projectsHtml() : (!state.imageDataUrl ? uploadHtml() : workspaceHtml())}
    </div>`;
  bindEvents();
}

function headerHtml() {
  return `<header class="topbar">
    <div class="brand" data-action="home"><div class="brandmark">${icon('scan',18)}</div><div><div class="brandname">Advertorial Image Generator</div><div class="brandsub">Screenshot → audit → replace / add → generate</div></div></div>
    <div class="top-actions">
      <span class="model-pill">${icon('spark',13)} Gemini 3.7 Flash</span>
      <span class="model-pill">${icon('image',13)} GPT Image 2</span>
      <button class="ghost-btn" data-action="show-projects">${icon('folder',15)} Saved Projects</button>
      ${state.imageDataUrl && state.view === 'workspace' ? `<button class="ghost-btn" data-action="save-project">${icon('save',15)} ${state.saving?'Saving…':'Save'}</button><button class="ghost-btn" data-action="reset">${icon('rotate',15)} New scan</button>` : ''}
    </div>
  </header>`;
}

function uploadHtml() {
  return `<main class="upload-page">
    <div class="upload-intro">
      <div class="eyebrow">AUDIT EXISTING IMAGES OR BUILD A NEW IMAGE PLAN</div>
      <h1>Turn any advertorial screenshot into an image production plan.</h1>
      <p>Upload a full-page screenshot with images, without images, or mixed. AI decides what to keep, what to replace, and where a new visual should be added. Every replace/add slot gets a Google search phrase and a ready-to-generate image prompt.</p>
    </div>
    <div class="dropzone" id="dropzone">
      <input id="fileInput" type="file" accept="image/*" hidden>
      <div class="drop-icon">${icon('upload',25)}</div>
      <h2>Drop your full-page screenshot</h2>
      <p>PNG, JPG or WEBP — with or without existing images</p>
      <div class="paste-hint">${icon('clipboard',15)} You can also paste an image with ⌘V / Ctrl+V</div>
    </div>
    <div class="workflow-strip">
      <div><b>01</b><span>Upload advertorial</span></div><div><b>02</b><span>AI audits every image slot</span></div><div><b>03</b><span>Search or generate</span></div><div><b>04</b><span>Copy / download</span></div>
    </div>
  </main>`;
}

function workspaceHtml() {
  const slots = state.analysis?.image_slots || [];
  return `
    <div class="scan-settings">
      <div class="setting-group"><label>${icon('eye',14)} Image audit</label><div class="segmented audit-segmented">
        ${[['smart','Smart audit'],['empty','Empty only'],['replace','Replace existing'],['force','Force replace all']].map(([v,l]) => `<button data-audit="${v}" class="${state.auditMode===v?'active':''}">${l}</button>`).join('')}
      </div></div>
      <div class="setting-group"><label>${icon('sliders',14)} Placement</label><div class="segmented">
        ${[['balanced','Balanced'],['placeholders','Placeholders only'],['visual','More visual']].map(([v,l]) => `<button data-mode="${v}" class="${state.mode===v?'active':''}">${l}</button>`).join('')}
      </div></div>
      <div class="setting-group compact"><label>Reasoning</label><select id="reasoningSelect">
        <option value="low" ${state.reasoning==='low'?'selected':''}>Low / cheapest</option><option value="medium" ${state.reasoning==='medium'?'selected':''}>Medium</option><option value="high" ${state.reasoning==='high'?'selected':''}>High</option>
      </select></div>
      <button class="primary-btn analyze-btn" data-action="analyze" ${state.analyzing?'disabled':''}>${state.analyzing?'<span class="spinner"></span> Analyzing…':`${icon('wand',17)} ${slots.length?'Re-analyze':'Analyze advertorial'}`}</button>
    </div>
    ${state.analyzing ? progressHtml() : ''}
    <div class="workspace">
      <aside class="screenshot-pane">
        <div class="pane-title"><div><span class="dot green"></span>SOURCE SCREENSHOT</div><div class="pane-tools"><span>${slots.length} slots</span><button data-action="zoom-out" title="Zoom out">${icon('minus',13)}</button><span>${state.zoom}%</span><button data-action="zoom-in" title="Zoom in">${icon('plus',13)}</button></div></div>
        <div class="screenshot-scroll"><div class="screenshot-wrap" style="width:${state.zoom}%"><img src="${state.imageDataUrl}" alt="Advertorial screenshot">${slots.map((s,i)=>`<button class="pin action-${s.action} ${state.activeId===s.id?'active':''}" data-slot-pin="${s.id}" style="top:${Number(s.y_percent)}%">${i+1}</button>`).join('')}</div></div>
      </aside>
      <main class="analysis-pane">${analysisHtml()}</main>
    </div>`;
}

function progressHtml() {
  return `<div class="analysis-progress"><div class="progress-meta"><span>${esc(state.progress.message || 'Analyzing…')}</span><b>${Math.round(state.progress.pct || 0)}%</b></div><div class="progress-track"><span style="width:${clamp(state.progress.pct,0,100)}%"></span></div></div>`;
}

function analysisHtml() {
  const a = state.analysis || {page_summary:'', image_slots:[]};
  const slots = a.image_slots || [];
  if (state.analyzing && !slots.length) return `<div class="analysis-summary"><div><span class="tiny-label">BACKGROUND AI AUDIT</span><h2>Reading the advertorial in smaller batches…</h2><p>Analysis runs in the background. Keep this tab open to receive its result.</p></div></div><div class="analysis-loading"><div class="scan-anim">${icon('scan',32)}</div><h3>${esc(state.progress.message || 'Mapping image placements')}</h3><p>Existing images, empty placeholders and new visual opportunities are being audited.</p></div>`;

  if (!slots.length) return `<div class="analysis-summary"><div><span class="tiny-label">ANALYSIS</span><h2>Ready to scan</h2><p>Use Smart Audit to evaluate existing images, replace weak ones, detect empty placeholders and add missing image opportunities.</p></div></div><div class="empty-results">${icon('image',32)}<h3>No image plan yet</h3><p>Choose the audit mode above and run the analysis.</p></div>`;

  const counts = countActions(slots);
  const candidates = slots.filter(s => s.action !== 'keep').length;
  const selected = slots.filter(s => state.selectedIds.has(s.id) && s.action !== 'keep').length;
  const estimated = (selected * IMAGE_COST_USD).toFixed(2);
  return `
    <div class="analysis-summary">
      <div class="summary-copy"><span class="tiny-label">IMAGE AUDIT</span><input class="project-name-input" data-project-name value="${esc(state.projectName || 'Untitled advertorial')}" aria-label="Project name"><p>${esc(a.page_summary || 'Image audit complete.')}</p></div>
      <button class="outline-btn" data-action="add-slot">${icon('plus',15)} Add manual slot</button>
    </div>
    <div class="summary-strip">
      <div><b>${slots.length}</b><span>Total slots</span></div>
      <div class="sum-keep"><b>${counts.keep}</b><span>Keep</span></div>
      <div class="sum-replace"><b>${counts.replace}</b><span>Replace</span></div>
      <div class="sum-add"><b>${counts.add}</b><span>Add</span></div>
      <div><b>${slots.filter(s=>s.priority==='high').length}</b><span>High priority</span></div>
      <div><b>$${(candidates * IMAGE_COST_USD).toFixed(2)}</b><span>All candidate cost</span></div>
    </div>
    <div class="quick-actions">
      <button class="small-btn" data-action="replace-all">${icon('refresh',14)} Replace all existing</button>
      <button class="small-btn" data-action="regenerate-prompts" ${state.regeneratingPrompts?'disabled':''}>${state.regeneratingPrompts?'<span class="spinner"></span> Refreshing…':`${icon('spark',14)} Regenerate prompts`}</button>
      <button class="small-btn" data-action="select-candidates">${icon('check',14)} Select replace + add</button>
      <button class="small-btn" data-action="export-txt">${icon('file',14)} Export prompts</button>
      <button class="small-btn" data-action="export-csv">${icon('download',14)} Export CSV</button>
      <button class="small-btn" data-action="export-search">${icon('search',14)} Export searches</button>
      <button class="generate-selected" data-action="generate-selected" ${!selected?'disabled':''}>${icon('wand',15)} Generate selected (${selected}) · $${estimated}</button>
    </div>
    <div class="slot-list">${slots.map((s,i)=>slotHtml(s,i)).join('')}</div>`;
}

function countActions(slots) {
  return slots.reduce((a,s)=>{a[s.action]=(a[s.action]||0)+1; return a;},{keep:0,replace:0,add:0,review:0});
}

function slotHtml(slot, index) {
  const active = state.activeId === slot.id;
  const canGenerate = slot.action !== 'keep';
  const checked = state.selectedIds.has(slot.id) && canGenerate;
  const thumb = slot.source_type === 'existing_image' ? currentImageThumb(slot) : '';
  const generatedSrc = slot.generatedDataUrl || slot.generatedUrl;
  return `<section class="slot-card action-${slot.action} ${active?'active':''}" id="slot-${slot.id}" data-slot-card="${slot.id}">
    <div class="slot-head">
      <label class="slot-check ${!canGenerate?'disabled':''}"><input type="checkbox" data-select-slot="${slot.id}" ${checked?'checked':''} ${!canGenerate?'disabled':''}><span></span></label>
      <div class="slot-number">${String(index+1).padStart(2,'0')}</div>
      <div class="slot-heading"><input class="slot-title-input" data-field="title" data-id="${slot.id}" value="${esc(slot.title)}"><div class="slot-meta"><span class="source-pill">${sourceLabel(slot.source_type)}</span><span>·</span><span>${Math.round(slot.confidence*100)}% confidence</span></div></div>
      <div class="slot-head-controls">
        <select class="action-select action-${slot.action}" data-field="action" data-id="${slot.id}"><option value="keep" ${slot.action==='keep'?'selected':''}>Keep</option><option value="replace" ${slot.action==='replace'?'selected':''}>Replace</option><option value="add" ${slot.action==='add'?'selected':''}>Add</option><option value="review" ${slot.action==='review'?'selected':''}>Needs review</option></select>
        <select data-field="priority" data-id="${slot.id}"><option value="high" ${slot.priority==='high'?'selected':''}>High</option><option value="medium" ${slot.priority==='medium'?'selected':''}>Medium</option><option value="low" ${slot.priority==='low'?'selected':''}>Low</option></select>
        <button class="icon-btn" data-action="duplicate-slot" data-id="${slot.id}" title="Duplicate">${icon('duplicate',14)}</button>
        <button class="icon-btn danger" data-action="delete-slot" data-id="${slot.id}" title="Delete">${icon('trash',14)}</button>
      </div>
    </div>
    <div class="slot-body">
      <div class="slot-info-grid">
        ${thumb}
        <div class="slot-info ${thumb?'with-thumb':''}">
          <div><span>SECTION</span><input data-field="section_title" data-id="${slot.id}" value="${esc(slot.section_title)}"></div>
          <div><span>TYPE</span><select data-field="slot_type" data-id="${slot.id}">${SLOT_TYPES.map(([v,l])=>`<option value="${v}" ${slot.slot_type===v?'selected':''}>${l}</option>`).join('')}</select></div>
          <div><span>ACTION</span><strong class="status-text action-${slot.action}">${actionLabel(slot.action)}</strong></div>
          <div><span>POSITION</span><div class="position-control"><input type="number" min="1" max="99" step="0.5" data-field="y_percent" data-id="${slot.id}" value="${Number(slot.y_percent).toFixed(1)}"><em>%</em></div></div>
        </div>
      </div>
      <div class="reason-box"><span>WHY</span><textarea rows="2" data-field="reason" data-id="${slot.id}">${esc(slot.reason)}</textarea></div>
      ${slot.source_type === 'existing_image' && slot.current_image_description ? `<div class="current-desc"><span>CURRENT IMAGE</span><p>${esc(slot.current_image_description)}</p></div>` : ''}
      <div class="prompt-box">
        <div class="prompt-label"><span>${icon('search',14)} GOOGLE IMAGE SEARCH</span></div>
        <input data-field="google_search" data-id="${slot.id}" value="${esc(slot.google_search)}" placeholder="e.g. tired middle aged woman awake in bed at 3am">
        <div class="field-actions"><button class="small-btn" data-action="copy-search" data-id="${slot.id}">${icon('copy',13)} Copy Search</button><button class="small-btn" data-action="google-search" data-id="${slot.id}">${icon('external',13)} Search Google</button></div>
      </div>
      <div class="prompt-box ai-prompt">
        <div class="prompt-label"><span>${icon('spark',14)} AI IMAGE PROMPT</span></div>
        <textarea rows="7" data-field="image_prompt" data-id="${slot.id}" placeholder="Detailed generation prompt…">${esc(slot.image_prompt)}</textarea>
        <div class="prompt-actions">
          <button class="small-btn" data-action="copy-prompt" data-id="${slot.id}">${icon('copy',13)} Copy Prompt</button>
          <select class="ratio-select" data-field="recommended_ratio" data-id="${slot.id}">${RATIOS.map(r=>`<option value="${r}" ${slot.recommended_ratio===r?'selected':''}>${r}</option>`).join('')}</select>
          <button class="generate-btn" data-action="generate" data-id="${slot.id}" ${slot.generating || !canGenerate?'disabled':''}>${slot.generating?'<span class="spinner dark"></span> Generating…':`${icon('wand',15)} Generate · $${IMAGE_COST_USD.toFixed(2)}`}</button>
        </div>
      </div>
      ${slot.error?`<div class="error-box">${icon('alert',15)} ${esc(slot.error)}</div>`:''}
      ${generatedSrc?`<div class="generated-block"><img src="${generatedSrc}" alt="${esc(slot.title)}"><div class="generated-actions"><button class="small-btn" data-action="copy-image" data-id="${slot.id}">${icon('copy',14)} Copy image</button><button class="small-btn" data-action="download-image" data-id="${slot.id}">${icon('download',14)} Download</button><button class="small-btn" data-action="generate" data-id="${slot.id}">${icon('refresh',14)} Regenerate</button></div></div>`:''}
    </div>
  </section>`;
}

function currentImageThumb(slot) {
  const b = slot.bbox || {};
  const x = clamp(b.x_percent,0,99), y = clamp(b.y_percent,0,99), w = clamp(b.width_percent,1,100), h = clamp(b.height_percent,1,100);
  const posX = 100 - w > 0 ? (x / (100 - w)) * 100 : 50;
  const posY = 100 - h > 0 ? (y / (100 - h)) * 100 : 50;
  const bgSize = `${Math.max(100, 10000 / w)}% auto`;
  const aspect = Math.max(.6, Math.min(2.2, w / h));
  return `<div class="existing-thumb-wrap"><span>CURRENT IMAGE</span><div class="existing-thumb" style="aspect-ratio:${aspect};background-image:url('${state.imageDataUrl}');background-size:${bgSize};background-position:${posX}% ${posY}%"></div></div>`;
}

function projectsHtml() {
  const cards = state.projects.length ? state.projects.map(p => `<article class="project-card">
    <div class="project-thumb" style="background-image:url('${p.imageDataUrl || ''}')"></div>
    <div class="project-card-body"><h3>${esc(p.projectName || 'Untitled advertorial')}</h3><p>${new Date(p.updatedAt || p.createdAt || Date.now()).toLocaleString()}</p><div class="project-stats"><span>${p.analysis?.image_slots?.length || 0} slots</span><span>${p.analysis?.image_slots?.filter(s=>s.generatedDataUrl||s.generatedUrl).length || 0} generated</span></div></div>
    <div class="project-actions"><button class="small-btn" data-action="open-project" data-id="${p.id}">Open</button><button class="icon-btn" data-action="duplicate-project" data-id="${p.id}" title="Duplicate">${icon('duplicate',14)}</button><button class="icon-btn danger" data-action="delete-project" data-id="${p.id}" title="Delete">${icon('trash',14)}</button></div>
  </article>`).join('') : `<div class="projects-empty">${icon('folder',34)}<h2>No saved projects yet</h2><p>Analyze an advertorial and press Save. Projects are stored in this browser so you can reopen them later.</p><button class="primary-btn" data-action="home">Start a scan</button></div>`;
  return `<main class="projects-page"><div class="projects-header"><div><span class="tiny-label">HISTORY</span><h1>Saved Projects</h1><p>Reopen past advertorial audits, prompts and generated images.</p></div><button class="primary-btn" data-action="home">${icon('plus',15)} New / current scan</button></div><div class="projects-grid">${cards}</div></main>`;
}

function bindEvents() {
  document.querySelectorAll('[data-action]').forEach(el => el.addEventListener('click', handleAction));
  document.querySelectorAll('[data-mode]').forEach(el => el.addEventListener('click', () => { state.mode=el.dataset.mode; render(); }));
  document.querySelectorAll('[data-audit]').forEach(el => el.addEventListener('click', () => { state.auditMode=el.dataset.audit; render(); }));
  document.querySelectorAll('[data-slot-pin]').forEach(el => el.addEventListener('click', () => focusSlot(el.dataset.slotPin, true)));
  document.querySelectorAll('[data-slot-card]').forEach(el => el.addEventListener('click', e => { if (!e.target.closest('button,input,textarea,select,label')) focusSlot(el.dataset.slotCard, false); }));
  document.querySelectorAll('[data-field]').forEach(el => {
    const evt = el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(evt, () => updateField(el.dataset.id, el.dataset.field, el.value));
    if (el.dataset.field === 'y_percent') el.addEventListener('change', normalizeSlotOrder);
  });
  document.querySelectorAll('[data-select-slot]').forEach(el => el.addEventListener('change', () => {
    if (el.checked) state.selectedIds.add(el.dataset.selectSlot); else state.selectedIds.delete(el.dataset.selectSlot);
    render();
  }));
  document.getElementById('reasoningSelect')?.addEventListener('change', e => state.reasoning=e.target.value);
  document.querySelector('[data-project-name]')?.addEventListener('input', e => { state.projectName=e.target.value; scheduleSave(); });

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
  if (action==='dismiss-error') { state.globalError=''; render(); return; }
  if (action==='home') { state.view='workspace'; render(); return; }
  if (action==='show-projects') { await loadProjectList(); state.view='projects'; render(); return; }
  if (action==='reset') { reset(); return; }
  if (action==='analyze') { analyze(); return; }
  if (action==='add-slot') { addSlot(); return; }
  if (action==='delete-slot') { deleteSlot(id); return; }
  if (action==='duplicate-slot') { duplicateSlot(id); return; }
  if (action==='copy-search') { copyText(getSlot(id)?.google_search, e.currentTarget); return; }
  if (action==='copy-prompt') { copyText(getSlot(id)?.image_prompt, e.currentTarget); return; }
  if (action==='google-search') { window.open(`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(getSlot(id)?.google_search || '')}`, '_blank', 'noopener'); return; }
  if (action==='generate') { generate(id); return; }
  if (action==='download-image') { downloadImage(id); return; }
  if (action==='copy-image') { copyImage(id); return; }
  if (action==='replace-all') { replaceAllExisting(); return; }
  if (action==='select-candidates') { selectCandidates(); return; }
  if (action==='generate-selected') { generateSelected(); return; }
  if (action==='regenerate-prompts') { regeneratePrompts(); return; }
  if (action==='export-txt') { exportPromptsTxt(); return; }
  if (action==='export-csv') { exportCsv(); return; }
  if (action==='export-search') { exportSearches(); return; }
  if (action==='zoom-in') { state.zoom=Math.min(180,state.zoom+20); render(); return; }
  if (action==='zoom-out') { state.zoom=Math.max(60,state.zoom-20); render(); return; }
  if (action==='save-project') { await saveCurrentProject(true); return; }
  if (action==='open-project') { await openProject(id); return; }
  if (action==='delete-project') { await deleteProjectRecord(id); return; }
  if (action==='duplicate-project') { await duplicateProjectRecord(id); return; }
}

async function handleFile(file) {
  if (!file.type.startsWith('image/')) { state.globalError='Please upload an image screenshot.'; render(); return; }
  try {
    state.globalError='';
    state.file=file;
    const prep = await prepareScreenshot(file);
    state.imageDataUrl=prep.previewDataUrl;
    state.imageWidth=prep.width; state.imageHeight=prep.height;
    state.analysisSegments=prep.segments;
    state.analysis=null; state.activeId=''; state.selectedIds.clear();
    state.projectId=uid();
    state.projectName=(file.name || 'Advertorial').replace(/\.[^.]+$/, '');
    state.view='workspace';
    render();
  } catch (e) { state.globalError=e.message || 'Could not read screenshot.'; render(); }
}

async function ensureSegments() {
  if (state.analysisSegments.length) return state.analysisSegments;
  if (!state.imageDataUrl) return [];
  const blob = await (await fetch(state.imageDataUrl)).blob();
  const prep = await prepareScreenshot(blob);
  state.analysisSegments = prep.segments;
  return state.analysisSegments;
}

async function analyze() {
  if (!state.imageDataUrl || state.analyzing) return;
  state.analyzing=true; state.globalError=''; state.progress={pct:2,message:'Preparing screenshot segments…'}; render();
  try {
    const segments = await ensureSegments();
    if (!segments.length) throw new Error('No screenshot segments available.');
    const uploaded = [];
    for (let i = 0; i < segments.length; i++) {
      state.progress={pct:5 + ((i+1)/segments.length)*20,message:`Uploading segment ${i+1} of ${segments.length}…`}; render();
      const up = await apiRetry('upload-screenshot', { method:'POST', body:JSON.stringify({dataUrl:segments[i].dataUrl,fileName:`advertorial-segment-${i+1}.jpg`}) }, 1);
      uploaded.push({...segments[i], url:up.url});
    }

    const partials = [];
    const failures = [];
    for (let i = 0; i < uploaded.length; i++) {
      const pct = 27 + ((i)/uploaded.length)*55;
      state.progress={pct,message:`Auditing segment ${i+1} of ${uploaded.length}…`}; render();
      try {
        const part = await backgroundAnalysis('segment', {
          image:uploaded[i], segmentNumber:i+1, totalSegments:uploaded.length,
          auditMode:state.auditMode, mode:state.mode, reasoning:state.reasoning
        });
        partials.push({segment:uploaded[i], analysis:part.analysis});
      } catch (e) {
        failures.push(`Segment ${i+1}: ${e.message}`);
      }
    }
    if (!partials.length) throw new Error(failures[0] || 'All analysis segments failed.');

    state.progress={pct:84,message:'Merging image opportunities…'}; render();
    const merged = mergePartialAnalyses(partials);
    let finalAnalysis = merged;
    try {
      state.progress={pct:90,message:'Finalizing keep / replace / add decisions…'}; render();
      const fin = await backgroundAnalysis('finalize', {
        analysis:merged, auditMode:state.auditMode, mode:state.mode, reasoning:state.reasoning
      });
      if (Array.isArray(fin?.analysis?.image_slots)) finalAnalysis = fin.analysis;
    } catch (e) {
      // Text-only finalization is optional. The segmented audit remains usable if it times out.
      console.warn('Finalization fallback:', e);
    }
    state.analysis=cleanAnalysis(finalAnalysis);
    state.activeId=state.analysis.image_slots[0]?.id || '';
    state.selectedIds.clear();
    state.progress={pct:100,message:'Image audit complete'};
    if (failures.length) state.globalError=`Audit completed, but ${failures.length} segment${failures.length>1?'s':''} had to be skipped. You can re-analyze if anything is missing.`;
    await saveCurrentProject(false);
  } catch (e) {
    state.globalError = e.message || 'Analysis failed.';
  } finally {
    state.analyzing=false; render();
  }
}

function mergePartialAnalyses(partials) {
  const all = [];
  const summaries = [];
  let language = '';
  for (const p of partials) {
    const range = p.segment.endPercent - p.segment.startPercent;
    if (p.analysis?.page_summary) summaries.push(p.analysis.page_summary);
    if (!language && p.analysis?.detected_language) language = p.analysis.detected_language;
    for (const raw of (p.analysis?.image_slots || [])) {
      const b = raw.bbox || {x_percent:8,y_percent:Math.max(0,(raw.local_y_percent||50)-6),width_percent:84,height_percent:12};
      const globalTop = p.segment.startPercent + (clamp(b.y_percent,0,100)/100)*range;
      const globalHeight = (clamp(b.height_percent,1,100)/100)*range;
      const y = clamp(globalTop + globalHeight/2,1,99);
      all.push(cleanSlot({
        ...raw,
        y_percent:y,
        bbox:{x_percent:clamp(b.x_percent,0,99),y_percent:clamp(globalTop,0,99),width_percent:clamp(b.width_percent,1,100),height_percent:clamp(globalHeight,0.3,100)}
      }));
    }
  }
  all.sort((a,b)=>a.y_percent-b.y_percent);
  const deduped = [];
  for (const s of all) {
    const dupeIndex = deduped.findIndex(d => Math.abs(d.y_percent-s.y_percent)<1.8 && d.source_type===s.source_type && (d.slot_type===s.slot_type || wordsOverlap(d.title,s.title)>0.45));
    if (dupeIndex >= 0) {
      if ((s.confidence||0) > (deduped[dupeIndex].confidence||0)) deduped[dupeIndex]=s;
    } else deduped.push(s);
  }
  return {page_summary:summaries.slice(0,4).join(' '),detected_language:language,image_slots:deduped};
}

function wordsOverlap(a,b) {
  const A = new Set(String(a||'').toLowerCase().split(/\W+/).filter(x=>x.length>3));
  const B = new Set(String(b||'').toLowerCase().split(/\W+/).filter(x=>x.length>3));
  if (!A.size || !B.size) return 0;
  let inter=0; A.forEach(x=>B.has(x)&&inter++);
  return inter/Math.min(A.size,B.size);
}

function getSlot(id) { return state.analysis?.image_slots.find(s => s.id===id); }
function updateField(id, field, value) {
  const s=getSlot(id); if (!s) return;
  if (field==='y_percent') s[field]=clamp(value,1,99);
  else s[field]=value;
  if (field==='action' && value==='keep') state.selectedIds.delete(id);
  if (field==='y_percent') {
    const pin=document.querySelector(`[data-slot-pin="${id}"]`); if (pin) pin.style.top=`${s[field]}%`;
  }
  scheduleSave();
  if (['action','priority','slot_type','recommended_ratio'].includes(field)) render();
}
function normalizeSlotOrder(){ if(!state.analysis)return;state.analysis.image_slots.sort((a,b)=>a.y_percent-b.y_percent);render();scheduleSave(); }
function focusSlot(id, scroll) { state.activeId=id; render(); if (scroll) setTimeout(()=>document.getElementById(`slot-${id}`)?.scrollIntoView({behavior:'smooth',block:'center'}),0); }
function addSlot() {
  if (!state.analysis) state.analysis={page_summary:'',detected_language:'',image_slots:[]};
  const s=cleanSlot({id:uid(),title:'New image slot',section_title:'Manual placement',section_context:'',y_percent:50,source_type:'manual',action:'add',priority:'medium',confidence:1,slot_type:'lifestyle_image',reason:'Manual image opportunity.',google_search:'',image_prompt:'',recommended_ratio:'4:5'});
  state.analysis.image_slots.push(s); state.analysis.image_slots.sort((a,b)=>a.y_percent-b.y_percent); state.activeId=s.id; render(); scheduleSave(); setTimeout(()=>document.getElementById(`slot-${s.id}`)?.scrollIntoView({behavior:'smooth',block:'center'}),0);
}
function deleteSlot(id) { if (!state.analysis) return; state.analysis.image_slots=state.analysis.image_slots.filter(s=>s.id!==id);state.selectedIds.delete(id);if(state.activeId===id)state.activeId='';render();scheduleSave(); }
function duplicateSlot(id){const s=getSlot(id);if(!s||!state.analysis)return;const copy=cleanSlot({...structuredClone(s),id:uid(),title:`${s.title} — alt`,y_percent:clamp(s.y_percent+1,1,99),generatedUrl:'',generatedDataUrl:'',taskId:'',creditsConsumed:null});state.analysis.image_slots.push(copy);state.analysis.image_slots.sort((a,b)=>a.y_percent-b.y_percent);state.activeId=copy.id;render();scheduleSave();}

function replaceAllExisting(){if(!state.analysis)return;state.analysis.image_slots.forEach(s=>{if(s.source_type==='existing_image'){s.action='replace';}});render();scheduleSave();}
function selectCandidates(){state.selectedIds.clear();(state.analysis?.image_slots||[]).forEach(s=>{if(s.action!=='keep')state.selectedIds.add(s.id);});render();}

async function regeneratePrompts(){
  if(!state.analysis?.image_slots?.length || state.regeneratingPrompts)return;
  state.regeneratingPrompts=true;state.globalError='';render();
  try{
    const payload=state.analysis.image_slots.map(s=>({client_id:s.id,title:s.title,section_title:s.section_title,section_context:s.section_context,slot_type:s.slot_type,source_type:s.source_type,action:s.action,reason:s.reason,priority:s.priority,recommended_ratio:s.recommended_ratio}));
    const out=await apiRetry('regenerate-prompts',{method:'POST',body:JSON.stringify({page_summary:state.analysis.page_summary,detected_language:state.analysis.detected_language,slots:payload,reasoning:state.reasoning})},1);
    for(const item of (out.slots||[])){const s=getSlot(item.client_id);if(!s)continue;if(item.google_search)s.google_search=item.google_search;if(item.image_prompt)s.image_prompt=item.image_prompt;if(RATIOS.includes(item.recommended_ratio))s.recommended_ratio=item.recommended_ratio;}
    await saveCurrentProject(false);
  }catch(e){state.globalError=e.message||'Could not regenerate prompts.';}
  finally{state.regeneratingPrompts=false;render();}
}

async function copyText(text, button) {
  try { await navigator.clipboard.writeText(text || ''); const old=button.innerHTML; button.textContent='Copied'; setTimeout(()=>button.innerHTML=old,1000); }
  catch { state.globalError='Clipboard access was blocked by the browser.'; render(); }
}

async function generate(id, renderDuring=true) {
  const slot=getSlot(id); if(!slot || slot.generating || !slot.image_prompt.trim() || slot.action==='keep') return false;
  slot.generating=true; slot.error=''; slot.generatedUrl=''; slot.generatedDataUrl=''; render();
  try {
    const created=await apiRetry('generate-image',{method:'POST',body:JSON.stringify({prompt:slot.image_prompt,aspectRatio:slot.recommended_ratio})},1);
    slot.taskId=created.taskId;
    let url='', credits=null;
    for(let i=0;i<80;i++){
      await sleep(i<5?1500:2500);
      const st=await apiRetry(`task-status?taskId=${encodeURIComponent(slot.taskId)}`,{},1);
      if(st.state==='success' && st.resultUrls?.[0]){url=st.resultUrls[0];credits=st.creditsConsumed;break;}
      if(['fail','failed'].includes(st.state))throw new Error(st.failMsg||'Image generation failed');
    }
    if(!url)throw new Error('Generation is taking too long. Try regenerate.');
    slot.generatedUrl=url; slot.creditsConsumed=credits;
    try { slot.generatedDataUrl = await cacheGeneratedImage(url); } catch {}
    await saveCurrentProject(false);
    return true;
  } catch(e){slot.error=e.message;return false;}
  finally{slot.generating=false;if(renderDuring){render();setTimeout(()=>document.getElementById(`slot-${id}`)?.scrollIntoView({behavior:'smooth',block:'center'}),0);}}
}

async function generateSelected(){
  const ids=(state.analysis?.image_slots||[]).filter(s=>state.selectedIds.has(s.id)&&s.action!=='keep').map(s=>s.id);
  if(!ids.length)return;
  for(let i=0;i<ids.length;i++){
    const s=getSlot(ids[i]); if(!s)continue;
    await generate(ids[i],false);
  }
}

function proxyUrl(url,name='image.png'){return `/api/proxy-image?url=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}`;}
async function cacheGeneratedImage(url){const res=await fetch(proxyUrl(url,'cache.png'));if(!res.ok)throw new Error('Could not cache generated image');return blobToDataUrl(await res.blob());}
function imageFileName(s){return `advertorial-${String((state.analysis?.image_slots.indexOf(s)||0)+1).padStart(2,'0')}-${s.title.replace(/[^a-z0-9]+/gi,'-').toLowerCase()}.png`;}
function downloadImage(id){const s=getSlot(id);if(!s)return;const name=imageFileName(s);if(s.generatedDataUrl){const a=document.createElement('a');a.href=s.generatedDataUrl;a.download=name;document.body.appendChild(a);a.click();a.remove();return;}if(s.generatedUrl){const a=document.createElement('a');a.href=proxyUrl(s.generatedUrl,name);a.download='';document.body.appendChild(a);a.click();a.remove();}}
async function copyImage(id){const s=getSlot(id);if(!s)return;try{let blob;if(s.generatedDataUrl)blob=await (await fetch(s.generatedDataUrl)).blob();else if(s.generatedUrl){const res=await fetch(proxyUrl(s.generatedUrl));if(!res.ok)throw new Error();blob=await res.blob();}else return;const png=blob.type==='image/png'?blob:await toPngBlob(blob);await navigator.clipboard.write([new ClipboardItem({'image/png':png})]);}catch{state.globalError='Copy image is not supported here. Use Download instead.';render();}}
async function toPngBlob(blob){const bmp=await createImageBitmap(blob);const c=document.createElement('canvas');c.width=bmp.width;c.height=bmp.height;c.getContext('2d').drawImage(bmp,0,0);return await new Promise(r=>c.toBlob(r,'image/png'));}

function exportPromptsTxt(){const slots=state.analysis?.image_slots||[];const txt=slots.map((s,i)=>`IMAGE ${String(i+1).padStart(2,'0')} — ${s.title}\nSection: ${s.section_title}\nType: ${slotTypeLabel(s.slot_type)}\nAction: ${actionLabel(s.action)}\nPriority: ${priorityLabel(s.priority)}\nWhy: ${s.reason}\n\nGoogle Search:\n${s.google_search}\n\nAI Prompt:\n${s.image_prompt}\n\nFormat: ${s.recommended_ratio}\n${'-'.repeat(70)}`).join('\n\n');downloadText(`${safeProjectName()}-prompts.txt`,txt,'text/plain');}
function exportSearches(){const slots=(state.analysis?.image_slots||[]).filter(s=>s.google_search);const txt=slots.map((s,i)=>`${i+1}. ${s.google_search}`).join('\n');downloadText(`${safeProjectName()}-google-searches.txt`,txt,'text/plain');}
function exportCsv(){const rows=[['Slot','Title','Section','Type','Source','Action','Priority','Position %','Reason','Google Search','AI Prompt','Format']];(state.analysis?.image_slots||[]).forEach((s,i)=>rows.push([i+1,s.title,s.section_title,slotTypeLabel(s.slot_type),sourceLabel(s.source_type),actionLabel(s.action),priorityLabel(s.priority),s.y_percent,s.reason,s.google_search,s.image_prompt,s.recommended_ratio]));const csv=rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n');downloadText(`${safeProjectName()}-image-plan.csv`,csv,'text/csv;charset=utf-8');}
function downloadText(name,text,type){const blob=new Blob([text],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function safeProjectName(){return (state.projectName||'advertorial').replace(/[^a-z0-9-_]+/gi,'-').replace(/^-+|-+$/g,'').toLowerCase()||'advertorial';}

let saveTimer;
function scheduleSave(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>saveCurrentProject(false),800);}

const DB_NAME='advertorial-image-generator-v2';
const STORE='projects';
function openDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE,{keyPath:'id'});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function dbPut(value){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(value);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};});}
async function dbGet(id){const db=await openDb();return new Promise((resolve,reject)=>{const req=db.transaction(STORE).objectStore(STORE).get(id);req.onsuccess=()=>{db.close();resolve(req.result);};req.onerror=()=>{db.close();reject(req.error);};});}
async function dbDelete(id){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(id);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};});}
async function dbAll(){const db=await openDb();return new Promise((resolve,reject)=>{const req=db.transaction(STORE).objectStore(STORE).getAll();req.onsuccess=()=>{db.close();resolve(req.result||[]);};req.onerror=()=>{db.close();reject(req.error);};});}

function serializableAnalysis(){if(!state.analysis)return null;return {...state.analysis,image_slots:state.analysis.image_slots.map(({generating,error,...s})=>({...s,generating:false,error:''}))};}
async function saveCurrentProject(manual=false){if(!state.imageDataUrl)return;try{state.saving=manual; if(manual)render();if(!state.projectId)state.projectId=uid();const now=new Date().toISOString();const existing=await dbGet(state.projectId);await dbPut({id:state.projectId,projectName:state.projectName||'Untitled advertorial',imageDataUrl:state.imageDataUrl,imageWidth:state.imageWidth,imageHeight:state.imageHeight,analysis:serializableAnalysis(),auditMode:state.auditMode,mode:state.mode,reasoning:state.reasoning,createdAt:existing?.createdAt||now,updatedAt:now});}catch(e){if(manual)state.globalError='Could not save this project in the browser.';}finally{state.saving=false;if(manual)render();}}
async function loadProjectList(){try{state.projects=(await dbAll()).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));}catch{state.projects=[];state.globalError='Could not load saved projects.';}}
async function openProject(id){const p=await dbGet(id);if(!p)return;state.projectId=p.id;state.projectName=p.projectName||'Untitled advertorial';state.imageDataUrl=p.imageDataUrl||'';state.imageWidth=p.imageWidth||0;state.imageHeight=p.imageHeight||0;state.analysis=p.analysis?cleanAnalysis(p.analysis):null;state.analysisSegments=[];state.auditMode=p.auditMode||'smart';state.mode=p.mode||'balanced';state.reasoning=p.reasoning||'medium';state.selectedIds.clear();state.activeId=state.analysis?.image_slots?.[0]?.id||'';state.view='workspace';render();}
async function deleteProjectRecord(id){await dbDelete(id);await loadProjectList();if(state.projectId===id){state.projectId='';}render();}
async function duplicateProjectRecord(id){const p=await dbGet(id);if(!p)return;const copy=structuredClone(p);copy.id=uid();copy.projectName=`${p.projectName||'Advertorial'} copy`;copy.createdAt=copy.updatedAt=new Date().toISOString();await dbPut(copy);await loadProjectList();render();}

function reset(){state.file=null;state.imageDataUrl='';state.imageWidth=0;state.imageHeight=0;state.analysisSegments=[];state.analysis=null;state.analyzing=false;state.activeId='';state.selectedIds.clear();state.globalError='';state.progress={pct:0,message:''};state.projectId='';state.projectName='';state.view='workspace';render();}

window.addEventListener('paste', e => {
  if (state.view!=='workspace' || state.imageDataUrl) return;
  const item=Array.from(e.clipboardData?.items||[]).find(i=>i.type.startsWith('image/'));
  const file=item?.getAsFile(); if(file) handleFile(file);
});

render();
