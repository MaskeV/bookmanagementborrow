// Gives every category / title its own soft colour, always the same one for the same text.
// light-dark() picks the right shade automatically for the current theme.
export function tagStyle(text?: string | null): Record<string, string> {
  let hash = 0;
  for (const ch of text ?? '') hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return {
    'background-color': `light-dark(hsl(${hash} 80% 94%), hsl(${hash} 45% 24%))`,
    color: `light-dark(hsl(${hash} 55% 28%), hsl(${hash} 80% 82%))`,
  };
}
