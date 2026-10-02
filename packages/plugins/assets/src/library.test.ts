import { describe, expect, it } from 'vitest';
import { createAtomValueTap, Grok } from '@owebeeone/grip-react';
import { registry } from '@grythjs/plugin-api';
import { GVID_PROJECT_VIEW, type AssetRecord, type ProjectView } from '@gvidjs/contracts';
import {
  GVID_LIBRARY_VIEW, GVID_LIBRARY_VIEW_TAP, createFolder, emptyLibrary, libraryAssets, moveAsset,
  registerLibraryTaps, removeAsset, removeFolder,
} from './library';

const assets: AssetRecord[] = [
  { id: 'a', displayName: 'A', version: 'v1', fingerprint: 'a', streamId: 'a', frameCount: 12,
    width: 640, height: 360, frameRate: { num: 24, den: 1 }, hasAudio: true, status: 'ready' },
  { id: 'b', displayName: 'B', version: 'v1', fingerprint: 'b', streamId: 'b', frameCount: 12,
    width: 640, height: 360, frameRate: { num: 24, den: 1 }, hasAudio: false, status: 'ready' },
];

describe('library organization', () => {
  it('creates nested folders, moves assets, and preserves the backing catalog when references are removed', () => {
    const root = createFolder(emptyLibrary('session-a'), 'Scenes', null);
    const parentId = root.folders[0].id;
    const nested = createFolder(root, 'Exteriors', parentId);
    const childId = nested.folders[1].id;
    const placed = moveAsset(moveAsset(nested, assets, 'a', parentId), assets, 'b', childId);
    expect(libraryAssets(assets, placed, null)).toEqual([]);
    expect(libraryAssets(assets, placed, parentId).map((asset) => asset.id)).toEqual(['a']);
    expect(libraryAssets(assets, placed, childId).map((asset) => asset.id)).toEqual(['b']);
    expect(moveAsset(placed, assets, 'unknown', childId)).toBe(placed);
    expect(createFolder(placed, 'exteriors', parentId)).toBe(placed);

    const removed = removeFolder(placed, parentId);
    expect(removed.folders).toEqual([]);
    expect(removed.removedAssetIds).toEqual(['a', 'b']);
    expect(libraryAssets(assets, removed, null)).toEqual([]);
    expect(assets).toHaveLength(2);
    expect(moveAsset(removed, assets, 'a', null)).toBe(removed);
  });

  it('moves an asset back to root and removes only its library reference', () => {
    const view = createFolder(emptyLibrary(), 'Keep', null);
    const folderId = view.folders[0].id;
    const placed = moveAsset(view, assets, 'a', folderId);
    const root = moveAsset(placed, assets, 'a', null);
    expect(libraryAssets(assets, root, null).map((asset) => asset.id)).toEqual(['a', 'b']);
    expect(removeAsset(root, 'a').removedAssetIds).toEqual(['a']);
    expect(removeAsset(root, 'a').folders).toEqual(view.folders);
  });

  it('resets organization on a new project session', async () => {
    const grok = new Grok(registry);
    const project: ProjectView = { projectId: 'mock-a', sessionId: 'session-a', graphId: 'graph-a',
      revision: 1, bindingSetId: 'bindings-a', bindingRevision: 1, sessionOnly: true, status: 'ready' };
    const projectTap = createAtomValueTap(GVID_PROJECT_VIEW, { initial: project });
    grok.registerTap(projectTap);
    registerLibraryTaps(grok);
    const library = grok.query(GVID_LIBRARY_VIEW, grok.mainContext);
    await expect.poll(() => library.get()?.sessionId).toBe('session-a');
    const control = grok.query(GVID_LIBRARY_VIEW_TAP, grok.mainContext).get()!;
    control.set(createFolder(library.get()!, 'Scenes', null));
    await expect.poll(() => library.get()?.folders.length).toBe(1);
    projectTap.set({ ...project, projectId: 'mock-b', sessionId: 'session-b' });
    await expect.poll(() => library.get()?.sessionId).toBe('session-b');
    expect(library.get()?.folders).toEqual([]);
  });
});
