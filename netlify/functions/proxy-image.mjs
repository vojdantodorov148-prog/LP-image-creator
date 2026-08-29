import { kieFetch } from './_shared.mjs';

export async function handler(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const raw = event.queryStringParameters?.url;
    if (!raw) return { statusCode: 400, body: 'Missing url' };
    let parsed;
    try { parsed = new URL(raw); } catch { return { statusCode: 400, body: 'Invalid url' }; }
    if (parsed.protocol !== 'https:') return { statusCode: 400, body: 'Invalid protocol' };

    // KIE validates that this is one of its generated asset URLs and returns
    // a short-lived direct download URL. This also avoids exposing an open proxy.
    const download = await kieFetch('/api/v1/common/download-url', {
      method: 'POST',
      body: JSON.stringify({ url: raw })
    });
    const directUrl = download?.data;
    if (!directUrl || typeof directUrl !== 'string') throw new Error('KIE did not return a download URL.');

    const res = await fetch(directUrl, { redirect: 'follow' });
    if (!res.ok) return { statusCode: 502, body: 'Could not fetch generated image' };
    const contentType = res.headers.get('content-type') || 'image/png';
    if (!contentType.startsWith('image/')) return { statusCode: 400, body: 'Generated asset is not an image' };
    const buffer = Buffer.from(await res.arrayBuffer());
    const safeName = (event.queryStringParameters?.name || 'advertorial-image.png').replace(/[^a-zA-Z0-9._-]/g, '-');
    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${safeName}"`,
        'Cache-Control': 'private, max-age=300'
      },
      body: buffer.toString('base64')
    };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, body: e.message || 'Image proxy failed' };
  }
}
