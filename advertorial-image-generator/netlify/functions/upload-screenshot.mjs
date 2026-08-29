import { json, uploadDataUrl } from './_shared.mjs';

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  try {
    const { dataUrl, fileName } = JSON.parse(event.body || '{}');
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return json(400, { error: 'Invalid screenshot segment.' });
    // Guard against unexpectedly huge function payloads / accidental raw full-resolution files.
    if (dataUrl.length > 5_200_000) return json(413, { error: 'Screenshot segment is too large. Try a smaller screenshot or compress it first.' });
    const url = await uploadDataUrl(dataUrl, fileName || 'advertorial-segment.jpg');
    return json(200, { url });
  } catch (e) {
    console.error(e);
    return json(e.status && e.status >= 400 && e.status < 600 ? e.status : 500, { error: e.message || 'Screenshot upload failed.' });
  }
}
