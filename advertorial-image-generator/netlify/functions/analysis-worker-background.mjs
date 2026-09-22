import { readJob, writeJob, validId } from './_analysis-jobs.mjs';
import { handler as auditSegment } from './analyze-segment.mjs';
import { handler as finalize } from './finalize-analysis.mjs';

export async function handler(event) {
  if (event.httpMethod !== 'POST') return;
  let id;
  try {
    id = JSON.parse(event.body || '{}').id;
    if (!validId(id)) return;
    const job = await readJob(id);
    if (!job || job.status !== 'queued') return;
    await writeJob(id, { ...job, status: 'processing', updatedAt: Date.now() });
    const run = job.kind === 'segment' ? auditSegment : finalize;
    let response;
    for (let attempt = 0; attempt < 2; attempt++) {
      response = await run({ httpMethod: 'POST', body: JSON.stringify(job.payload) });
      if (response.statusCode !== 504 && response.statusCode !== 502 && response.statusCode !== 503) break;
      if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 2500));
    }
    const result = JSON.parse(response.body || '{}');
    if (response.statusCode !== 200 || !result.analysis) {
      throw new Error(result.error || `Analysis failed (HTTP ${response.statusCode}).`);
    }
    // Result is stored before signalling completion; the browser never waits for the AI request.
    await writeJob(id, { status: 'done', kind: job.kind, result, createdAt: job.createdAt, updatedAt: Date.now() });
  } catch (error) {
    console.error('Background analysis failed:', error);
    if (validId(id)) {
      try {
        const job = await readJob(id);
        if (job) await writeJob(id, { status: 'failed', kind: job.kind, error: error.message || 'Background analysis failed.', createdAt: job.createdAt, updatedAt: Date.now() });
      } catch (storageError) { console.error('Could not persist analysis error:', storageError); }
    }
  }
}
