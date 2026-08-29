const KIE_API = 'https://api.kie.ai';
const KIE_UPLOAD_API = 'https://kieai.redpandaai.co';

export function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(body)
  };
}

export function apiKey() {
  const key = process.env.KIE_API_KEY;
  if (!key) throw new Error('Missing KIE_API_KEY. Add it in Netlify → Site configuration → Environment variables.');
  return key;
}

export async function kieFetch(path, options = {}, base = KIE_API) {
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.msg || data?.message || data?.error || data?.raw || `KIE request failed (${res.status})`;
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function uploadDataUrl(dataUrl, fileName = 'advertorial.jpg') {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-80);
  const data = await kieFetch('/api/file-base64-upload', {
    method: 'POST',
    body: JSON.stringify({
      base64Data: dataUrl,
      uploadPath: 'advertorial-image-generator',
      fileName: `${Date.now()}-${Math.random().toString(36).slice(2,8)}-${safe}`
    })
  }, KIE_UPLOAD_API);
  const url = data?.data?.downloadUrl || data?.data?.fileUrl;
  if (!url) throw new Error('KIE upload succeeded but returned no file URL.');
  return url;
}

export function parseJsonLoose(text) {
  if (typeof text !== 'string') return text;
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch {}
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) { try { return JSON.parse(fenced[1].trim()); } catch {} }
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) { try { return JSON.parse(trimmed.slice(first, last + 1)); } catch {} }
  throw new Error('AI returned an invalid JSON response. Run the scan again.');
}

export function extractChatContent(data) {
  const choice = data?.choices?.[0]?.message?.content;
  if (typeof choice === 'string') return choice;
  if (Array.isArray(choice)) return choice.map(x => x?.text || x?.content || '').join('');
  const parts = data?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) return parts.map(p => p?.text || '').join('');
  if (typeof data?.text === 'string') return data.text;
  throw new Error('Could not read Gemini response content.');
}
