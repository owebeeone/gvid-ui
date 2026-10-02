import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createAtomValueTap, GripProvider, Grok } from '@owebeeone/grip-react';
import { registry } from '@grythjs/plugin-api';
import {
  GVID_ASSET_CATALOG, GVID_ASSET_QUERY, GVID_DEST_ASSET_ID,
  type AssetRecord,
} from '@gvidjs/contracts';
import { Assets } from './index';
import { visibleAssets } from './catalog';
import { AssetSelectionTabTap } from './selection';

const lighthouse: AssetRecord = {
  id: 'asset-a', displayName: 'Lighthouse', version: 'v1', fingerprint: 'a', streamId: 'v0',
  frameCount: 120, width: 640, height: 360, frameRate: { num: 24, den: 1 }, status: 'ready',
};
const workshop: AssetRecord = {
  id: 'asset-b', displayName: 'Workshop', version: '2', fingerprint: 'b', streamId: 'v0',
  frameCount: 90, width: 640, height: 360, frameRate: { num: 24, den: 1 },
  status: 'missing', reason: 'Original file unavailable',
};
const changed: AssetRecord = {
  ...workshop, id: 'asset-c', displayName: 'Archive', status: 'changed', reason: 'Fingerprint changed',
};

function setup(initial: readonly AssetRecord[] = [workshop, lighthouse, changed]) {
  const grok = new Grok(registry);
  const catalog = createAtomValueTap(GVID_ASSET_CATALOG, { initial });
  grok.registerTap(catalog);
  const source = grok.mainPresentationContext.getOrCreateMatchingContext('assets-1');
  const second = grok.mainPresentationContext.getOrCreateMatchingContext('assets-2');
  const selected = new AssetSelectionTabTap();
  const selectedSecond = new AssetSelectionTabTap();
  const query = createAtomValueTap(GVID_ASSET_QUERY, { initial: '' });
  const querySecond = createAtomValueTap(GVID_ASSET_QUERY, { initial: '' });
  source.getGripHomeContext().registerTap(selected);
  source.getGripHomeContext().registerTap(query);
  second.getGripHomeContext().registerTap(selectedSecond);
  second.getGripHomeContext().registerTap(querySecond);
  return { grok, catalog, source, second, selected, selectedSecond, query, querySecond };
}

describe('assets tab', () => {
  it('defaults to Lighthouse and keeps selection and query local to each tab', async () => {
    const { grok, source, second, selected, selectedSecond, query, querySecond } = setup();
    await expect.poll(() => selected.get()).toBe(lighthouse.id);
    await expect.poll(() => selectedSecond.get()).toBe(lighthouse.id);
    selected.set(workshop.id);
    query.set('light');
    expect(visibleAssets([workshop, lighthouse], query.get()).map((asset) => asset.id)).toEqual([lighthouse.id]);
    expect(querySecond.get()).toBe('');
    expect(selected.get()).toBe(workshop.id);
    expect(selectedSecond.get()).toBe(lighthouse.id);
    expect(source.getGripHomeContext()).not.toBe(second.getGripHomeContext());
    const markup = renderToStaticMarkup(
      <GripProvider grok={grok} context={source}><Assets tabId="assets-1" /></GripProvider>,
    );
    expect(markup).not.toContain('Original file unavailable');
    expect(markup).toContain('Selected source</span><strong title="Workshop">Workshop');
  });

  it('passes selection to a wired child context and repairs removed assets', async () => {
    const { grok, source, catalog, selected } = setup();
    const viewer = grok.mainPresentationContext.getOrCreateMatchingContext('source-viewer');
    const viewerHome = viewer.getGripHomeContext();
    const sourceHome = source.getGripHomeContext();
    viewerHome.addParent(sourceHome, -1);
    grok.resolver.addParent(viewerHome, sourceHome);
    const inherited = grok.query(GVID_DEST_ASSET_ID, viewer);
    await expect.poll(() => inherited.get()).toBe(lighthouse.id);
    selected.set(workshop.id);
    await expect.poll(() => inherited.get()).toBe(workshop.id);
    selected.set('unknown');
    expect(selected.get()).toBe(workshop.id);
    catalog.set([lighthouse, changed]);
    await expect.poll(() => selected.get()).toBe(lighthouse.id);
    await expect.poll(() => inherited.get()).toBe(lighthouse.id);
    catalog.set([]);
    await expect.poll(() => inherited.get()).toBeNull();
  });

  it('honors an opening asset after the catalog loads and shows availability metadata', async () => {
    const grok = new Grok(registry);
    const catalog = createAtomValueTap(GVID_ASSET_CATALOG, { initial: [] as readonly AssetRecord[] });
    grok.registerTap(catalog);
    const source = grok.mainPresentationContext.getOrCreateMatchingContext('seeded-assets');
    const selection = new AssetSelectionTabTap(workshop.id);
    source.getGripHomeContext().registerTap(selection);
    source.getGripHomeContext().registerTap(createAtomValueTap(GVID_ASSET_QUERY, { initial: '' }));
    expect(selection.get()).toBeNull();
    catalog.set([lighthouse, workshop, changed]);
    await expect.poll(() => selection.get()).toBe(workshop.id);
    const markup = renderToStaticMarkup(
      <GripProvider grok={grok} context={source}><Assets tabId="seeded-assets" /></GripProvider>,
    );
    expect(markup).toContain('Original file unavailable');
    expect(markup).toContain('Fingerprint changed');
    expect(markup).toContain('120 frames');
    expect(markup).toContain('120 frames | v1');
    expect(markup).not.toContain('vv1');
    expect(markup).toContain('640 x 360');
    expect(markup).toContain('aria-pressed="true"');
  });
});
