import { describe, expect, it, vi } from 'vitest';
import { createAtomValueTap, Grok, GripRegistry, type Tap } from '@owebeeone/grip-react';
import { DESKTOP_TAB_LINKS } from '@grythjs/desktop';
import {
  GVID_ASSET_CATALOG, GVID_BINDING_VIEW, GVID_CHANGE_STATUS, GVID_DEST_SEQUENCE_ID,
  GVID_DEST_TIMELINE_FRAME, GVID_FRAME_PROVIDER, GVID_GRAPH_VIEW, GVID_PROJECT_VIEW,
  GVID_SEQUENCE_DESTINATION, GVID_SEQUENCE_PRESENTATION, GVID_SEQUENCE_PREVIEW_RESULT,
  GVID_SEQUENCE_VIEW, GVID_TOOLS,
  type AssetRecord, type BindingView, type FrameProvider, type FrameResult,
  type GraphView, type ProjectView, type SequenceFrameKey, type SequenceView,
} from '@gvidjs/contracts';
import { resolveSequenceDestination, sequencePresentation, sequenceTabTaps, topmostClipAt } from './taps';

const clips = [
  { id: 'a', assetId: 'lighthouse', sourceIn: 12, sourceOut: 60, timelineIn: 0, timelineOut: 48 },
  { id: 'b', assetId: 'workshop', sourceIn: 5, sourceOut: 53, timelineIn: 48, timelineOut: 96 },
];
const sequence: SequenceView = {
  id: 'main', graphId: 'graph-a', revision: 1, frameRate: { num: 24, den: 1 },
  durationFrames: 100, tracks: [{ id: 'v1', label: 'Video', kind: 'video', locked: false, clips }],
};
const project: ProjectView = {
  projectId: 'mock-a', sessionId: 'session-a', graphId: 'graph-a', revision: 1,
  bindingSetId: 'bind-a', bindingRevision: 1, sessionOnly: true, status: 'ready',
};
const binding: BindingView = { bindingSetId: 'bind-a', revision: 1, byAssetId: {} };
const graph: GraphView = { graphId: 'graph-a', revision: 1, sequence };
const assets: AssetRecord[] = clips.map((clip) => ({
  id: clip.assetId, displayName: clip.id === 'a' ? 'Lighthouse' : 'Workshop',
  version: '1', fingerprint: clip.id, streamId: clip.id, frameCount: 120,
  width: 640, height: 360, frameRate: { num: 24, den: 1 }, status: 'ready',
}));
const links = [
  { tabId: 'timeline', toolId: GVID_TOOLS.timeline, params: {} },
  { tabId: 'viewer', toolId: GVID_TOOLS.sequence, sourceTabId: 'timeline', params: {} },
];

describe('sequence destination', () => {
  it('previews the highest occupied track at an overlap and falls through gaps', () => {
    const layered: SequenceView = { ...sequence, tracks: [...sequence.tracks,
      { id: 'v2', label: 'V2', kind: 'video', locked: false, clips: [
        { id: 'top', assetId: 'workshop', sourceIn: 0, sourceOut: 20, timelineIn: 10, timelineOut: 30 },
      ] },
    ] };
    expect(topmostClipAt(layered, 15)?.id).toBe('top');
    expect(topmostClipAt(layered, 5)?.id).toBe('a');
    expect(topmostClipAt(layered, 99)).toBeNull();
  });
  it('follows a named timeline, validates standalone frames, and rejects a missing parent', () => {
    expect(resolveSequenceDestination('viewer', {
      tabId: 'viewer', sourceTabId: 'timeline', params: { timelineFrame: 88 },
    }, links, project, sequence, 'main', 48)).toMatchObject({
      mode: 'wired', timelineFrame: 48, projectId: 'mock-a', sequenceId: 'main',
    });
    expect(resolveSequenceDestination('viewer', {
      tabId: 'viewer', sourceTabId: 'gone', params: { sequenceId: 'main', timelineFrame: 20 },
    }, links, project, sequence, 'main', 48)).toMatchObject({ mode: 'unresolved', timelineFrame: null });
    const standalone = [{ ...links[1], sourceTabId: undefined, params: { projectId: 'mock-a', sequenceId: 'main' } }];
    expect(resolveSequenceDestination('viewer', {
      tabId: 'viewer', sourceTabId: null, params: standalone[0].params,
    }, standalone, project, sequence, null, null)).toMatchObject({ mode: 'standalone', timelineFrame: 0 });
    expect(resolveSequenceDestination('viewer', {
      tabId: 'viewer', sourceTabId: null, params: { projectId: 'mock-a', sequenceId: 'main', timelineFrame: 100 },
    }, standalone, project, sequence, null, null)).toMatchObject({ mode: 'unresolved', timelineFrame: null });
  });

  it('only calls matching accepted results current and names gaps, stale and failure', () => {
    const destination = resolveSequenceDestination('viewer', {
      tabId: 'viewer', sourceTabId: null, params: { timelineFrame: 48 },
    }, [links[1]], project, sequence, null, null);
    const key: SequenceFrameKey = {
      requestId: 'r1', cancelGroupId: 'c1', viewerId: 'viewer', sessionId: 'session-a',
      projectId: 'mock-a', graphId: 'graph-a', sequenceId: 'main', revision: 1,
      bindingSetId: 'bind-a', bindingRevision: 1, timelineFrame: 48,
    };
    const ready: FrameResult<SequenceFrameKey> = {
      key, state: 'ready', fidelity: 'mock', composition: 'mock-topmost-track',
      resource: { kind: 'mock-png', leaseId: 'lease', objectUrl: 'blob:frame' },
    };
    expect(sequencePresentation(destination, project, graph, binding, { state: 'live' }, ready))
      .toMatchObject({ state: 'current', composition: 'mock-topmost-track' });
    expect(sequencePresentation(destination, project, graph, binding, { state: 'stale', reason: 'replay gap' }, ready))
      .toMatchObject({ state: 'stale', reason: 'replay gap' });
    expect(sequencePresentation(destination, project, graph, { ...binding, revision: 2 }, { state: 'live' }, ready).state)
      .toBe('pending');
    expect(sequencePresentation(destination, { ...project, sessionId: 'another-session' }, graph, binding,
      { state: 'live' }, ready).state).toBe('pending');
    expect(sequencePresentation(destination, { ...project, revision: 2 }, graph, binding,
      { state: 'live' }, ready).state).toBe('pending');
    expect(sequencePresentation(destination, project, graph, binding, { state: 'live' }, { key, state: 'gap', fidelity: 'mock' }).state)
      .toBe('gap');
    expect(sequencePresentation(destination, project, graph, binding, { state: 'live' }, {
      key, state: 'failed', fidelity: 'mock', diagnostic: { code: 'no-frame', message: 'Unavailable' },
    })).toMatchObject({ state: 'failed', reason: 'Unavailable' });
  });
});

describe('sequence request lifecycle', () => {
  it('requests the active clip, ignores late frames, releases leases and follows retargets', async () => {
    const grok = new Grok(new GripRegistry());
    const linkTap = createAtomValueTap(DESKTOP_TAB_LINKS, { initial: links });
    const projectTap = createAtomValueTap(GVID_PROJECT_VIEW, { initial: project });
    const graphTap = createAtomValueTap(GVID_GRAPH_VIEW, { initial: graph });
    const sequenceTap = createAtomValueTap(GVID_SEQUENCE_VIEW, { initial: sequence });
    const bindingTap = createAtomValueTap(GVID_BINDING_VIEW, { initial: binding });
    const statusTap = createAtomValueTap(GVID_CHANGE_STATUS, { initial: { state: 'live' as const } });
    const assetTap = createAtomValueTap(GVID_ASSET_CATALOG, { initial: assets });
    const calls: Array<{
      key: SequenceFrameKey; clipId: string | null; assetName: string | null; signal: AbortSignal;
      resolve: (value: FrameResult<SequenceFrameKey>) => void;
    }> = [];
    const provider: FrameProvider = {
      source: async () => { throw new Error('unused'); },
      sequence: (key, clip, asset, signal) => new Promise((resolve) => {
        calls.push({ key, clipId: clip?.id ?? null, assetName: asset?.displayName ?? null, signal, resolve });
      }),
      release: vi.fn(),
    };
    const providerTap = createAtomValueTap(GVID_FRAME_PROVIDER, { initial: provider });
    for (const tap of [linkTap, projectTap, graphTap, sequenceTap, bindingTap, statusTap, assetTap, providerTap]) {
      grok.registerTap(tap);
    }
    const timeline = grok.mainPresentationContext.getOrCreateMatchingContext('tab:timeline');
    const selected = createAtomValueTap(GVID_DEST_SEQUENCE_ID, { initial: 'main' });
    const playhead = createAtomValueTap(GVID_DEST_TIMELINE_FRAME, { initial: 0 });
    timeline.getGripHomeContext().registerTap(selected);
    timeline.getGripHomeContext().registerTap(playhead);
    const viewer = grok.mainPresentationContext.getOrCreateMatchingContext('tab:viewer');
    const home = viewer.getGripHomeContext();
    const taps: Tap[] = sequenceTabTaps('viewer');
    for (const tap of taps) home.registerTap(tap);
    home.addParent(timeline.getGripHomeContext(), -1);
    grok.resolver.addParent(home, timeline.getGripHomeContext());
    const consumer = viewer.getGripConsumerContext();
    const destinationDrip = consumer.getOrCreateConsumer(GVID_SEQUENCE_DESTINATION);
    const resultDrip = consumer.getOrCreateConsumer(GVID_SEQUENCE_PREVIEW_RESULT);
    const presentationDrip = consumer.getOrCreateConsumer(GVID_SEQUENCE_PRESENTATION);
    for (const drip of [destinationDrip, resultDrip, presentationDrip]) drip.subscribe(() => {});
    grok.flush();
    await expect.poll(() => calls.length).toBe(1);
    expect(calls[0]).toMatchObject({ clipId: 'a', assetName: 'Lighthouse' });
    expect(calls[0].key.timelineFrame).toBe(0);

    playhead.set(48);
    grok.flush();
    await expect.poll(() => calls.length).toBe(2);
    expect(calls[0].signal.aborted).toBe(true);
    expect(calls[1]).toMatchObject({ clipId: 'b', assetName: 'Workshop' });
    calls[0].resolve({ key: calls[0].key, state: 'ready', fidelity: 'mock',
      resource: { kind: 'mock-png', leaseId: 'old', objectUrl: 'blob:old' } });
    await expect.poll(() => vi.mocked(provider.release).mock.calls.length).toBe(1);
    expect(provider.release).toHaveBeenCalledWith('old');
    expect(resultDrip.get()?.key.timelineFrame).toBe(48);

    calls[1].resolve({ key: calls[1].key, state: 'ready', fidelity: 'mock',
      composition: 'mock-topmost-track', resource: { kind: 'mock-png', leaseId: 'current', objectUrl: 'blob:current' } });
    await expect.poll(() => presentationDrip.get()?.state).toBe('current');
    expect(presentationDrip.get()?.resource).toMatchObject({ leaseId: 'current' });

    projectTap.set({ ...project, bindingSetId: 'bind-a2', bindingRevision: 2 });
    grok.flush();
    expect(provider.release).toHaveBeenCalledWith('current');
    bindingTap.set({ ...binding, bindingSetId: 'bind-a2', revision: 2 });
    grok.flush();
    await expect.poll(() => calls.length).toBe(3);
    expect(calls[2].key).toMatchObject({ timelineFrame: 48, bindingSetId: 'bind-a2', bindingRevision: 2 });
    calls[2].resolve({ key: calls[2].key, state: 'ready', fidelity: 'mock',
      resource: { kind: 'mock-png', leaseId: 'bound', objectUrl: 'blob:bound' } });
    await expect.poll(() => presentationDrip.get()?.state).toBe('current');

    projectTap.set({ ...project, projectId: 'mock-b', sessionId: 'session-b', bindingSetId: 'bind-b' });
    grok.flush();
    expect(provider.release).toHaveBeenCalledWith('bound');
    assetTap.set(assets.map((asset) => ({ ...asset,
      displayName: asset.id === 'workshop' ? 'Depot' : 'Harbour',
    })));
    bindingTap.set({ ...binding, bindingSetId: 'bind-b' });
    grok.flush();
    await expect.poll(() => calls.length).toBe(4);
    expect(calls[3].key).toMatchObject({ projectId: 'mock-b', sessionId: 'session-b', revision: 1 });
    expect(calls[3].assetName).toBe('Depot');
    calls[3].resolve({ key: calls[3].key, state: 'ready', fidelity: 'mock',
      resource: { kind: 'mock-png', leaseId: 'project-b', objectUrl: 'blob:b' } });
    await expect.poll(() => presentationDrip.get()?.state).toBe('current');

    linkTap.set([{ ...links[0] }, {
      tabId: 'viewer', toolId: GVID_TOOLS.sequence,
      params: { projectId: 'mock-b', sequenceId: 'main', timelineFrame: 96 },
    }]);
    grok.flush();
    await expect.poll(() => calls.length).toBe(5);
    expect(destinationDrip.get()).toMatchObject({ mode: 'standalone', timelineFrame: 96 });
    expect(calls[4].clipId).toBeNull();
    expect(provider.release).toHaveBeenCalledWith('project-b');
    calls[4].resolve({ key: calls[4].key, state: 'gap', fidelity: 'mock', composition: 'mock-topmost-track' });
    await expect.poll(() => presentationDrip.get()?.state).toBe('gap');

    linkTap.set([{ ...links[0] }, { ...links[1], sourceTabId: 'gone' }]);
    grok.flush();
    await expect.poll(() => destinationDrip.get()?.mode).toBe('unresolved');
    expect(resultDrip.get()).toBeNull();

    linkTap.set(links);
    grok.flush();
    await expect.poll(() => calls.length).toBe(6);
    const closing = calls[5];
    expect(closing.key.timelineFrame).toBe(48);
    for (const tap of taps) home.unregisterTap(tap);
    grok.flush();
    expect(closing.signal.aborted).toBe(true);
    closing.resolve({ key: closing.key, state: 'ready', fidelity: 'mock',
      resource: { kind: 'mock-png', leaseId: 'after-close', objectUrl: 'blob:late' } });
    await expect.poll(() => vi.mocked(provider.release).mock.calls.length).toBe(5);
    expect(provider.release).toHaveBeenCalledWith('after-close');
  });
});
