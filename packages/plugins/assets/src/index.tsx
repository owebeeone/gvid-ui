import { addEntry, DESKTOP_OPEN_WIRED } from '@grythjs/plugin-api';
import { createAtomValueTap, useGrip } from '@owebeeone/grip-react';
import type { DragEvent } from 'react';
import {
  GVID_ASSETS_PLUGIN, GVID_ASSET_CATALOG, GVID_ASSET_QUERY, GVID_ASSET_QUERY_TAP,
  GVID_DEST_ASSET_ID, GVID_DEST_ASSET_ID_TAP, GVID_TOOLS,
} from '@gvidjs/contracts';
import { frameRate, visibleAssets } from './catalog';
import { AssetSelectionTabTap } from './selection';
import {
  GVID_LIBRARY_UI, GVID_LIBRARY_UI_TAP, GVID_LIBRARY_VIEW, GVID_LIBRARY_VIEW_TAP,
  createFolder, emptyLibrary, libraryAssets, moveAsset, removeAsset, removeFolder,
  type LibraryFolder, type LibraryUi,
} from './library';
import './assets.css';

const ASSET_DRAG_TYPE = 'application/x-gvid-library-asset';
const INITIAL_UI: LibraryUi = {
  sessionId: null, folderId: null, searchOpen: false, columns: 4,
  creating: false, draftName: '', error: '', pendingDelete: null,
};

export function Assets({ tabId }: { tabId: string }) {
  const catalog = useGrip(GVID_ASSET_CATALOG) ?? [];
  const selectedId = useGrip(GVID_DEST_ASSET_ID) ?? null;
  const selectionTap = useGrip(GVID_DEST_ASSET_ID_TAP);
  const openWired = useGrip(DESKTOP_OPEN_WIRED);
  const storedQuery = useGrip(GVID_ASSET_QUERY) ?? '';
  const queryTap = useGrip(GVID_ASSET_QUERY_TAP);
  const library = useGrip(GVID_LIBRARY_VIEW) ?? emptyLibrary();
  const libraryTap = useGrip(GVID_LIBRARY_VIEW_TAP);
  const storedUi = useGrip(GVID_LIBRARY_UI) ?? INITIAL_UI;
  const ui = storedUi.sessionId === library.sessionId ? storedUi :
    { ...INITIAL_UI, sessionId: library.sessionId };
  const uiTap = useGrip(GVID_LIBRARY_UI_TAP);
  const query = ui.searchOpen ? storedQuery : '';
  const setUi = (next: LibraryUi) => {
    if (storedUi.sessionId !== library.sessionId) queryTap?.set('');
    uiTap?.set(next);
  };
  const folder = library.folders.find((item) => item.id === ui.folderId);
  const folderId = folder?.id ?? null;
  const path: LibraryFolder[] = [];
  for (let current = folder; current; current = library.folders.find((item) => item.id === current.parentId)) {
    path.unshift(current);
  }
  const available = catalog.filter((asset) => !library.removedAssetIds.includes(asset.id));
  const visible = visibleAssets(query ? available : libraryAssets(catalog, library, folderId), query);
  const folders = library.folders.filter((item) => query ?
    item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) : item.parentId === folderId);
  const selected = available.find((asset) => asset.id === selectedId);

  const dropAsset = (event: DragEvent<HTMLElement>, targetFolderId: string | null) => {
    event.preventDefault();
    const assetId = event.dataTransfer.getData(ASSET_DRAG_TYPE);
    if (assetId) libraryTap?.set(moveAsset(library, catalog, assetId, targetFolderId));
  };

  const allowAssetDrop = (event: DragEvent<HTMLElement>) => {
    if (event.dataTransfer.types.includes(ASSET_DRAG_TYPE)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    }
  };

  const addFolder = () => {
    const next = createFolder(library, ui.draftName, folderId);
    if (next === library) setUi({ ...ui, error: 'Use a unique name up to 80 characters.' });
    else {
      libraryTap?.set(next);
      setUi({ ...ui, creating: false, draftName: '', error: '' });
    }
  };

  const deleteFolder = () => {
    if (folder) setUi({ ...ui, pendingDelete: { kind: 'folder', id: folder.id } });
  };

  const deleteSelected = () => {
    if (selected) setUi({ ...ui, pendingDelete: { kind: 'asset', id: selected.id } });
  };

  const confirmDelete = () => {
    const pending = ui.pendingDelete;
    if (!pending) return;
    if (pending.kind === 'asset') libraryTap?.set(removeAsset(library, pending.id));
    else {
      libraryTap?.set(removeFolder(library, pending.id));
    }
    setUi({ ...ui, folderId: pending.kind === 'folder' ?
      library.folders.find((item) => item.id === pending.id)?.parentId ?? null : ui.folderId,
    pendingDelete: null });
  };

  const pending = ui.pendingDelete;
  const pendingName = pending?.kind === 'asset' ?
    catalog.find((asset) => asset.id === pending.id)?.displayName :
    library.folders.find((item) => item.id === pending?.id)?.name;

  return (
    <section className="gvid-assets" aria-label="Media library">
      <div className="gvid-assets-header"><h2>Media library</h2></div>
      <div className="gvid-assets-toolbar">
        <button type="button" aria-expanded={ui.creating}
          onClick={() => setUi({ ...ui, creating: !ui.creating, draftName: '', error: '' })}>New folder</button>
        <button type="button" aria-expanded={ui.searchOpen}
          onClick={() => {
            if (ui.searchOpen) queryTap?.set('');
            setUi({ ...ui, searchOpen: !ui.searchOpen });
          }}>Search</button>
        <label title="Change icon size by changing the number of columns">
          Columns
          <input type="range" min="2" max="6" step="1" value={ui.columns}
            aria-label="Asset icon columns" aria-valuetext={`${ui.columns} columns`}
            onChange={(event) => setUi({ ...ui, columns: Number(event.target.value) })} />
          <span>{ui.columns}</span>
        </label>
      </div>
      {ui.creating && <form className="gvid-assets-create" onSubmit={(event) => { event.preventDefault(); addFolder(); }}>
        <input aria-label="Folder name" placeholder="Folder name" maxLength={80} autoFocus
          value={ui.draftName} onChange={(event) => setUi({ ...ui, draftName: event.target.value, error: '' })} />
        <button type="submit">Create</button>
        <button type="button" onClick={() => setUi({ ...ui, creating: false, draftName: '', error: '' })}>Cancel</button>
        {ui.error && <span role="alert">{ui.error}</span>}
      </form>}
      {ui.searchOpen && <div className="gvid-assets-search" id="gvid-assets-search">
        <input
          type="search"
          aria-label="Search assets"
          placeholder="Search assets"
          value={query}
          onChange={(event) => queryTap?.set(event.target.value)}
        />
      </div>}
      <nav className="gvid-assets-path" aria-label="Library folder path">
        <button type="button" onClick={() => setUi({ ...ui, folderId: null })}
          onDragOver={allowAssetDrop} onDrop={(event) => dropAsset(event, null)}>Library</button>
        {path.map((item) => <span key={item.id}>
          <span aria-hidden="true"> / </span>
          <button type="button" onClick={() => setUi({ ...ui, folderId: item.id })}
            onDragOver={allowAssetDrop} onDrop={(event) => dropAsset(event, item.id)}>{item.name}</button>
        </span>)}
        {folder && <button type="button" className="gvid-assets-delete-folder" onClick={deleteFolder}
          title={`Remove ${folder.name} and its library contents`}>Delete folder</button>}
      </nav>
      <div className="gvid-assets-count">
        {query ? `${visible.length} of ${available.length} assets` : `${folders.length} folders · ${visible.length} assets`}
      </div>
      {ui.pendingDelete && <div className="gvid-assets-confirm" role="alertdialog" aria-label="Remove library reference">
        <span>Remove {pendingName ?? 'item'}{ui.pendingDelete.kind === 'folder' ? ' and its contents' : ''} from the library? Files and timeline clips stay.</span>
        <button type="button" onClick={confirmDelete}>Remove</button>
        <button type="button" onClick={() => setUi({ ...ui, pendingDelete: null })}>Cancel</button>
      </div>}
      <div className="gvid-assets-list" style={{ gridTemplateColumns: `repeat(${ui.columns}, minmax(0, 1fr))` }}>
        {folders.map((item) => <button key={item.id} type="button" className="gvid-asset-tile gvid-folder-tile"
          title={`Open ${item.name}`} onClick={() => { queryTap?.set(''); setUi({ ...ui, folderId: item.id }); }}
          onDragOver={allowAssetDrop} onDrop={(event) => dropAsset(event, item.id)}>
          <span className="gvid-asset-icon gvid-folder-icon" aria-hidden="true"><span className="gvid-folder-shape" /></span>
          <span className="gvid-asset-name">{item.name}</span>
        </button>)}
        {visible.length === 0 && folders.length === 0 ? (
          <p className="gvid-assets-empty">{available.length === 0 ? 'No assets in this project' : 'No matching items'}</p>
        ) : visible.map((asset) => (
          <button
            key={asset.id}
            type="button"
            className="gvid-asset-tile"
            aria-pressed={asset.id === selectedId}
            aria-label={`${asset.displayName}, ${asset.frameCount} frames, ${asset.hasAudio ? 'audio and video' : 'video only'}, ${asset.status}`}
            title={`${asset.displayName}\n${asset.width} x ${asset.height} | ${frameRate(asset)}\n${asset.frameCount} frames | ${asset.hasAudio ? 'A/V' : 'Video'} | ${asset.version}\n${asset.status}${asset.reason ? `: ${asset.reason}` : ''}`}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id);
              event.dataTransfer.effectAllowed = 'move';
            }}
            onClick={() => {
              selectionTap?.set(asset.id);
              openWired?.(tabId, { toolId: GVID_TOOLS.source });
            }}
          >
            <span className={`gvid-asset-icon${asset.hasAudio ? '' : ' gvid-asset-icon-video'}`} aria-hidden="true">
              <span className="gvid-asset-initials">
                {asset.displayName.split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase()}
              </span>
              <span className={`gvid-asset-status-dot gvid-asset-status-${asset.status}`} />
              <span className="gvid-asset-kind">{asset.hasAudio ? 'A/V' : 'V'}</span>
            </span>
            <span className="gvid-asset-name">{asset.displayName}</span>
          </button>
        ))}
      </div>
      <div className="gvid-assets-selection">
        <span>Selected source</span>
        <strong title={selected?.displayName}>{selected?.displayName ?? 'None'}</strong>
        <button type="button" disabled={!selected} onClick={deleteSelected} title="Remove selected library reference; keep source file">Delete reference</button>
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
        createAtomValueTap(GVID_LIBRARY_UI, { initial: INITIAL_UI, handleGrip: GVID_LIBRARY_UI_TAP }),
      ],
    },
  },
});
