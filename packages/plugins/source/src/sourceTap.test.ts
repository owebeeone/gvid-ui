import { afterEach, describe, expect, it, vi } from 'vitest';
import { DESKTOP_TAB_LINKS, type DesktopTabLinkInfo } from '@grythjs/desktop';
import { createAtomValueTap, GripRegistry, Grok, type Grip } from '@owebeeone/grip-react';
import {
  GVID_ACTIVE_INSERT_TARGET, GVID_ASSET_CATALOG, GVID_BINDING_VIEW,
  GVID_CHANGE_STATUS, GVID_DEST_ASSET_ID, GVID_DEST_SOURCE_FRAME,
  GVID_EDIT_COMMAND, GVID_FRAME_PROVIDER, GVID_PROJECT_VIEW, GVID_SEQUENCE_VIEW,
  GVID_SOURCE_DESTINATION, GVID_SOURCE_FRAME_RESULT, GVID_SOURCE_MARKS,
  GVID_SOURCE_PRESENTATION, GVID_SOURCE_TRANSPORT, GVID_TOOLS,
  type AssetRecord, type EditorControl, type FrameProvider, type FrameResult,
  type InsertSourceSpan, type ProjectView, type SourceFrameKey,
} from '@gvidjs/contracts';
import { SOURCE_INSERT_STATE, SourceTabTap, sourceSpanFromMarks } from './sourceTap';

const lighthouse: AssetRecord = {
  id: 'lighthouse', displayName: 'Lighthouse', version: 'v1', fingerprint: 'light-1',
  streamId: 'video', frameCount: 120, width: 640, height: 360,
  frameRate: { num: 24, den: 1 }, status: 'ready',
};
const workshop: AssetRecord = {
  ...lighthouse, id: 'workshop', displayName: 'Workshop', fingerprint: 'work-1', frameCount: 90,
};
const project: ProjectView = {
  projectId: 'mock-a', sessionId: 'session-a', graphId: 'graph-a', revision: 4,
  bindingSetId: 'bindings-a', bindingRevision: 2, sessionOnly: true, status: 'ready',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function harness(sourceLink: DesktopTabLinkInfo = {
  tabId: 'source', toolId: GVID_TOOLS.source, params: {}, sourceTabId: 'assets',
}, wireAtStart = true, initialRevision = project.revision) {
  const grok = new Grok(new GripRegistry());
  const links = createAtomValueTap(DESKTOP_TAB_LINKS, { initial: [
    { tabId: 'assets', toolId: GVID_TOOLS.assets },
    { tabId: 'timeline', toolId: GVID_TOOLS.timeline },
    sourceLink,
  ] });
  const projectTap = createAtomValueTap(GVID_PROJECT_VIEW, {
    initial: { ...project, revision: initialRevision },
  });
  const catalog = createAtomValueTap(GVID_ASSET_CATALOG, { initial: [lighthouse, workshop] });
  const binding = createAtomValueTap(GVID_BINDING_VIEW, {
    initial: { bindingSetId: 'bindings-a', revision: 2, byAssetId: {} },
  });
  const change = createAtomValueTap(GVID_CHANGE_STATUS, { initial: { state: 'live' as const } });
  const target = createAtomValueTap(GVID_ACTIVE_INSERT_TARGET, { initial: null });
  const sequence = createAtomValueTap(GVID_SEQUENCE_VIEW, { initial: {
    id: 'main', graphId: 'graph-a', revision: initialRevision, frameRate: { num: 24, den: 1 },
    durationFrames: 96, tracks: [{ id: 'v1', label: 'Video', kind: 'video' as const, locked: false, clips: [] }],
  } });
  const insert = vi.fn(async () => ({
    status: 'accepted-session-only' as const, revision: 5, message: 'Inserted', commandId: 'cmd-1',
  }));
  const command = createAtomValueTap(GVID_EDIT_COMMAND, { initial: {
    insert, place: vi.fn(), addTrack: vi.fn(), deleteTrack: vi.fn(), moveClip: vi.fn(), trimClip: vi.fn(),
  } satisfies EditorControl });
  const requests: Array<{
    key: SourceFrameKey; asset: AssetRecord; signal: AbortSignal;
    reply: ReturnType<typeof deferred<FrameResult<SourceFrameKey>>>;
  }> = [];
  const release = vi.fn();
  const provider: FrameProvider = {
    source(key, asset, signal) {
      const reply = deferred<FrameResult<SourceFrameKey>>();
      requests.push({ key, asset, signal, reply });
      return reply.promise;
    },
    async sequence() { throw new Error('Not used by the source tab'); },
    release,
  };
  const providerTap = createAtomValueTap(GVID_FRAME_PROVIDER, { initial: provider });
  for (const tap of [links, projectTap, catalog, binding, change, target, sequence, command, providerTap]) {
    grok.registerTap(tap);
  }

  const assetsCtx = grok.mainPresentationContext.getOrCreateMatchingContext('tab:assets');
  const selected = createAtomValueTap(GVID_DEST_ASSET_ID, { initial: 'lighthouse' });
  grok.registerTapAt(assetsCtx, selected);
  const sourceCtx = grok.mainPresentationContext.getOrCreateMatchingContext('tab:source');
  const sourceHome = sourceCtx.getGripHomeContext();
  const assetsHome = assetsCtx.getGripHomeContext();
  const wire = () => {
    sourceHome.addParent(assetsHome, -1);
    grok.resolver.addParent(sourceHome, assetsHome);
    grok.flush();
  };
  if (wireAtStart) wire();
  const tap = new SourceTabTap('source');
  grok.registerTapAt(sourceCtx, tap);
  const read = <T>(grip: Grip<T>): T | undefined => {
    const drip = grok.query(grip, sourceCtx);
    grok.flush();
    return drip.get();
  };
  grok.flush();
  return {
    grok, tap, read, sourceCtx, links, projectTap, catalog, binding, change, target,
    sequence, command, selected, requests, release, insert, wire,
    close: () => grok.unregisterTap(tap),
  };
}

async function replyReady(h: ReturnType<typeof harness>, index: number, lease = `lease-${index}`) {
  const request = h.requests[index];
  request.reply.resolve({
    key: request.key, state: 'ready', fidelity: 'mock',
    resource: { kind: 'mock-png', leaseId: lease, objectUrl: `blob:${lease}` },
  });
  await Promise.resolve();
  h.grok.flush();
}

afterEach(() => { vi.useRealTimers(); });

describe('SourceTabTap', () => {
  it('uses a marked or partial source span, and defaults to the full asset', () => {
    expect(sourceSpanFromMarks(undefined, 90)).toEqual({ sourceIn: 0, sourceOut: 90 });
    expect(sourceSpanFromMarks({ inFrame: 12, outFrame: null, validity: 'pending' }, 90))
      .toEqual({ sourceIn: 12, sourceOut: 90 });
    expect(sourceSpanFromMarks({ inFrame: null, outFrame: 44, validity: 'pending' }, 90))
      .toEqual({ sourceIn: 0, sourceOut: 44 });
    expect(sourceSpanFromMarks({ inFrame: 12, outFrame: 44, validity: 'valid' }, 90))
      .toEqual({ sourceIn: 12, sourceOut: 44 });
    expect(sourceSpanFromMarks({ inFrame: 44, outFrame: 12, validity: 'invalid' }, 90)).toBeNull();
  });

  it('binds source marks to the selected asset rather than the timeline', () => {
    const h = harness();
    h.tap.seek(12);
    h.tap.setIn();
    h.tap.seek(40);
    h.tap.setOut();
    expect(h.read(GVID_SOURCE_MARKS)).toMatchObject({ inFrame: 12, outFrame: 41, validity: 'valid' });
    h.selected.set('workshop');
    h.grok.flush();
    expect(h.read(GVID_SOURCE_DESTINATION)?.assetId).toBe('workshop');
    expect(h.read(GVID_SOURCE_MARKS)).toMatchObject({ inFrame: null, outFrame: null, validity: 'unset' });
    h.close();
  });

  it('resolves the current library asset when the same tap reattaches after a hidden tab', () => {
    const h = harness();
    expect(h.read(GVID_SOURCE_DESTINATION)?.assetId).toBe('lighthouse');
    h.close();
    expect(h.requests[0].signal.aborted).toBe(true);
    h.selected.set('workshop');
    h.grok.registerTapAt(h.sourceCtx, h.tap);
    h.grok.flush();
    expect(h.read(GVID_SOURCE_DESTINATION)).toMatchObject({ mode: 'wired', assetId: 'workshop' });
    expect(h.requests[1].key.assetId).toBe('workshop');
    h.close();
  });

  it('resolves a library wire attached after the tab tap is created', () => {
    const h = harness(undefined, false);
    expect(h.read(GVID_SOURCE_DESTINATION)?.mode).toBe('unresolved');
    h.wire();
    expect(h.read(GVID_SOURCE_DESTINATION)).toMatchObject({ mode: 'wired', assetId: 'lighthouse', sourceFrame: 0 });
    expect(h.requests).toHaveLength(1);
    h.close();
  });

  it('follows a live asset tab, resets on source/version changes, and releases late replies', async () => {
    const h = harness();
    expect(h.read(GVID_SOURCE_DESTINATION)).toMatchObject({
      viewerId: 'source', mode: 'wired', assetId: 'lighthouse', sourceFrame: 0,
    });
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0].key).toMatchObject({
      viewerId: 'source', projectId: 'mock-a', sessionId: 'session-a',
      revision: 4,
      assetId: 'lighthouse', assetVersion: 'v1', fingerprint: 'light-1',
      streamId: 'video', sourceFrame: 0, sourcePts: { num: 0, den: 1 },
    });
    await replyReady(h, 0);
    expect(h.read(GVID_SOURCE_PRESENTATION)).toMatchObject({ state: 'current', fidelity: 'mock' });
    h.tap.seek(24);
    expect(h.requests[1].key.sourcePts).toEqual({ num: 1, den: 1 });
    expect(h.read(GVID_SOURCE_PRESENTATION)?.state).toBe('stale');
    h.tap.setIn();
    h.tap.setOut();
    h.tap.play();
    expect(h.read(GVID_SOURCE_TRANSPORT)?.playing).toBe(true);

    h.selected.set('workshop');
    h.grok.flush();
    expect(h.requests[1].signal.aborted).toBe(true);
    expect(h.read(GVID_DEST_SOURCE_FRAME)).toBe(0);
    expect(h.read(GVID_SOURCE_MARKS)?.validity).toBe('unset');
    expect(h.read(GVID_SOURCE_TRANSPORT)?.playing).toBe(false);
    expect(h.read(GVID_SOURCE_PRESENTATION)?.resource).toBeUndefined();
    expect(h.release).toHaveBeenCalledWith('lease-0');
    expect(h.requests[2].key.assetId).toBe('workshop');
    await replyReady(h, 1, 'late-lease');
    expect(h.release).toHaveBeenCalledWith('late-lease');
    expect(h.read(GVID_SOURCE_PRESENTATION)?.state).toBe('pending');
    await replyReady(h, 2);
    expect(h.read(GVID_SOURCE_PRESENTATION)?.key?.assetId).toBe('workshop');

    h.catalog.set([lighthouse, { ...workshop, version: 'v2', fingerprint: 'work-2' }]);
    h.grok.flush();
    expect(h.read(GVID_SOURCE_PRESENTATION)?.resource).toBeUndefined();
    expect(h.release).toHaveBeenCalledWith('lease-2');
    expect(h.requests[3].key.assetVersion).toBe('v2');
    h.close();
    await replyReady(h, 3, 'closed-lease');
    expect(h.release).toHaveBeenCalledWith('closed-lease');
  });

  it('releases pending revision-1 replies across Insert and Undo at the same cursor', async () => {
    const h = harness(undefined, true, 1);
    h.tap.setIn();
    h.tap.setOut();
    const marks = h.read(GVID_SOURCE_MARKS);
    expect(h.requests[0].key).toMatchObject({ revision: 1, sourceFrame: 0 });

    h.projectTap.set({ ...project, revision: 2 });
    h.grok.flush();
    expect(h.requests[0].signal.aborted).toBe(true);
    expect(h.requests[1].key).toMatchObject({ revision: 2, sourceFrame: 0 });
    expect(h.requests[1].key.cancelGroupId).not.toBe(h.requests[0].key.cancelGroupId);
    expect(h.read(GVID_SOURCE_MARKS)).toEqual(marks);
    await replyReady(h, 0, 'late-insert');
    expect(h.release).toHaveBeenCalledWith('late-insert');
    expect(h.read(GVID_SOURCE_PRESENTATION)).toMatchObject({ state: 'pending', key: { revision: 2 } });

    h.projectTap.set({ ...project, revision: 3 });
    h.grok.flush();
    expect(h.requests[1].signal.aborted).toBe(true);
    expect(h.requests[2].key).toMatchObject({ revision: 3, sourceFrame: 0 });
    expect(h.read(GVID_SOURCE_MARKS)).toEqual(marks);
    await replyReady(h, 1, 'late-undo');
    expect(h.release).toHaveBeenCalledWith('late-undo');
    expect(h.read(GVID_SOURCE_PRESENTATION)).toMatchObject({ state: 'pending', key: { revision: 3 } });
    await replyReady(h, 2, 'current-undo');
    expect(h.read(GVID_SOURCE_PRESENTATION)).toMatchObject({ state: 'current', key: { revision: 3 } });
    expect(h.read(GVID_SOURCE_FRAME_RESULT)).toMatchObject({ state: 'ready', key: { revision: 3 } });
    h.close();
  });

  it('releases already-current revision-1 frames across Insert and Undo', async () => {
    const h = harness(undefined, true, 1);
    h.tap.setIn();
    h.tap.setOut();
    const marks = h.read(GVID_SOURCE_MARKS);
    await replyReady(h, 0, 'displayed-1');
    expect(h.read(GVID_SOURCE_PRESENTATION)).toMatchObject({ state: 'current', key: { revision: 1 } });

    h.projectTap.set({ ...project, revision: 2 });
    h.grok.flush();
    expect(h.release).toHaveBeenCalledWith('displayed-1');
    expect(h.read(GVID_SOURCE_PRESENTATION)).toMatchObject({ state: 'pending', key: { revision: 2 } });
    expect(h.read(GVID_SOURCE_PRESENTATION)?.resource).toBeUndefined();
    expect(h.read(GVID_SOURCE_MARKS)).toEqual(marks);
    await replyReady(h, 1, 'displayed-2');
    expect(h.read(GVID_SOURCE_PRESENTATION)).toMatchObject({ state: 'current', key: { revision: 2 } });

    h.projectTap.set({ ...project, revision: 3 });
    h.grok.flush();
    expect(h.release).toHaveBeenCalledWith('displayed-2');
    expect(h.read(GVID_SOURCE_PRESENTATION)).toMatchObject({ state: 'pending', key: { revision: 3 } });
    expect(h.read(GVID_SOURCE_PRESENTATION)?.resource).toBeUndefined();
    expect(h.read(GVID_SOURCE_MARKS)).toEqual(marks);
    await replyReady(h, 2, 'displayed-3');
    expect(h.read(GVID_SOURCE_PRESENTATION)).toMatchObject({ state: 'current', key: { revision: 3 } });
    h.close();
  });

  it('uses standalone link params and rejects missing or invalid wire parents and frames', () => {
    const h = harness({
      tabId: 'source', toolId: GVID_TOOLS.source,
      params: { projectId: 'mock-a', assetId: 'workshop', frame: 5 },
    });
    expect(h.read(GVID_SOURCE_DESTINATION)).toMatchObject({ mode: 'standalone', assetId: 'workshop', sourceFrame: 5 });
    expect(h.requests[0].key.sourcePts).toEqual({ num: 5, den: 24 });
    h.selected.set('lighthouse');
    h.grok.flush();
    expect(h.read(GVID_SOURCE_DESTINATION)?.assetId).toBe('workshop');

    h.links.set([
      { tabId: 'assets', toolId: GVID_TOOLS.assets },
      { tabId: 'source', toolId: GVID_TOOLS.source, params: { projectId: 'mock-a', assetId: 'workshop', frame: 90 } },
    ]);
    h.grok.flush();
    expect(h.read(GVID_SOURCE_DESTINATION)).toMatchObject({ mode: 'unresolved', reason: 'Source link frame is outside this asset.' });
    expect(h.read(GVID_SOURCE_PRESENTATION)?.resource).toBeUndefined();

    h.links.set([{ tabId: 'source', toolId: GVID_TOOLS.source, sourceTabId: 'missing' }]);
    h.grok.flush();
    expect(h.read(GVID_SOURCE_DESTINATION)).toMatchObject({ mode: 'unresolved', reason: 'Linked media library tab is unavailable.' });
    h.close();
  });

  it('keeps half-open bounds and sends a typed insert to the explicit root target', async () => {
    const h = harness();
    h.tap.seek(12);
    h.tap.setIn();
    h.tap.seek(23);
    h.tap.setOut();
    expect(h.read(GVID_SOURCE_MARKS)).toMatchObject({ inFrame: 12, outFrame: 24, validity: 'valid' });
    expect(h.read(SOURCE_INSERT_STATE)?.disabledReason).toContain('insertion track');
    h.target.set({ projectId: 'mock-a', graphId: 'graph-a', sequenceId: 'main',
      trackId: 'v1', frame: 24, ownerTabId: 'timeline' });
    h.grok.flush();
    expect(h.read(SOURCE_INSERT_STATE)?.disabledReason).toBeUndefined();
    await h.tap.addSelection();
    expect(h.insert).toHaveBeenCalledWith({
      projectId: 'mock-a', sessionId: 'session-a', expectedRevision: 4,
      bindingSetId: 'bindings-a', assetId: 'lighthouse', assetVersion: 'v1',
      sourceIn: 12, sourceOut: 24,
      target: { projectId: 'mock-a', graphId: 'graph-a', sequenceId: 'main',
        trackId: 'v1', frame: 24, ownerTabId: 'timeline' },
    } satisfies InsertSourceSpan);
    expect(h.read(SOURCE_INSERT_STATE)?.message).toBe('Inserted');
    h.tap.seek(119);
    h.tap.setOut();
    expect(h.read(GVID_SOURCE_MARKS)?.outFrame).toBe(120);
    h.tap.play();
    expect(h.read(GVID_SOURCE_TRANSPORT)?.playing).toBe(true);
    h.tap.pause();
    h.tap.seek(24);
    h.tap.setIn();
    expect(h.read(GVID_SOURCE_MARKS)?.validity).toBe('valid');
    h.tap.clear();
    expect(h.read(GVID_SOURCE_MARKS)?.validity).toBe('unset');
    h.close();
  });

  it('stops at exclusive Out and never requests frameCount', () => {
    vi.useFakeTimers();
    const h = harness();
    h.tap.seek(2);
    h.tap.setIn();
    h.tap.seek(3);
    h.tap.setOut();
    h.tap.seek(0);
    h.tap.play();
    expect(h.read(GVID_DEST_SOURCE_FRAME)).toBe(2);
    vi.advanceTimersByTime(50);
    expect(h.read(GVID_DEST_SOURCE_FRAME)).toBe(3);
    vi.advanceTimersByTime(50);
    expect(h.read(GVID_DEST_SOURCE_FRAME)).toBe(3);
    expect(h.read(GVID_SOURCE_TRANSPORT)?.playing).toBe(false);
    expect(h.requests.every((request) => request.key.sourceFrame < lighthouse.frameCount)).toBe(true);
    h.close();
  });

  it('steps one or ten frames and clamps at either source edge', () => {
    const h = harness();
    h.tap.step(1);
    expect(h.read(GVID_DEST_SOURCE_FRAME)).toBe(1);
    h.tap.step(10);
    expect(h.read(GVID_DEST_SOURCE_FRAME)).toBe(11);
    h.tap.step(-10);
    expect(h.read(GVID_DEST_SOURCE_FRAME)).toBe(1);
    h.tap.step(-10);
    expect(h.read(GVID_DEST_SOURCE_FRAME)).toBe(0);
    h.tap.seek(117);
    h.tap.step(10);
    expect(h.read(GVID_DEST_SOURCE_FRAME)).toBe(119);
    h.close();
  });

  it('pauses playback when seeking outside the marked range', () => {
    vi.useFakeTimers();
    const h = harness();
    h.tap.seek(10);
    h.tap.setIn();
    h.tap.seek(11);
    h.tap.setOut();
    h.tap.play();
    expect(h.read(GVID_SOURCE_TRANSPORT)?.playing).toBe(true);
    h.tap.seek(25);
    expect(h.read(GVID_SOURCE_TRANSPORT)?.playing).toBe(false);
    vi.advanceTimersByTime(100);
    expect(h.read(GVID_DEST_SOURCE_FRAME)).toBe(25);
    h.close();
  });

  it('drops wrong-key results and pauses on project loss', async () => {
    const h = harness();
    const request = h.requests[0];
    request.reply.resolve({
      key: { ...request.key, fingerprint: 'foreign' }, state: 'ready', fidelity: 'mock',
      resource: { kind: 'mock-png', leaseId: 'wrong-key', objectUrl: 'blob:wrong-key' },
    });
    await Promise.resolve();
    h.grok.flush();
    expect(h.release).toHaveBeenCalledWith('wrong-key');
    expect(h.read(GVID_SOURCE_FRAME_RESULT)?.key.fingerprint).not.toBe('foreign');
    expect(h.read(GVID_SOURCE_PRESENTATION)?.state).not.toBe('current');
    h.tap.play();
    h.projectTap.set({ ...project, projectId: null, status: 'closed' });
    h.grok.flush();
    expect(h.read(GVID_SOURCE_DESTINATION)?.mode).toBe('unresolved');
    expect(h.read(GVID_SOURCE_TRANSPORT)?.playing).toBe(false);
    expect(h.read(GVID_SOURCE_PRESENTATION)?.resource).toBeUndefined();
    h.close();
  });
});
