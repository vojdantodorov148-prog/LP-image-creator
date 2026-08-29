import { json, kieFetch } from './_shared.mjs';

const ALLOWED = new Set(['4:5','1:1','3:4','4:3','3:2','2:3','16:9','9:16','auto']);

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  try {
    const { prompt, aspectRatio } = JSON.parse(event.body || '{}');
    if (!prompt || typeof prompt !== 'string') return json(400, { error: 'Image prompt is required.' });
    if (prompt.length > 12000) return json(400, { error: 'Image prompt is too long.' });
    const ratio = ALLOWED.has(aspectRatio) ? aspectRatio : '4:5';
    const data = await kieFetch('/api/v1/jobs/createTask', {
      method: 'POST',
      body: JSON.stringify({
        model: 'gpt-image-2-text-to-image',
        input: { prompt, aspect_ratio: ratio }
      })
    });
    const taskId = data?.data?.taskId;
    if (!taskId) throw new Error('KIE did not return a generation task ID.');
    return json(200, { taskId });
  } catch (e) {
    console.error(e);
    return json(e.status && e.status >= 400 && e.status < 600 ? e.status : 500, { error: e.message || 'Could not start image generation.' });
  }
}
