# Image brief for Antigravity (Gemini image generation)

Job: generate the images below, check each against the rules, regenerate until it passes, then save it with the EXACT filename and folder shown (paths are from this repository's root).
The code already points at these paths. Do not edit any code. Do not rename, add or skip files. Until a file exists the app shows an icon or letter instead, so nothing breaks.

## Rules for every image
- Format: WebP, exactly 1024x1024 (square), under 150 KB.
- Subject centred, about 12% empty margin on every side.
- Product photos: realistic studio photo, soft light, plain light-grey seamless background (#f1f3f5), soft floor shadow. Same camera angle and lighting across all product photos.
- Logos: flat vector-style mark on a solid background (see the prompt), no gradients, no shadow, readable at 32 px.
- No text, letters, brand names, watermarks, hands or people (the Learnly logo's single "L" shape is the only exception).
- Product anatomy must be correct: no extra buttons, bent straps, broken cables, mirrored or melted parts.
- Pass check: view it at 64 px and at full size. It must stay recognisable at 64 px.

## Files

| # | Save as | Used by the code | Prompt |
|---|---|---|---|
| 1 | `apps/web/public/img/logo.webp` | Header logo, next to the words "Oja Market" | Simple flat logo mark for an online marketplace called Oja Market: a shopping bag whose handle forms the letter O, teal (#0b6b5d) mark with a small amber (#f5a623) accent, on a solid white background, square, centred, no text |
| 2 | `apps/web/public/img/headphones.webp` | Product photo for titles containing "headphone" | Premium over-ear wireless headphones, matte black with gold accents, three-quarter view |
| 3 | `apps/web/public/img/speaker.webp` | Titles containing "speaker" | Portable cylindrical bluetooth speaker, dark fabric mesh, three-quarter view |
| 4 | `apps/web/public/img/earbuds.webp` | Titles containing "earbud" | Pair of white wireless earbuds beside an open charging case, three-quarter view |
| 5 | `apps/web/public/img/powerbank.webp` | Titles containing "power bank" | Slim 20000mAh power bank, matte grey, a USB cable coiled beside it |
| 6 | `apps/web/public/img/watch.webp` | Titles containing "watch" | Modern smart watch, black strap, bright watch face, front three-quarter view |

Mapping lives in `apps/web/lib/images.ts`; the component is `apps/web/components/Img.tsx`.

## After saving
Tell Claude Code "images saved". It will rebuild, redeploy and check each image in the browser.
