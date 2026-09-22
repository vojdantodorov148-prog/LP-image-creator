import { randomUUID } from 'node:crypto';
import { json } from './_shared.mjs';
import { writeJob } from './_analysis-jobs.mjs';

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  try {
    const body = JSON.parse(event.body || '{}');
    if (!['segment', 'finalize'].includes(body.kind)) return json(400, { error: 'Invalid job type.' });
    const payload = body.payload;
    if (!payload || typeof payload !== 'object') return json(400, { error: 'Missing analysis input.' });
    if (body.kind === 'segment') {
      if (!/^https:\/\//.test(payload.image?.url || '') || !Number.isInteger(payload.segmentNumber) || payload.segmentNumber < 1 || payload.totalSegments > 100) {
        return json(400, { error: 'Invalid segment input.' });
      }
    } else if (!Array.isArray(payload.analysis?.image_slots) || payload.analysis.image_slots.length > 50) {
      return json(400, { error: 'Invalid finalization input.' });
    }
    const id = randomUUID();
    await writeJob(id, { status: 'queued', kind: body.kind, payload, createdAt: Date.now(), updatedAt: Date.now() });
    // URL is a Netlify read-only runtime variable available to Functions.
    const base = process.env.URL;
    if (!base) throw new Error('Netlify deploy URL is unavailable.');
    const response = await fetch(new URL('/.netlify/functions/analysis-worker-background', base), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id })
    });
    if (response.status !== 202) {
      await writeJob(id, { status: 'failed', error: `Could not start background analysis (HTTP ${response.status}).`, updatedAt: Date.now() });
      throw new Error(`Could not start background analysis (HTTP ${response.status}).`);
    }
    return json(202, { jobId: id });
  } catch (error) {
    console.error('Job start failed:', error);
    return json(500, { error: error.message || 'Could not start analysis.' });
  }
}
