import { AtomValueTap, type Drip, type GripContext, type GripContextLike } from '@owebeeone/grip-react';
import {
  GVID_ASSET_CATALOG, GVID_DEST_ASSET_ID, GVID_DEST_ASSET_ID_TAP,
  type AssetRecord,
} from '@gvidjs/contracts';

export class AssetSelectionTabTap extends AtomValueTap<string | null> {
  private catalog?: Drip<readonly AssetRecord[]>;
  private unsubscribeCatalog?: () => void;
  private seedId: string | null;

  constructor(seedId: string | null = null) {
    super(GVID_DEST_ASSET_ID, null, { handleGrip: GVID_DEST_ASSET_ID_TAP });
    this.seedId = seedId;
  }

  override onAttach(home: GripContext | GripContextLike): void {
    super.onAttach(home);
    this.catalog = this.engine!.query(GVID_ASSET_CATALOG, home);
    this.unsubscribeCatalog = this.catalog.subscribe(() => this.repairSelection());
    this.repairSelection();
  }

  override onDetach(): void {
    this.unsubscribeCatalog?.();
    this.unsubscribeCatalog = undefined;
    this.catalog = undefined;
    super.onDetach();
  }

  override set(id: string | null): void {
    if (id !== null && !this.catalog?.get()?.some((asset) => asset.id === id)) return;
    this.seedId = null;
    super.set(id);
  }

  private repairSelection(): void {
    const catalog = this.catalog?.get() ?? [];
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
