# Advertorial Image Generator V2.1 — background analysis fix

A static Netlify app for turning a full-page advertorial/listicle screenshot into an image audit and production plan.

## V2 workflow

1. Upload, drag/drop, or paste a full-page screenshot.
2. Choose an image audit mode:
   - **Smart audit** — evaluate existing images and decide Keep / Replace, while also finding empty and missing high-value visuals.
   - **Empty only** — ignore existing images and return only empty/missing image opportunities.
   - **Replace existing** — return existing content images only, all as Replace.
   - **Force replace all** — every existing content image becomes Replace; empty/new opportunities can still be Added.
3. The browser automatically slices long screenshots into overlapping vertical segments.
4. Each uploaded segment starts a Netlify Background Function. The browser polls a short status endpoint while Gemini analyzes the segment. Netlify Blobs stores the job result between requests. A segment can take up to Netlify's 15-minute background limit.
5. A text-only final pass also runs in the background. If it fails, the app falls back to the completed segment findings.
6. Each image slot includes:
   - Keep / Replace / Add / Needs review
   - priority and confidence
   - image goal/type
   - section/location and editable position
   - reason for the recommendation
   - thumbnail crop of an existing image when available
   - Google Images search phrase
   - full AI-generation prompt
   - recommended aspect ratio
7. Generate one image or select several and use **Generate selected** with GPT Image 2.
8. Copy/download generated images; export prompts, searches, or the full plan as CSV.
9. Save projects and reopen them later from **Saved Projects**. V2 stores project history in IndexedDB in the current browser, including the screenshot, audit, prompts and cached generated images.

## API / security

The KIE API key is server-side only through Netlify Functions.

Required Netlify environment variable:

```text
KIE_API_KEY=your_key_here
```

Never put the real key in `public/app.js`, GitHub, or `.env.example`.

## Netlify deployment

This project requires Netlify Functions, so deploy it through a Git repository connected to Netlify rather than a static drag/drop deploy.

Repository root must contain:

```text
public/
netlify/
netlify.toml
package.json
package-lock.json
README.md
.env.example
```

Netlify configuration is already included:

```toml
[build]
  publish = "public"
  functions = "netlify/functions"

[functions]
  node_bundler = "esbuild"

[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/:splat"
  status = 200
```

After importing the repo in Netlify:

1. Add `KIE_API_KEY` under **Project configuration → Environment variables**.
2. Trigger a new production deploy.
3. Open the site and upload one full-page screenshot.
4. Start with **Smart audit + Balanced + Medium**.

## Netlify Functions

- `upload-screenshot.mjs` — temporary screenshot-segment upload to KIE storage
- `create-analysis-job.mjs` — persist a queued job and start its worker
- `analysis-worker-background.mjs` — run segment/final analysis outside the browser request
- `analysis-job-status.mjs` — read persisted job status/results
- `analyze-segment.mjs` — multimodal audit used by the background worker
- `finalize-analysis.mjs` — final audit pass used by the background worker
- `regenerate-prompts.mjs` — rewrite all search phrases and generation prompts
- `generate-image.mjs` — create a GPT Image 2 generation task
- `task-status.mjs` — poll image-generation status
- `proxy-image.mjs` — validated image download/copy proxy
- `analyze-advertorial.mjs` — legacy V1 endpoint retained for compatibility; V2 frontend does not use it

## Saved Projects note

Saved Projects are intentionally local to the browser in this build, so V2 does not require a Supabase project just to work. If cross-device/team sync is needed later, the IndexedDB persistence layer can be swapped for Supabase without changing the image-analysis workflow.

## Updating an existing V2 Netlify deployment

Replace the files in the existing GitHub repository with the contents of this project's folder. Commit the changes and wait for the connected Netlify project to redeploy. Keep the existing `KIE_API_KEY` environment variable. The repository now includes `package.json` and `package-lock.json`; Netlify installs the `@netlify/blobs` dependency at build time. No Supabase project or extra environment variable is needed. Confirm that the deployed Functions list includes `analysis-worker-background`, `create-analysis-job`, and `analysis-job-status`.

Jobs in progress depend on their browser tab remaining open to collect results; completed projects continue to save to IndexedDB. If a worker exceeds 15 minutes, the app reports a timeout for that segment and continues with the other segments. Background execution and blob storage use Netlify credits.
