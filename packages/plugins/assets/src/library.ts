import { defineGrip } from '@grythjs/plugin-api';
import { AtomValueTap, type AtomTapHandle, type Drip, type GripContext, type GripContextLike, type Grok } from '@owebeeone/grip-react';
import { GVID_PROJECT_VIEW, type AssetRecord, type ProjectView } from '@gvidjs/contracts';

export interface LibraryFolder { id: string; name: string; parentId: string | null }
export interface LibraryView {
  sessionId: string | null;
  folders: readonly LibraryFolder[];
  assetFolders: Readonly<Record<string, string | null>>;
  removedAssetIds: readonly string[];
  nextFolderNumber: number;
}

export interface LibraryUi {
  sessionId: string | null;
  folderId: string | null;
  searchOpen: boolean;
  columns: number;
  creating: boolean;
  draftName: string;
  error: string;
  pendingDelete: { kind: 'asset' | 'folder'; id: string } | null;
}

export const GVID_LIBRARY_VIEW = defineGrip<LibraryView>('Gvid.Library.View');
export const GVID_LIBRARY_VIEW_TAP = defineGrip<AtomTapHandle<LibraryView>>('Gvid.Library.View.Tap');
export const GVID_LIBRARY_UI = defineGrip<LibraryUi>('Gvid.Library.Ui');
export const GVID_LIBRARY_UI_TAP = defineGrip<AtomTapHandle<LibraryUi>>('Gvid.Library.Ui.Tap');

export function emptyLibrary(sessionId: string | null = null): LibraryView {
  return { sessionId, folders: [], assetFolders: {}, removedAssetIds: [], nextFolderNumber: 1 };
}

export function libraryAssets(catalog: readonly AssetRecord[], view: LibraryView,
  folderId: string | null): AssetRecord[] {
  const removed = new Set(view.removedAssetIds);
  return catalog.filter((asset) => !removed.has(asset.id) && (view.assetFolders[asset.id] ?? null) === folderId);
}

export function createFolder(view: LibraryView, name: string, parentId: string | null): LibraryView {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 80 || parentId !== null && !view.folders.some((folder) => folder.id === parentId)) return view;
  if (view.folders.some((folder) => folder.parentId === parentId && folder.name.toLowerCase() === trimmed.toLowerCase())) return view;
  return { ...view, folders: [...view.folders, { id: `folder-${view.nextFolderNumber}`, name: trimmed, parentId }],
    nextFolderNumber: view.nextFolderNumber + 1 };
}

export function moveAsset(view: LibraryView, catalog: readonly AssetRecord[],
  assetId: string, folderId: string | null): LibraryView {
  if (!catalog.some((asset) => asset.id === assetId) || view.removedAssetIds.includes(assetId) ||
    folderId !== null && !view.folders.some((folder) => folder.id === folderId)) return view;
  if ((view.assetFolders[assetId] ?? null) === folderId) return view;
  return { ...view, assetFolders: { ...view.assetFolders, [assetId]: folderId } };
}

export function removeAsset(view: LibraryView, assetId: string): LibraryView {
  if (view.removedAssetIds.includes(assetId)) return view;
  const assetFolders = { ...view.assetFolders };
  delete assetFolders[assetId];
  return { ...view, assetFolders, removedAssetIds: [...view.removedAssetIds, assetId] };
}

export function removeFolder(view: LibraryView, folderId: string): LibraryView {
  if (!view.folders.some((folder) => folder.id === folderId)) return view;
  const removedFolders = new Set([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of view.folders) {
      if (folder.parentId && removedFolders.has(folder.parentId) && !removedFolders.has(folder.id)) {
        removedFolders.add(folder.id);
        changed = true;
      }
    }
  }
  const removedAssets = Object.entries(view.assetFolders)
    .filter(([, parentId]) => parentId !== null && removedFolders.has(parentId))
    .map(([assetId]) => assetId);
  const assetFolders = Object.fromEntries(Object.entries(view.assetFolders)
    .filter(([, parentId]) => parentId === null || !removedFolders.has(parentId)));
  return { ...view, folders: view.folders.filter((folder) => !removedFolders.has(folder.id)), assetFolders,
    removedAssetIds: [...view.removedAssetIds, ...removedAssets] };
}

class LibraryRootTap extends AtomValueTap<LibraryView> {
  private project?: Drip<ProjectView>;
  private unsubscribeProject?: () => void;

  constructor() { super(GVID_LIBRARY_VIEW, emptyLibrary(), { handleGrip: GVID_LIBRARY_VIEW_TAP }); }

  override onAttach(home: GripContext | GripContextLike): void {
    super.onAttach(home);
    this.project = this.engine!.query(GVID_PROJECT_VIEW, home);
    this.unsubscribeProject = this.project.subscribe(() => this.syncProject());
    this.syncProject();
  }

  override onDetach(): void {
    this.unsubscribeProject?.();
    this.unsubscribeProject = undefined;
    this.project = undefined;
    super.onDetach();
  }

  private syncProject(): void {
    const project = this.project?.get();
    const sessionId = project?.projectId ? project.sessionId : null;
    if (this.get().sessionId !== sessionId) super.set(emptyLibrary(sessionId));
  }
}

export function registerLibraryTaps(grok: Grok): void { grok.registerTap(new LibraryRootTap()); }
