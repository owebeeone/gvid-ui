import { addEntry } from '@grythjs/plugin-api';
import { createAtomValueTap, useGrip } from '@owebeeone/grip-react';
import {
  GVID_ASSETS_PLUGIN, GVID_ASSET_CATALOG, GVID_ASSET_QUERY, GVID_ASSET_QUERY_TAP,
  GVID_DEST_ASSET_ID, GVID_DEST_ASSET_ID_TAP, GVID_TOOLS,
} from '@gvidjs/contracts';
import { frameRate, visibleAssets } from './catalog';
import { AssetSelectionTabTap } from './selection';
import './assets.css';

export function Assets() {
  const catalog = useGrip(GVID_ASSET_CATALOG) ?? [];
  const selectedId = useGrip(GVID_DEST_ASSET_ID) ?? null;
  const selectionTap = useGrip(GVID_DEST_ASSET_ID_TAP);
  const query = useGrip(GVID_ASSET_QUERY) ?? '';
  const queryTap = useGrip(GVID_ASSET_QUERY_TAP);
  const visible = visibleAssets(catalog, query);
  const selected = catalog.find((asset) => asset.id === selectedId);

  return (
    <section className="gvid-assets" aria-label="Media library">
      <div className="gvid-assets-header"><h2>Media library</h2></div>
      <div className="gvid-assets-search">
        <input
          type="search"
          aria-label="Search assets"
          placeholder="Search assets"
          value={query}
          onChange={(event) => queryTap?.set(event.target.value)}
        />
      </div>
      <div className="gvid-assets-count">
        {query ? `${visible.length} of ${catalog.length} assets` : `${catalog.length} assets`}
      </div>
      <div className="gvid-assets-list">
        {visible.length === 0 ? (
          <p className="gvid-assets-empty">{catalog.length === 0 ? 'No assets in this project' : 'No matching assets'}</p>
        ) : visible.map((asset) => (
          <button
            key={asset.id}
            type="button"
            className="gvid-asset-row"
            aria-pressed={asset.id === selectedId}
            onClick={() => selectionTap?.set(asset.id)}
          >
            <span className="gvid-asset-monogram" aria-hidden="true">{asset.displayName.slice(0, 1).toUpperCase()}</span>
            <span className="gvid-asset-details">
              <span className="gvid-asset-heading">
                <strong title={asset.displayName}>{asset.displayName}</strong>
                <span className={`gvid-asset-status gvid-asset-status-${asset.status}`}>{asset.status}</span>
              </span>
              <span className="gvid-asset-meta">{asset.width} x {asset.height} | {frameRate(asset)}</span>
              <span className="gvid-asset-meta">{asset.frameCount} frames | {asset.version}</span>
              {asset.reason && <span className="gvid-asset-reason">{asset.reason}</span>}
            </span>
          </button>
        ))}
      </div>
      <div className="gvid-assets-selection">
        <span>Selected source</span>
        <strong title={selected?.displayName}>{selected?.displayName ?? 'None'}</strong>
      </div>
    </section>
  );
}

addEntry(GVID_ASSETS_PLUGIN, {
  tools: {
    [GVID_TOOLS.assets]: {
      label: 'Media library',
      defaultSize: { w: 360, h: 520 },
      role: 'assets',
      windowComponent: Assets,
      tabTaps: (_tabId, params) => [
        new AssetSelectionTabTap(typeof params?.assetId === 'string' ? params.assetId : null),
        createAtomValueTap(GVID_ASSET_QUERY, { initial: '', handleGrip: GVID_ASSET_QUERY_TAP }),
      ],
    },
  },
});
