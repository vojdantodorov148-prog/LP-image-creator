import { json } from './_shared.mjs';
import { readJob, validId } from './_analysis-jobs.mjs';

export async function handler(event) {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });
  const id = new URLSearchParams(event.queryStringParameters || {}).get('id');
  if (!validId(id)) return json(400, { error: 'Invalid job ID.' });
  try {
    const job = await readJob(id);
    if (!job) return json(404, { error: 'Analysis job not found.' });
    // If the platform terminates a worker, it cannot write a failure state.
    if (Date.now() - job.createdAt > 16 * 60 * 1000 && !['done', 'failed'].includes(job.status)) {
      return json(200, { status: 'failed', error: 'Analysis exceeded the 15-minute background limit. Try a smaller screenshot segment.' });
    }
    return json(200, { status: job.status, error: job.error, result: job.status === 'done' ? job.result : undefined });
  } catch (error) {
    console.error('Could not read job status:', error);
    return json(500, { error: 'Could not read analysis progress.' });
  }
}
