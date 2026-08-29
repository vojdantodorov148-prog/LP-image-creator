import { json, kieFetch } from './_shared.mjs';

export async function handler(event) {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });
  try {
    const taskId = event.queryStringParameters?.taskId;
    if (!taskId || !/^[a-zA-Z0-9_-]{6,200}$/.test(taskId)) return json(400, { error: 'Invalid taskId.' });
    const data = await kieFetch(`/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`);
    const d = data?.data || {};
    let resultUrls = [];
    try {
      const result = typeof d.resultJson === 'string' ? JSON.parse(d.resultJson) : d.resultJson;
      resultUrls = result?.resultUrls || result?.result_urls || result?.urls || [];
    } catch {}
    return json(200, {
      state: d.state || 'waiting',
      progress: d.progress ?? null,
      resultUrls,
      failCode: d.failCode || '',
      failMsg: d.failMsg || '',
      creditsConsumed: d.creditsConsumed ?? null
    });
  } catch (e) {
    console.error(e);
    return json(e.status && e.status >= 400 && e.status < 600 ? e.status : 500, { error: e.message || 'Could not check generation status.' });
  }
}
