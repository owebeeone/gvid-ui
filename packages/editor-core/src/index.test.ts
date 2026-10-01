import { describe, expect, it } from 'vitest';
import { DESKTOP_TAB_LINKS, registry } from '@grythjs/plugin-api';
import { createAtomValueTap, Grok, type Grip } from '@owebeeone/grip-react';
import {
  GVID_ACTIVE_INSERT_TARGET, GVID_ACTIVE_INSERT_TARGET_CONTROL, GVID_ASSET_CATALOG,
  GVID_BINDING_VIEW, GVID_CHANGE_STATUS, GVID_DEST_PROJECT_ID, GVID_EDIT_COMMAND,
  GVID_EDIT_RESULT, GVID_GRAPH_VIEW, GVID_HISTORY_CONTROL, GVID_HISTORY_VIEW,
  GVID_PROJECT_CONTROL, GVID_PROJECT_VIEW, GVID_SEQUENCE_VIEW,
  type InsertSourceSpan, type InsertTarget,
} from '@gvidjs/contracts';
import { registerMockTaps } from './index';

function setup(withLinks = false) {
  const grok = new Grok(registry);
  const links = createAtomValueTap(DESKTOP_TAB_LINKS, {
    initial: [{ tabId: 'timeline-1', toolId: 'gvid.timeline' }],
  });
  if (withLinks) grok.registerTap(links);
  registerMockTaps(grok);
  const get = <T>(grip: Grip<T>): T => {
    const value = grok.query(grip, grok.mainContext).get();
    if (value === undefined) throw new Error(`Missing Grip: ${grip.name}`);
    return value;
  };
  const target = (frame: number, ownerTabId = 'timeline-1'): InsertTarget => {
    const project = get(GVID_PROJECT_VIEW);
    const graph = get(GVID_GRAPH_VIEW);
    return {
      projectId: project.projectId!, graphId: graph.graphId,
      sequenceId: graph.sequence.id, trackId: 'v1', frame, ownerTabId,
    };
  };
  const intent = (selection: InsertTarget, overrides: Partial<InsertSourceSpan> = {}): InsertSourceSpan => {
    const project = get(GVID_PROJECT_VIEW);
    return {
      projectId: project.projectId!, sessionId: project.sessionId,
      expectedRevision: project.revision, bindingSetId: project.bindingSetId,
      assetId: 'workshop', assetVersion: 'v1', sourceIn: 0, sourceOut: 24,
      target: selection, ...overrides,
    };
  };
  return { grok, get, target, intent, links };
}

function ranges(clips: readonly { assetId: string; sourceIn: number; sourceOut: number; timelineIn: number; timelineOut: number }[]) {
  return clips.map(({ assetId, sourceIn, sourceOut, timelineIn, timelineOut }) =>
    [assetId, sourceIn, sourceOut, timelineIn, timelineOut]);
}

describe('mock editor root Grips', () => {
  it('publishes the named session-only fixture and a single root producer per owned Grip', () => {
    const { grok, get } = setup();
    const project = get(GVID_PROJECT_VIEW);
    const graph = get(GVID_GRAPH_VIEW);
    expect(project).toMatchObject({
      projectId: 'mock-a', graphId: 'mock-a/main', revision: 1,
      bindingRevision: 1, sessionOnly: true, status: 'ready',
    });
    expect(get(GVID_DEST_PROJECT_ID)).toBe('mock-a');
    expect(get(GVID_CHANGE_STATUS)).toEqual({ state: 'live' });
    expect(get(GVID_SEQUENCE_VIEW)).toBe(graph.sequence);
    expect(graph.sequence).toMatchObject({
      id: 'main', revision: 1, frameRate: { num: 24, den: 1 }, durationFrames: 96,
    });
    expect(ranges(graph.sequence.tracks[0].clips)).toEqual([
      ['lighthouse', 12, 60, 0, 48], ['workshop', 5, 53, 48, 96],
    ]);
    expect(graph.sequence.tracks[0]).toMatchObject({ id: 'v1', locked: false });
    expect(get(GVID_ASSET_CATALOG)).toMatchObject([
      { id: 'lighthouse', displayName: 'Lighthouse', version: 'v1', frameCount: 120, width: 640, height: 360 },
      { id: 'workshop', displayName: 'Workshop', version: 'v1', frameCount: 90, width: 640, height: 360 },
    ]);
    expect(get(GVID_BINDING_VIEW)).toMatchObject({
      bindingSetId: 'mock-a/bindings', revision: 1,
      byAssetId: { lighthouse: 'lighthouse/video-0', workshop: 'workshop/video-0' },
    });
    expect(get(GVID_HISTORY_VIEW)).toMatchObject({ revision: 1, canUndo: false, canRedo: false });
    expect(get(GVID_EDIT_RESULT)).toBeNull();
    const owned = [
      GVID_DEST_PROJECT_ID, GVID_PROJECT_VIEW, GVID_PROJECT_CONTROL, GVID_GRAPH_VIEW,
      GVID_SEQUENCE_VIEW, GVID_CHANGE_STATUS, GVID_ASSET_CATALOG, GVID_BINDING_VIEW,
      GVID_ACTIVE_INSERT_TARGET, GVID_ACTIVE_INSERT_TARGET_CONTROL, GVID_EDIT_COMMAND,
      GVID_EDIT_RESULT, GVID_HISTORY_VIEW, GVID_HISTORY_CONTROL,
    ];
    const root = grok.mainHomeContext._getContextNode();
    const producers = owned.map((grip) => root.get_producers().get(grip));
    expect(producers.every(Boolean)).toBe(true);
    expect(new Set(producers).size).toBe(1);
  });

  it('splits at frame 24 and publishes the accepted graph before the promise resolves', async () => {
    const { get, target, intent } = setup();
    const at24 = target(24);
    get(GVID_ACTIVE_INSERT_TARGET_CONTROL).set(at24);
    const pending = get(GVID_EDIT_COMMAND).insert(intent(at24));
    expect(get(GVID_GRAPH_VIEW).revision).toBe(2);
    expect(get(GVID_PROJECT_VIEW).revision).toBe(2);
    expect(get(GVID_SEQUENCE_VIEW).revision).toBe(2);
    expect(get(GVID_HISTORY_VIEW)).toMatchObject({ revision: 2, canUndo: true, canRedo: false });
    const result = await pending;
    expect(result).toMatchObject({ status: 'accepted-session-only', revision: 2 });
    expect(get(GVID_EDIT_RESULT)).toBe(result);
    const clips = get(GVID_SEQUENCE_VIEW).tracks[0].clips;
    expect(ranges(clips)).toEqual([
      ['lighthouse', 12, 36, 0, 24],
      ['workshop', 0, 24, 24, 48],
      ['lighthouse', 36, 60, 48, 72],
      ['workshop', 5, 53, 72, 120],
    ]);
    expect(clips[0].id).toBe('clip-a');
    expect(new Set(clips.map((clip) => clip.id)).size).toBe(4);
    expect(get(GVID_SEQUENCE_VIEW).durationFrames).toBe(120);
  });

  it('appends at the sequence end without splitting', async () => {
    const { get, target, intent } = setup();
    const end = target(96);
    get(GVID_ACTIVE_INSERT_TARGET_CONTROL).set(end);
    expect((await get(GVID_EDIT_COMMAND).insert(intent(end))).status).toBe('accepted-session-only');
    expect(ranges(get(GVID_SEQUENCE_VIEW).tracks[0].clips)).toEqual([
      ['lighthouse', 12, 60, 0, 48],
      ['workshop', 5, 53, 48, 96],
      ['workshop', 0, 24, 96, 120],
    ]);
  });

  it('rejects stale and invalid intents without changing accepted graph or history', async () => {
    const { get, target, intent } = setup();
    const at24 = target(24);
    const original = get(GVID_GRAPH_VIEW);
    const command = get(GVID_EDIT_COMMAND);
    const absent = await command.insert(intent(at24));
    expect(absent).toMatchObject({ status: 'rejected', revision: 1 });
    get(GVID_ACTIVE_INSERT_TARGET_CONTROL).set(at24);
    const cases: Partial<InsertSourceSpan>[] = [
      { sessionId: 'old-session' }, { expectedRevision: 0 },
      { bindingSetId: 'old-bindings' }, { assetVersion: 'v2' },
      { sourceIn: -1 }, { sourceIn: 24, sourceOut: 24 }, { sourceOut: 91 },
      { sourceIn: 0.5 }, { target: { ...at24, frame: 48 } },
    ];
    for (const fields of cases) {
      const result = await command.insert(intent(at24, fields));
      expect(result.status).toBe('rejected');
      expect(result.message).not.toBe('');
      expect(get(GVID_GRAPH_VIEW)).toBe(original);
      expect(get(GVID_HISTORY_VIEW)).toMatchObject({ revision: 1, canUndo: false });
    }
    expect(new Set([absent.commandId, get(GVID_EDIT_RESULT)!.commandId]).size).toBe(2);
  });

  it('uses fresh revisions for Undo/Redo and drops redo after a new edit', async () => {
    const { get, target, intent } = setup();
    const control = get(GVID_EDIT_COMMAND);
    const history = get(GVID_HISTORY_CONTROL);
    const at24 = target(24);
    get(GVID_ACTIVE_INSERT_TARGET_CONTROL).set(at24);
    await control.insert(intent(at24));
    const first = get(GVID_SEQUENCE_VIEW);
    await control.insert(intent(at24));
    const second = get(GVID_SEQUENCE_VIEW);
    expect(second.revision).toBe(3);
    expect(second.durationFrames).toBe(144);
    expect((await history.undo()).revision).toBe(4);
    expect(get(GVID_SEQUENCE_VIEW)).toMatchObject({ revision: 4, durationFrames: first.durationFrames });
    expect(get(GVID_HISTORY_VIEW)).toMatchObject({ revision: 4, canUndo: true, canRedo: true });
    expect((await history.redo()).revision).toBe(5);
    expect(get(GVID_SEQUENCE_VIEW)).toMatchObject({ revision: 5, durationFrames: second.durationFrames });
    expect((await history.undo()).revision).toBe(6);
    expect((await control.insert(intent(at24))).revision).toBe(7);
    expect(get(GVID_HISTORY_VIEW)).toMatchObject({ revision: 7, canUndo: true, canRedo: false });
    expect((await history.redo()).status).toBe('rejected');
    expect(get(GVID_GRAPH_VIEW).revision).toBe(7);
  });

  it('guards explicit target ownership and resets identity on project switch and close', async () => {
    const { get, target, intent } = setup();
    const projectControl = get(GVID_PROJECT_CONTROL);
    const targetControl = get(GVID_ACTIVE_INSERT_TARGET_CONTROL);
    const at24 = target(24);
    targetControl.set(at24);
    targetControl.clear('other-tab');
    expect(get(GVID_ACTIVE_INSERT_TARGET)).toEqual(at24);
    targetControl.clear(at24.ownerTabId);
    expect(get(GVID_ACTIVE_INSERT_TARGET)).toBeNull();
    targetControl.set({ ...at24, frame: 97 });
    expect(get(GVID_ACTIVE_INSERT_TARGET)).toBeNull();
    targetControl.set(at24);
    const stale = intent(at24);
    const oldSession = get(GVID_PROJECT_VIEW).sessionId;
    const oldAsset = get(GVID_ASSET_CATALOG)[0];
    projectControl.open('mock-b');
    expect(get(GVID_PROJECT_VIEW)).toMatchObject({ projectId: 'mock-b', revision: 1, sessionOnly: true });
    expect(get(GVID_PROJECT_VIEW).sessionId).not.toBe(oldSession);
    expect(get(GVID_ACTIVE_INSERT_TARGET)).toBeNull();
    expect(get(GVID_HISTORY_VIEW).canUndo).toBe(false);
    expect(get(GVID_ASSET_CATALOG)[0]).toMatchObject({ id: oldAsset.id, version: oldAsset.version });
    expect(get(GVID_ASSET_CATALOG)[0].displayName).not.toBe(oldAsset.displayName);
    expect(get(GVID_ASSET_CATALOG)[0].fingerprint).not.toBe(oldAsset.fingerprint);
    expect((await get(GVID_EDIT_COMMAND).insert(stale)).status).toBe('rejected');
    projectControl.close();
    expect(get(GVID_DEST_PROJECT_ID)).toBeNull();
    expect(get(GVID_CHANGE_STATUS)).toEqual({ state: 'closed' });
    expect(get(GVID_ASSET_CATALOG)).toEqual([]);
    expect(get(GVID_SEQUENCE_VIEW).durationFrames).toBe(0);
    expect(get(GVID_HISTORY_VIEW)).toMatchObject({ revision: 0, canUndo: false, canRedo: false });
    expect(() => projectControl.open('unknown')).toThrow(RangeError);
    expect(get(GVID_DEST_PROJECT_ID)).toBeNull();
    projectControl.open('mock-a');
    expect(get(GVID_PROJECT_VIEW).sessionId).not.toBe(oldSession);
    expect(get(GVID_GRAPH_VIEW).revision).toBe(1);
  });

  it('clears the active target when its desktop owner tab closes', () => {
    const { grok, get, target, links } = setup(true);
    const at24 = target(24);
    get(GVID_ACTIVE_INSERT_TARGET_CONTROL).set(at24);
    expect(get(GVID_ACTIVE_INSERT_TARGET)).toEqual(at24);
    expect(get(DESKTOP_TAB_LINKS)).toEqual([{ tabId: 'timeline-1', toolId: 'gvid.timeline' }]);
    links.set([]);
    grok.flush();
    expect(get(DESKTOP_TAB_LINKS)).toEqual([]);
    expect(get(GVID_ACTIVE_INSERT_TARGET)).toBeNull();
    get(GVID_ACTIVE_INSERT_TARGET_CONTROL).set(at24);
    expect(get(GVID_ACTIVE_INSERT_TARGET)).toBeNull();
  });

  it('observes desktop tab links registered after the mock root tap', () => {
    const { grok, get, target, links } = setup();
    grok.registerTap(links);
    grok.flush();
    const at24 = target(24);
    get(GVID_ACTIVE_INSERT_TARGET_CONTROL).set(at24);
    expect(get(GVID_ACTIVE_INSERT_TARGET)).toEqual(at24);
    links.set([]);
    grok.flush();
    expect(get(GVID_ACTIVE_INSERT_TARGET)).toBeNull();
  });
});
