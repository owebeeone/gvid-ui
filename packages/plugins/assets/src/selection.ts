import { AtomValueTap, type Drip, type GripContext, type GripContextLike } from '@owebeeone/grip-react';
import {
  GVID_ASSET_CATALOG, GVID_DEST_ASSET_ID, GVID_DEST_ASSET_ID_TAP,
  type AssetRecord,
} from '@gvidjs/contracts';
import { GVID_LIBRARY_VIEW, type LibraryView } from './library';

export class AssetSelectionTabTap extends AtomValueTap<string | null> {
  private catalog?: Drip<readonly AssetRecord[]>;
  private library?: Drip<LibraryView>;
  private unsubscribeCatalog?: () => void;
  private unsubscribeLibrary?: () => void;
  private seedId: string | null;

  constructor(seedId: string | null = null) {
    super(GVID_DEST_ASSET_ID, null, { handleGrip: GVID_DEST_ASSET_ID_TAP });
    this.seedId = seedId;
  }

  override onAttach(home: GripContext | GripContextLike): void {
    super.onAttach(home);
    this.catalog = this.engine!.query(GVID_ASSET_CATALOG, home);
    this.library = this.engine!.query(GVID_LIBRARY_VIEW, home);
    this.unsubscribeCatalog = this.catalog.subscribe(() => this.repairSelection());
    this.unsubscribeLibrary = this.library.subscribe(() => this.repairSelection());
    this.repairSelection();
  }

  override onDetach(): void {
    this.unsubscribeCatalog?.();
    this.unsubscribeLibrary?.();
    this.unsubscribeCatalog = undefined;
    this.unsubscribeLibrary = undefined;
    this.catalog = undefined;
    this.library = undefined;
    super.onDetach();
  }

  override set(id: string | null): void {
    if (id !== null && (!this.catalog?.get()?.some((asset) => asset.id === id) ||
      this.library?.get()?.removedAssetIds.includes(id))) return;
    this.seedId = null;
    super.set(id);
  }

  private repairSelection(): void {
    const removed = new Set(this.library?.get()?.removedAssetIds ?? []);
    const catalog = (this.catalog?.get() ?? []).filter((asset) => !removed.has(asset.id));
    if (catalog.length === 0) {
      super.set(null);
      return;
    }
    if (catalog.some((asset) => asset.id === this.get())) return;
    const next = catalog.find((asset) => asset.id === this.seedId)
      ?? catalog.find((asset) => asset.displayName.toLocaleLowerCase() === 'lighthouse')
      ?? catalog.find((asset) => asset.status === 'ready')
      ?? catalog[0];
    this.seedId = null;
    super.set(next?.id ?? null);
  }
}
