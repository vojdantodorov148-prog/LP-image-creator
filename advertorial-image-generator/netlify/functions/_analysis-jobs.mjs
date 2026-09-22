import { getStore } from '@netlify/blobs';

const store = () => getStore({ name: 'advertorial-analysis-jobs', consistency: 'strong' });
export const jobKey = id => `job/${id}`;
export const validId = id => /^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(String(id || ''));
export async function readJob(id) {
  return store().get(jobKey(id), { type: 'json', consistency: 'strong' });
}
export async function writeJob(id, job) {
  await store().setJSON(jobKey(id), job);
}
