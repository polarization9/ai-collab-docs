const mermaidRenderCache = new Map<string, string>();

export function getMermaidCacheKey(
  documentId: string,
  index: number,
  code: string,
  themeKey: string
): string {
  return `${documentId}:${index}:${themeKey}:${code}`;
}

export function getCachedMermaidSvg(key: string): string | undefined {
  return mermaidRenderCache.get(key);
}

export function setCachedMermaidSvg(key: string, svg: string): void {
  mermaidRenderCache.set(key, svg);
}
