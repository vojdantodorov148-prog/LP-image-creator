# Advertorial Image Generator

Netlify-ready app for turning a finished advertorial/listicle screenshot without images into a complete image plan.

## Workflow

- Drag & drop, upload, or paste one full-page screenshot.
- The browser automatically splits very long screenshots into readable vertical segments for AI analysis while keeping the original page intact in the UI.
- KIE temporary file upload stores the analysis segments.
- Gemini 3.7 Flash reads the copy/layout and returns image placements.
- Each placement includes:
  - marker position on the full screenshot
  - Google Images search phrase
  - direct "Search Google" button
  - detailed generation prompt
  - recommended aspect ratio
  - editable vertical position
- GPT Image 2 generates a selected image.
- Generated images can be copied, downloaded, or regenerated.
- Manual image slots can be added when AI misses something.

## Models

- Analysis: Gemini 3.7 Flash via KIE (`/gemini-3-7-flash-openai/v1/chat/completions`)
- Image generation: GPT Image 2 via KIE (`gpt-image-2-text-to-image`)

## Netlify setup

The frontend is plain HTML/CSS/JS and requires no npm build.

Set this environment variable in Netlify:

`KIE_API_KEY=your_kie_api_key`

The KIE key is only read inside Netlify Functions; it is not exposed in frontend code.

### Recommended deployment

Use a Git repository connected to Netlify so Netlify deploys both the static frontend and the `netlify/functions` folder. The included `netlify.toml` already sets the publish folder and API redirect.

If you only use Netlify's simple drag-and-drop static deploy, serverless Functions may not be deployed with the frontend. In that case, connect the folder/repository to Netlify instead.

## Files

- `public/index.html` — app entry
- `public/styles.css` — UI
- `public/app.js` — frontend logic
- `netlify/functions/upload-screenshot.mjs` — uploads one compressed screenshot segment to temporary KIE storage
- `netlify/functions/analyze-advertorial.mjs` — Gemini analysis of the uploaded segment URLs
- `netlify/functions/generate-image.mjs` — starts GPT Image 2 job
- `netlify/functions/task-status.mjs` — polls KIE generation state
- `netlify/functions/proxy-image.mjs` — secure copy/download proxy
- `netlify/functions/_shared.mjs` — shared KIE helpers
- `netlify.toml` — Netlify config
