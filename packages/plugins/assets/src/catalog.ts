import type { AssetRecord } from '@gvidjs/contracts';

export function visibleAssets(catalog: readonly AssetRecord[], query: string): AssetRecord[] {
  const term = query.trim().toLocaleLowerCase();
  if (!term) return [...catalog];
  return catalog.filter((asset) =>
    [asset.displayName, asset.id, asset.version, asset.status, asset.reason ?? '']
      .some((value) => value.toLocaleLowerCase().includes(term)),
  );
}

export function frameRate(asset: AssetRecord): string {
  const { num, den } = asset.frameRate;
  return den > 0 ? `${Number((num / den).toFixed(2))} fps` : 'Frame rate unavailable';
}
