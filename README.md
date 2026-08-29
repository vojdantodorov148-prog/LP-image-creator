# Advertorial Image Generator V2

A static Netlify app for turning a full-page advertorial/listicle screenshot into an image audit and production plan.

## V2 workflow

1. Upload, drag/drop, or paste a full-page screenshot.
2. Choose an image audit mode:
   - **Smart audit** — evaluate existing images and decide Keep / Replace, while also finding empty and missing high-value visuals.
   - **Empty only** — ignore existing images and return only empty/missing image opportunities.
   - **Replace existing** — return existing content images only, all as Replace.
   - **Force replace all** — every existing content image becomes Replace; empty/new opportunities can still be Added.
3. The browser automatically slices long screenshots into overlapping vertical segments.
4. Each segment is uploaded and analyzed separately with Gemini 3.7 Flash through KIE. This prevents one giant synchronous screenshot-analysis request from causing the entire scan to fail with HTTP 504.
5. A lightweight text-only final pass merges/deduplicates segment findings. If that final pass times out, the app falls back to the already-completed segmented audit instead of discarding the results.
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
- `analyze-segment.mjs` — short multimodal audit of one screenshot segment
- `finalize-analysis.mjs` — text-only merge/deduplication/final audit pass
- `regenerate-prompts.mjs` — rewrite all search phrases and generation prompts
- `generate-image.mjs` — create a GPT Image 2 generation task
- `task-status.mjs` — poll image-generation status
- `proxy-image.mjs` — validated image download/copy proxy
- `analyze-advertorial.mjs` — legacy V1 endpoint retained for compatibility; V2 frontend does not use it

## Saved Projects note

Saved Projects are intentionally local to the browser in this build, so V2 does not require a Supabase project just to work. If cross-device/team sync is needed later, the IndexedDB persistence layer can be swapped for Supabase without changing the image-analysis workflow.
