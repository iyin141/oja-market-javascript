/** Picture key for a product title. Files: public/img/<key>.webp (see IMAGE_PROMPTS.md). */
export function productImageKey(title: string): string | null {
  const t = title.toLowerCase();
  if (t.includes("headphone")) return "headphones";
  if (t.includes("speaker")) return "speaker";
  if (t.includes("earbud")) return "earbuds";
  if (t.includes("power bank") || t.includes("powerbank")) return "powerbank";
  if (t.includes("watch")) return "watch";
  return null;
}
