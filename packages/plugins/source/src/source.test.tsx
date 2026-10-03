import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { registry } from '@grythjs/plugin-api';
import { createAtomValueTap, GripProvider, Grok } from '@owebeeone/grip-react';
import {
  GVID_ASSET_CATALOG, GVID_CHANGE_STATUS, GVID_EDIT_COMMAND, GVID_PROJECT_VIEW,
  GVID_SOURCE_DESTINATION, GVID_SOURCE_MARKER_CATALOG, GVID_SOURCE_TRANSPORT,
  type AssetRecord, type EditorControl,
} from '@gvidjs/contracts';
import { SourceViewer } from './index';

describe('source marker controls', () => {
  it('renders an editor for a marked frame without a per-tab draft tap', () => {
    const grok = new Grok(registry);
    const asset: AssetRecord = {
      id: 'lighthouse', displayName: 'Lighthouse', version: 'v1', fingerprint: 'light-1',
      streamId: 'video', frameCount: 120, width: 640, height: 360,
      frameRate: { num: 24, den: 1 }, hasAudio: true, status: 'ready',
    };
    grok.registerTap(createAtomValueTap(GVID_ASSET_CATALOG, { initial: [asset] }));
    grok.registerTap(createAtomValueTap(GVID_PROJECT_VIEW, { initial: {
      projectId: 'mock-a', sessionId: 'session-a', graphId: 'graph-a', revision: 2,
      bindingSetId: 'bindings-a', bindingRevision: 1, sessionOnly: true, status: 'ready' as const,
    } }));
    grok.registerTap(createAtomValueTap(GVID_CHANGE_STATUS, { initial: { state: 'live' as const } }));
    grok.registerTap(createAtomValueTap(GVID_EDIT_COMMAND, { initial: {} as EditorControl }));
    grok.registerTap(createAtomValueTap(GVID_SOURCE_DESTINATION, { initial: {
      viewerId: 'source-1', projectId: 'mock-a', sessionId: 'session-a',
      assetId: asset.id, assetVersion: asset.version, fingerprint: asset.fingerprint,
      sourceFrame: 12, mode: 'wired' as const,
    } }));
    grok.registerTap(createAtomValueTap(GVID_SOURCE_TRANSPORT, { initial: {
      frame: 12, frameCount: asset.frameCount, playing: false, shuttleRate: 0,
      rate: asset.frameRate,
    } }));
    grok.registerTap(createAtomValueTap(GVID_SOURCE_MARKER_CATALOG, { initial: [{
      assetId: asset.id, assetVersion: asset.version, fingerprint: asset.fingerprint,
      markers: [{ id: 'marker-1', sourceFrame: 12, label: 'Slate', color: 'blue' as const }],
    }] }));

    const context = grok.mainPresentationContext.getOrCreateMatchingContext('source-1');
    const html = renderToStaticMarkup(<GripProvider grok={grok} context={context}><SourceViewer /></GripProvider>);
    expect(html).toContain('Edit marker at source frame');
    expect(html).toContain('Slate - double-click to edit');
    expect(html).toContain('<dialog');
    expect(html).toContain('name="label"');
    expect(html).toContain('name="color"');
  });
});
