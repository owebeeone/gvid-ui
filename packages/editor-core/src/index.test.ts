import { describe, expect, it } from 'vitest';
import { DESKTOP_TAB_LINKS, registry } from '@grythjs/plugin-api';
import { createAtomValueTap, Grok, type Grip } from '@owebeeone/grip-react';
import {
  GVID_ACTIVE_INSERT_TARGET, GVID_ACTIVE_INSERT_TARGET_CONTROL, GVID_ASSET_CATALOG,
  GVID_BINDING_VIEW, GVID_CHANGE_STATUS, GVID_DEST_PROJECT_ID, GVID_EDIT_COMMAND,
  GVID_EDIT_RESULT, GVID_EFFECT_PROFILES, GVID_GRAPH_VIEW, GVID_HISTORY_CONTROL, GVID_HISTORY_VIEW,
  GVID_PROJECT_CONTROL, GVID_PROJECT_VIEW, GVID_SEQUENCE_VIEW, GVID_SOURCE_MARKER_CATALOG,
  NEUTRAL_EFFECTS, evaluateClipEffects,
  type InsertSourceSpan, type InsertTarget, type PlaceSourceSpan, type TimelineEditScope,
} from '@gvidjs/contracts';
import { registerMockTaps, rippleDeleteSpan } from './index';

function setup(withLinks = true) {
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
  const scope = (): TimelineEditScope => {
    const project = get(GVID_PROJECT_VIEW);
    return { projectId: project.projectId!, sessionId: project.sessionId,
      expectedRevision: project.revision, sequenceId: get(GVID_SEQUENCE_VIEW).id };
  };
  const sourceScope = (assetId = 'workshop') => {
    const project = get(GVID_PROJECT_VIEW);
    const asset = get(GVID_ASSET_CATALOG).find((item) => item.id === assetId)!;
    return { projectId: project.projectId!, sessionId: project.sessionId,
      expectedRevision: project.revision, assetId, assetVersion: asset.version,
      fingerprint: asset.fingerprint };
  };
  const placeIntent = (selection: InsertTarget, overrides: Partial<PlaceSourceSpan> = {}): PlaceSourceSpan => ({
    ...intent(selection), ...scope(), ...overrides,
  });
  return { grok, get, target, intent, scope, sourceScope, placeIntent, links };
}

function ranges(clips: readonly { assetId: string; sourceIn: number; sourceOut: number; timelineIn: number; timelineOut: number }[]) {
  return clips.map(({ assetId, sourceIn, sourceOut, timelineIn, timelineOut }) =>
    [assetId, sourceIn, sourceOut, timelineIn, timelineOut]);
}

function expectLinkedPair(get: <T>(grip: Grip<T>) => T, number: number): void {
  const sequence = get(GVID_SEQUENCE_VIEW);
  const video = sequence.tracks.find((track) => track.id === `v${number}`)!;
  const audio = sequence.tracks.find((track) => track.id === `a${number}`)!;
  expect(video.kind).toBe('video');
  expect(audio.kind).toBe('audio');
  for (const clip of video.clips) {
    const asset = get(GVID_ASSET_CATALOG).find((item) => item.id === clip.assetId)!;
    const partner = audio.clips.find((item) => item.id === clip.linkedClipId);
    if (!asset.hasAudio) {
      expect(partner).toBeUndefined();
      continue;
    }
    expect(partner).toMatchObject({ linkedClipId: clip.id, assetId: clip.assetId,
      sourceIn: clip.sourceIn, sourceOut: clip.sourceOut,
      timelineIn: clip.timelineIn, timelineOut: clip.timelineOut });
    expect(partner?.markers).toEqual(clip.markers);
    expect(partner?.keyframes).toEqual(clip.keyframes);
  }
  expect(audio.clips).toHaveLength(video.clips.filter((clip) =>
    get(GVID_ASSET_CATALOG).find((asset) => asset.id === clip.assetId)?.hasAudio).length);
}

describe('mock editor root Grips', () => {
  it('adds clip keyframes through either linked track and restores them through history', async () => {
    const { get, scope } = setup();
    const edit = get(GVID_EDIT_COMMAND);
    const video = () => ({ ...scope(), trackId: 'v1', clipId: 'clip-a' });
    expect((await edit.addClipKeyframe({ ...video(), frame: 48 })).status).toBe('rejected');
    expect((await edit.addClipKeyframe({ ...video(), frame: 10 })).status).toBe('accepted-session-only');
    const keyframe = get(GVID_SEQUENCE_VIEW).tracks[0].clips[0].keyframes?.[0];
    expect(keyframe).toMatchObject({ sourceFrame: 22 });
    expect((await edit.addClipKeyframe({ ...video(), frame: 10 })).status).toBe('rejected');
    expect((await edit.addClipKeyframe({ ...scope(), trackId: 'a1', clipId: 'audio-clip-a', frame: 30 })).status)
      .toBe('accepted-session-only');
    expect(get(GVID_SEQUENCE_VIEW).tracks[0].clips[0].keyframes?.map((item) => item.sourceFrame)).toEqual([22, 42]);
    expectLinkedPair(get, 1);
    await get(GVID_HISTORY_CONTROL).undo();
    expect(get(GVID_SEQUENCE_VIEW).tracks[0].clips[0].keyframes).toHaveLength(1);
    await get(GVID_HISTORY_CONTROL).undo();
    expect(get(GVID_SEQUENCE_VIEW).tracks[0].clips[0].keyframes).toBeUndefined();
    await get(GVID_HISTORY_CONTROL).redo();
    await get(GVID_HISTORY_CONTROL).redo();
    expect(get(GVID_SEQUENCE_VIEW).tracks[0].clips[0].keyframes).toHaveLength(2);
  });

  it('deletes one linked keyframe by id and restores it through history', async () => {
    const { get, scope } = setup();
    const edit = get(GVID_EDIT_COMMAND);
    const video = () => ({ ...scope(), trackId: 'v1', clipId: 'clip-a' });
    const stale = video();
    await edit.addClipKeyframe({ ...video(), frame: 10 });
    await edit.addClipKeyframe({ ...video(), frame: 30 });
    const keyframes = get(GVID_SEQUENCE_VIEW).tracks[0].clips[0].keyframes!;
    const audio = () => ({ ...scope(), trackId: 'a1', clipId: 'audio-clip-a' });
    expect((await edit.deleteClipKeyframe({ ...stale, keyframeId: keyframes[0].id })).status).toBe('rejected');
    expect((await edit.deleteClipKeyframe({ ...audio(), keyframeId: 'missing' })).status).toBe('rejected');
    expect((await edit.deleteClipKeyframe({ ...audio(), keyframeId: keyframes[0].id })).status)
      .toBe('accepted-session-only');
    expect(get(GVID_SEQUENCE_VIEW).tracks[0].clips[0].keyframes?.map((item) => item.sourceFrame)).toEqual([42]);
    expectLinkedPair(get, 1);
    expect(get(GVID_HISTORY_VIEW).undoLabel).toBe('Delete clip keyframe');
    await get(GVID_HISTORY_CONTROL).undo();
    expect(get(GVID_SEQUENCE_VIEW).tracks[0].clips[0].keyframes?.map((item) => item.sourceFrame)).toEqual([22, 42]);
    await get(GVID_HISTORY_CONTROL).redo();
    expect(get(GVID_SEQUENCE_VIEW).tracks[0].clips[0].keyframes?.map((item) => item.sourceFrame)).toEqual([42]);
    expect((await edit.deleteClipKeyframe({ ...video(), keyframeId: keyframes[1].id })).status)
      .toBe('accepted-session-only');
    expect(get(GVID_SEQUENCE_VIEW).tracks[0].clips[0].keyframes).toEqual([]);
    expectLinkedPair(get, 1);
  });

  it('edits base and keyed effects, saves a profile, and applies it as one undoable edit', async () => {
    const { get, scope } = setup();
    const edit = get(GVID_EDIT_COMMAND);
    const source = () => ({ ...scope(), trackId: 'v1', clipId: 'clip-a' });
    const base = { ...NEUTRAL_EFFECTS, alpha: 0.5, gradeR: 0.7 };
    expect((await edit.setClipEffects({ ...source(), keyframeId: null, effects: base })).status)
      .toBe('accepted-session-only');
    expect(get(GVID_SEQUENCE_VIEW).tracks[0].clips[0].effects).toEqual(base);
    await edit.addClipKeyframe({ ...source(), frame: 10 });
    const first = get(GVID_SEQUENCE_VIEW).tracks[0].clips[0].keyframes![0];
    expect(first.effects).toEqual(base);
    const keyed = { ...base, alpha: 0.25, moveX: 40, rotateDeg: 15 };
    expect((await edit.setClipEffects({ ...scope(), trackId: 'a1', clipId: 'audio-clip-a',
      keyframeId: first.id, effects: keyed })).status).toBe('accepted-session-only');
    expect(evaluateClipEffects(get(GVID_SEQUENCE_VIEW).tracks[0].clips[0], 10)).toEqual(keyed);
    expectLinkedPair(get, 1);
    expect((await edit.setClipEffects({ ...source(), keyframeId: first.id,
      effects: { ...keyed, alpha: 2 } })).status).toBe('rejected');
    expect((await edit.saveEffectsProfile({ ...source(), name: '  Opening look  ' })).status)
      .toBe('accepted-session-only');
    const profile = get(GVID_EFFECT_PROFILES)[0];
    expect(profile).toMatchObject({ name: 'Opening look', version: 1,
      keyframes: [{ offset: 10, effects: keyed }] });
    expect((await edit.applyEffectsProfile({ ...scope(), trackId: 'v1', clipId: 'clip-b',
      profileId: profile.id, profileVersion: 0 })).status).toBe('rejected');
    expect((await edit.applyEffectsProfile({ ...scope(), trackId: 'v1', clipId: 'clip-b',
      profileId: profile.id, profileVersion: 1 })).status).toBe('accepted-session-only');
    const target = get(GVID_SEQUENCE_VIEW).tracks[0].clips[1];
    expect(target.effects).toEqual(base);
    expect(target.keyframes).toMatchObject([{ sourceFrame: 15, effects: keyed }]);
    expect(target.keyframes![0].id).not.toBe(first.id);
    await get(GVID_HISTORY_CONTROL).undo();
    expect(get(GVID_SEQUENCE_VIEW).tracks[0].clips[1].keyframes).toBeUndefined();
    await get(GVID_HISTORY_CONTROL).redo();
    expect(get(GVID_SEQUENCE_VIEW).tracks[0].clips[1].keyframes).toHaveLength(1);
    await get(GVID_HISTORY_CONTROL).undo();
    await get(GVID_HISTORY_CONTROL).undo();
    expect(get(GVID_EFFECT_PROFILES)).toEqual([]);
  });

  it('keeps keyframes attached to source frames through copy, move, trim, and split', async () => {
    const { get, scope, target } = setup();
    const edit = get(GVID_EDIT_COMMAND);
    const selected = () => ({ ...scope(), trackId: 'v1', clipId: 'clip-a' });
    await edit.addClipKeyframe({ ...selected(), frame: 10 });
    await edit.addClipKeyframe({ ...selected(), frame: 30 });
    await edit.copyClip(selected());
    expect((await edit.pasteClip({ ...scope(), target: target(96) })).status).toBe('accepted-session-only');
    const pasted = get(GVID_SEQUENCE_VIEW).tracks[0].clips.find((clip) => clip.timelineIn === 96)!;
    expect(pasted.keyframes?.map((keyframe) => keyframe.sourceFrame)).toEqual([22, 42]);
    await edit.addTrack(scope());
    expect((await edit.moveClip({ ...scope(), sourceTrackId: 'v1', clipId: pasted.id,
      target: { ...target(160), trackId: 'v2' } })).status).toBe('accepted-session-only');
    const moved = get(GVID_SEQUENCE_VIEW).tracks.find((track) => track.id === 'v2')!.clips[0];
    expect(moved.keyframes?.map((keyframe) => keyframe.sourceFrame)).toEqual([22, 42]);
    await edit.trimClip({ ...scope(), trackId: 'v2', clipId: moved.id, edge: 'in', frame: 175 });
    expect(get(GVID_SEQUENCE_VIEW).tracks.find((track) => track.id === 'v2')!.clips[0].keyframes)
      .toHaveLength(2);
    await edit.trimClip({ ...scope(), trackId: 'v2', clipId: moved.id, edge: 'in', frame: 160 });
    expect((await edit.splitClip({ ...scope(), trackId: 'v2', frame: 184 })).status)
      .toBe('accepted-session-only');
    const halves = get(GVID_SEQUENCE_VIEW).tracks.find((track) => track.id === 'v2')!.clips;
    expect(halves.map((clip) => clip.keyframes?.map((keyframe) => keyframe.sourceFrame)))
      .toEqual([[22], [42]]);
    expectLinkedPair(get, 2);
  });

  it('partitions keyframes when ripple edits divide a clip', async () => {
    const { get, scope, target, intent } = setup();
    const edit = get(GVID_EDIT_COMMAND);
    await edit.addClipKeyframe({ ...scope(), trackId: 'v1', clipId: 'clip-a', frame: 10 });
    await edit.addClipKeyframe({ ...scope(), trackId: 'v1', clipId: 'clip-a', frame: 30 });
    get(GVID_ACTIVE_INSERT_TARGET_CONTROL).set(target(24));
    expect((await edit.insert(intent(target(24)))).status).toBe('accepted-session-only');
    const clips = get(GVID_SEQUENCE_VIEW).tracks[0].clips;
    expect(clips[0].keyframes?.map((keyframe) => keyframe.sourceFrame)).toEqual([22]);
    expect(clips[2].keyframes?.map((keyframe) => keyframe.sourceFrame)).toEqual([42]);
    expectLinkedPair(get, 1);
    await get(GVID_HISTORY_CONTROL).undo();
    const deleted = rippleDeleteSpan(get(GVID_SEQUENCE_VIEW), 16, 24, 'keyframe-delete')!;
    expect(deleted.tracks[0].clips.filter((clip) => clip.assetId === 'lighthouse')
      .map((clip) => clip.keyframes?.map((keyframe) => keyframe.sourceFrame))).toEqual([[22], [42]]);
  });

  it('shares source markers by asset and restores their edits through history', async () => {
    const { get, sourceScope } = setup();
    const edit = get(GVID_EDIT_COMMAND);
    const stale = sourceScope();
    expect((await edit.addSourceMarker({ ...stale, frame: 12 })).status).toBe('accepted-session-only');
    const marker = get(GVID_SOURCE_MARKER_CATALOG)[0].markers[0];
    expect(marker).toMatchObject({ sourceFrame: 12, label: '', color: 'red' });
    expect((await edit.addSourceMarker({ ...stale, frame: 13 })).status).toBe('rejected');
    expect((await edit.addSourceMarker({ ...sourceScope(), frame: 12 })).status).toBe('rejected');
    expect((await edit.addSourceMarker({ ...sourceScope(), fingerprint: 'old', frame: 13 })).status).toBe('rejected');
    expect((await edit.updateSourceMarker({ ...sourceScope(), markerId: marker.id,
      label: '  Slate  ', color: 'green' })).status).toBe('accepted-session-only');
    expect(get(GVID_SOURCE_MARKER_CATALOG)[0].markers[0]).toMatchObject({ label: 'Slate', color: 'green' });
    expect((await edit.updateSourceMarker({ ...sourceScope(), markerId: marker.id,
      label: 'Slate', color: 'purple' as 'red' })).status).toBe('rejected');
    await get(GVID_HISTORY_CONTROL).undo();
    expect(get(GVID_SOURCE_MARKER_CATALOG)[0].markers[0]).toMatchObject({ label: '', color: 'red' });
    await get(GVID_HISTORY_CONTROL).undo();
    expect(get(GVID_SOURCE_MARKER_CATALOG)).toEqual([]);
    await get(GVID_HISTORY_CONTROL).redo();
    await get(GVID_HISTORY_CONTROL).redo();
    expect(get(GVID_SOURCE_MARKER_CATALOG)[0].markers[0]).toMatchObject({ label: 'Slate', color: 'green' });
    await edit.addSourceMarker({ ...sourceScope('lighthouse'), frame: 12 });
    expect(get(GVID_SOURCE_MARKER_CATALOG).map((set) => set.assetId)).toEqual(['workshop', 'lighthouse']);
    get(GVID_PROJECT_CONTROL).open('mock-b', { discardSessionEdits: true });
    expect(get(GVID_SOURCE_MARKER_CATALOG)).toEqual([]);
    expect((await edit.addSourceMarker({ ...stale, frame: 12 })).status).toBe('rejected');
  });

  it('carries source markers inside the selected span through drop and insert', async () => {
    const { get, sourceScope, target, placeIntent, intent } = setup();
    const edit = get(GVID_EDIT_COMMAND);
    for (const frame of [11, 12, 20, 24]) {
      expect((await edit.addSourceMarker({ ...sourceScope(), frame })).status).toBe('accepted-session-only');
    }
    const labeledMarker = get(GVID_SOURCE_MARKER_CATALOG)[0].markers.find((marker) => marker.sourceFrame === 12)!;
    expect((await edit.updateSourceMarker({ ...sourceScope(), markerId: labeledMarker.id,
      label: 'Slate', color: 'blue' })).status).toBe('accepted-session-only');
    expect((await edit.place(placeIntent(target(96), { sourceIn: 12, sourceOut: 24 }))).status)
      .toBe('accepted-session-only');
    const placed = get(GVID_SEQUENCE_VIEW).tracks[0].clips.find((clip) => clip.timelineIn === 96)!;
    expect(placed.markers?.map((marker) => marker.sourceFrame)).toEqual([12, 20]);
    expect(placed.markers?.[0]).toMatchObject({ id: labeledMarker.id, label: 'Slate', color: 'blue' });
    expectLinkedPair(get, 1);

    get(GVID_ACTIVE_INSERT_TARGET_CONTROL).set(target(24));
    expect((await edit.insert(intent(target(24), { sourceIn: 20, sourceOut: 24 }))).status)
      .toBe('accepted-session-only');
    const inserted = get(GVID_SEQUENCE_VIEW).tracks[0].clips.find((clip) => clip.id.startsWith('insert-'))!;
    expect(inserted.markers?.map((marker) => marker.sourceFrame)).toEqual([20]);
    expect(get(GVID_SOURCE_MARKER_CATALOG)[0].markers.map((marker) => marker.sourceFrame))
      .toEqual([11, 12, 20, 24]);
    expectLinkedPair(get, 1);
    await get(GVID_HISTORY_CONTROL).undo();
    expect(get(GVID_SEQUENCE_VIEW).tracks[0].clips.some((clip) => clip.id === inserted.id)).toBe(false);
    expect(get(GVID_SOURCE_MARKER_CATALOG)[0].markers).toHaveLength(4);
    await get(GVID_HISTORY_CONTROL).redo();
    expect(get(GVID_SEQUENCE_VIEW).tracks[0].clips.find((clip) => clip.id === inserted.id)?.markers)
      .toHaveLength(1);
  });

  it('adds, edits, and undoes clip markers on the selected source frame', async () => {
    const { get, scope } = setup();
    const edit = get(GVID_EDIT_COMMAND);
    const selected = () => ({ ...scope(), trackId: 'v1', clipId: 'clip-a' });
    expect((await edit.addClipMarker({ ...selected(), frame: 48 })).status).toBe('rejected');
    expect((await edit.addClipMarker({ ...selected(), frame: 10 })).status).toBe('accepted-session-only');
    const marker = get(GVID_SEQUENCE_VIEW).tracks[0].clips[0].markers![0];
    expect(marker).toMatchObject({ sourceFrame: 22, label: '', color: 'red' });
    expectLinkedPair(get, 1);
    expect((await edit.addClipMarker({ ...selected(), frame: 10 })).status).toBe('rejected');
    expect((await edit.updateClipMarker({ ...selected(), markerId: marker.id,
      label: '  Entrance  ', color: 'blue' })).status).toBe('accepted-session-only');
    expect(get(GVID_SEQUENCE_VIEW).tracks[0].clips[0].markers![0]).toMatchObject({ label: 'Entrance', color: 'blue' });
    expectLinkedPair(get, 1);
    expect((await edit.updateClipMarker({ ...selected(), markerId: marker.id,
      label: 'Entrance', color: 'purple' as 'red' })).status).toBe('rejected');
    await get(GVID_HISTORY_CONTROL).undo();
    expect(get(GVID_SEQUENCE_VIEW).tracks[0].clips[0].markers![0]).toMatchObject({ label: '', color: 'red' });
    await get(GVID_HISTORY_CONTROL).undo();
    expect(get(GVID_SEQUENCE_VIEW).tracks[0].clips[0].markers).toBeUndefined();
    await get(GVID_HISTORY_CONTROL).redo();
    await get(GVID_HISTORY_CONTROL).redo();
    expect(get(GVID_SEQUENCE_VIEW).tracks[0].clips[0].markers![0]).toMatchObject({ label: 'Entrance', color: 'blue' });
    expect((await edit.addClipMarker({ ...scope(), trackId: 'a1', clipId: 'audio-clip-a', frame: 11 })).status)
      .toBe('accepted-session-only');
    expect(get(GVID_SEQUENCE_VIEW).tracks[0].clips[0].markers?.[1].sourceFrame).toBe(23);
    expectLinkedPair(get, 1);
  });

  it('keeps marker source frames through copy, move, trim, split, and linked audio', async () => {
    const { get, scope, target } = setup();
    const edit = get(GVID_EDIT_COMMAND);
    const selected = () => ({ ...scope(), trackId: 'v1', clipId: 'clip-a' });
    await edit.addClipMarker({ ...selected(), frame: 10 });
    await edit.addClipMarker({ ...selected(), frame: 30 });
    expect((await edit.copyClip(selected())).status).toBe('accepted-session-only');
    expect((await edit.pasteClip({ ...scope(), target: target(96) })).status).toBe('accepted-session-only');
    const pasted = get(GVID_SEQUENCE_VIEW).tracks[0].clips.find((clip) => clip.timelineIn === 96)!;
    expect(pasted.markers?.map((marker) => marker.sourceFrame)).toEqual([22, 42]);
    expectLinkedPair(get, 1);

    await edit.addTrack(scope());
    expect((await edit.moveClip({ ...scope(), sourceTrackId: 'a1', clipId: pasted.linkedClipId!,
      target: { ...target(160), trackId: 'a2' } })).status).toBe('accepted-session-only');
    const moved = get(GVID_SEQUENCE_VIEW).tracks.find((track) => track.id === 'v2')!.clips[0];
    expect(moved.markers?.map((marker) => marker.sourceFrame)).toEqual([22, 42]);
    expectLinkedPair(get, 2);

    await edit.trimClip({ ...scope(), trackId: 'v2', clipId: moved.id, edge: 'in', frame: 175 });
    const trimmed = get(GVID_SEQUENCE_VIEW).tracks.find((track) => track.id === 'v2')!.clips[0];
    expect(trimmed.sourceIn).toBe(27);
    expect(trimmed.markers?.map((marker) => marker.sourceFrame)).toEqual([22, 42]);
    await edit.trimClip({ ...scope(), trackId: 'v2', clipId: moved.id, edge: 'in', frame: 160 });
    expect((await edit.splitClip({ ...scope(), trackId: 'v2', frame: 184 })).status).toBe('accepted-session-only');
    const halves = get(GVID_SEQUENCE_VIEW).tracks.find((track) => track.id === 'v2')!.clips;
    expect(halves.map((clip) => clip.markers?.map((marker) => marker.sourceFrame))).toEqual([[22], [42]]);
    expectLinkedPair(get, 2);
    await get(GVID_HISTORY_CONTROL).undo();
    expect(get(GVID_SEQUENCE_VIEW).tracks.find((track) => track.id === 'v2')!.clips[0].markers)
      .toHaveLength(2);
  });

  it('partitions markers when a ripple insert splits a clip', async () => {
    const { get, scope, target, intent } = setup();
    const edit = get(GVID_EDIT_COMMAND);
    await edit.addClipMarker({ ...scope(), trackId: 'v1', clipId: 'clip-a', frame: 10 });
    await edit.addClipMarker({ ...scope(), trackId: 'v1', clipId: 'clip-a', frame: 30 });
    get(GVID_ACTIVE_INSERT_TARGET_CONTROL).set(target(24));
    expect((await edit.insert(intent(target(24)))).status).toBe('accepted-session-only');
    const clips = get(GVID_SEQUENCE_VIEW).tracks[0].clips;
    expect(clips[0].markers?.map((marker) => marker.sourceFrame)).toEqual([22]);
    expect(clips[2].markers?.map((marker) => marker.sourceFrame)).toEqual([42]);
    expectLinkedPair(get, 1);
    await get(GVID_HISTORY_CONTROL).undo();
    expect(get(GVID_SEQUENCE_VIEW).tracks[0].clips[0].markers?.map((marker) => marker.sourceFrame))
      .toEqual([22, 42]);
    const deleted = rippleDeleteSpan(get(GVID_SEQUENCE_VIEW), 16, 24, 'marker-delete')!;
    expect(deleted.tracks[0].clips.filter((clip) => clip.assetId === 'lighthouse')
      .map((clip) => clip.markers?.map((marker) => marker.sourceFrame))).toEqual([[22], [42]]);
  });

  it('toggles video visibility and audio mute independently with undo and stale-scope checks', async () => {
    const { get, scope } = setup();
    const edit = get(GVID_EDIT_COMMAND);
    const history = get(GVID_HISTORY_CONTROL);
    expect((await edit.setVideoHidden({ ...scope(), trackId: 'a1', hidden: true })).status).toBe('rejected');
    expect((await edit.setAudioMuted({ ...scope(), trackId: 'v1', muted: true })).status).toBe('rejected');
    expect((await edit.setVideoHidden({ ...scope(), trackId: 'v1', hidden: true })).status)
      .toBe('accepted-session-only');
    expect(get(GVID_SEQUENCE_VIEW).tracks.find((track) => track.id === 'v1')?.hidden).toBe(true);
    expect(get(GVID_SEQUENCE_VIEW).tracks.find((track) => track.id === 'a1')?.muted).toBe(false);
    expect((await edit.setAudioMuted({ ...scope(), trackId: 'a1', muted: true })).status)
      .toBe('accepted-session-only');
    expect(get(GVID_SEQUENCE_VIEW).tracks.find((track) => track.id === 'v1')?.hidden).toBe(true);
    expect(get(GVID_SEQUENCE_VIEW).tracks.find((track) => track.id === 'a1')?.muted).toBe(true);
    expect((await edit.setAudioMuted({ ...scope(), expectedRevision: 1,
      trackId: 'a1', muted: false })).status).toBe('rejected');
    await history.undo();
    expect(get(GVID_SEQUENCE_VIEW).tracks.find((track) => track.id === 'a1')?.muted).toBe(false);
    expect(get(GVID_SEQUENCE_VIEW).tracks.find((track) => track.id === 'v1')?.hidden).toBe(true);
    await history.undo();
    expect(get(GVID_SEQUENCE_VIEW).tracks.find((track) => track.id === 'v1')?.hidden).toBeFalsy();
    await history.redo();
    await history.redo();
    expect(get(GVID_SEQUENCE_VIEW).tracks.find((track) => track.id === 'v1')?.hidden).toBe(true);
    expect(get(GVID_SEQUENCE_VIEW).tracks.find((track) => track.id === 'a1')?.muted).toBe(true);
  });
  it('publishes numbered linked audio tracks and keeps video-only sources silent', async () => {
    const { get, scope, target, placeIntent } = setup();
    expect(get(GVID_SEQUENCE_VIEW).tracks.map((track) => track.id)).toEqual(['v1', 'a1']);
    expectLinkedPair(get, 1);
    get(GVID_PROJECT_CONTROL).open('mock-b');
    expect(get(GVID_ASSET_CATALOG)).toHaveLength(10);
    expect(get(GVID_ASSET_CATALOG).find((asset) => asset.id === 'studio-b')?.hasAudio).toBe(false);
    expectLinkedPair(get, 1);
    await get(GVID_EDIT_COMMAND).place(placeIntent(target(96), { assetId: 'studio-b' }));
    expectLinkedPair(get, 1);
    expect(get(GVID_SEQUENCE_VIEW).tracks.find((track) => track.id === 'a1')?.clips).toHaveLength(1);
    expect(scope().expectedRevision).toBe(2);
  });

  it('moves either half of an A/V clip across time and numbered track pairs, including overlap', async () => {
    const { get, scope, target } = setup();
    const edit = get(GVID_EDIT_COMMAND);
    await edit.addTrack(scope());
    expect((await edit.moveClip({ ...scope(), sourceTrackId: 'v1', clipId: 'clip-a',
      target: { ...target(72), trackId: 'v2' } })).status).toBe('accepted-session-only');
    expectLinkedPair(get, 1);
    expectLinkedPair(get, 2);
    expect(get(GVID_SEQUENCE_VIEW).tracks.find((track) => track.id === 'a2')?.clips[0])
      .toMatchObject({ id: 'audio-clip-a', timelineIn: 72 });
    expect((await edit.moveClip({ ...scope(), sourceTrackId: 'a2', clipId: 'audio-clip-a',
      target: { ...target(96), trackId: 'a1' } })).status).toBe('accepted-session-only');
    expectLinkedPair(get, 1);
    expectLinkedPair(get, 2);
    expect(get(GVID_SEQUENCE_VIEW).tracks.find((track) => track.id === 'v1')?.clips.at(-1))
      .toMatchObject({ id: 'clip-a', timelineIn: 96, timelineOut: 144 });
    expect((await edit.moveClip({ ...scope(), sourceTrackId: 'a1', clipId: 'audio-clip-a',
      target: { ...target(48), trackId: 'a1' } })).status).toBe('accepted-session-only');
    expect(get(GVID_SEQUENCE_VIEW).tracks.map((track) => track.id)).toEqual(['v1', 'v2', 'v3', 'a1', 'a2', 'a3']);
    expectLinkedPair(get, 3);
    await get(GVID_HISTORY_CONTROL).undo();
    expect(get(GVID_SEQUENCE_VIEW).tracks.map((track) => track.id)).toEqual(['v1', 'v2', 'a1', 'a2']);
    expectLinkedPair(get, 1);
  });

  it('keeps A/V halves aligned through audio-side trim, split, cut, and undo', async () => {
    const { get, scope } = setup();
    const edit = get(GVID_EDIT_COMMAND);
    expect((await edit.trimClip({ ...scope(), trackId: 'a1', clipId: 'audio-clip-a',
      edge: 'in', frame: 8 })).status).toBe('accepted-session-only');
    expectLinkedPair(get, 1);
    expect((await edit.splitClip({ ...scope(), trackId: 'a1', frame: 24 })).status).toBe('accepted-session-only');
    expectLinkedPair(get, 1);
    expect((await edit.cutClip({ ...scope(), trackId: 'a1', clipId: 'audio-clip-a' })).status)
      .toBe('accepted-session-only');
    expectLinkedPair(get, 1);
    await get(GVID_HISTORY_CONTROL).undo();
    expectLinkedPair(get, 1);
    expect(get(GVID_SEQUENCE_VIEW).tracks.find((track) => track.id === 'a1')?.clips[0])
      .toMatchObject({ id: 'audio-clip-a', timelineIn: 8, timelineOut: 24 });
  });
  it('adds and deletes tracks with their clips as undoable sequence snapshots', async () => {
    const { get, scope, target, placeIntent } = setup();
    const edit = get(GVID_EDIT_COMMAND);
    const history = get(GVID_HISTORY_CONTROL);
    expect((await edit.deleteTrack({ ...scope(), trackId: 'v1' })).status).toBe('rejected');
    expect((await edit.addTrack(scope())).status).toBe('accepted-session-only');
    expect(get(GVID_SEQUENCE_VIEW).tracks.map((track) => track.id)).toEqual(['v1', 'v2', 'a1', 'a2']);
    expect((await edit.place(placeIntent({ ...target(12), trackId: 'v2' }))).status).toBe('accepted-session-only');
    expect(get(GVID_SEQUENCE_VIEW).tracks[1].clips).toHaveLength(1);
    expect((await edit.deleteTrack({ ...scope(), trackId: 'v2' })).status).toBe('accepted-session-only');
    expect(get(GVID_SEQUENCE_VIEW).tracks.map((track) => track.id)).toEqual(['v1', 'a1']);
    expect(get(GVID_HISTORY_VIEW).undoLabel).toBe('Delete track');
    expect((await history.undo()).status).toBe('accepted-session-only');
    expect(get(GVID_SEQUENCE_VIEW).tracks[1].clips).toHaveLength(1);
    expect((await history.redo()).status).toBe('accepted-session-only');
    expect(get(GVID_SEQUENCE_VIEW).tracks.map((track) => track.id)).toEqual(['v1', 'a1']);
  });

  it('places at the drop frame and auto-adds a track only on overlap', async () => {
    const { get, target, placeIntent } = setup();
    const edit = get(GVID_EDIT_COMMAND);
    expect((await edit.place(placeIntent(target(96)))).status).toBe('accepted-session-only');
    expect(get(GVID_SEQUENCE_VIEW).tracks).toHaveLength(2);
    expect(ranges(get(GVID_SEQUENCE_VIEW).tracks[0].clips).at(-1)).toEqual(['workshop', 0, 24, 96, 120]);
    expect((await edit.place(placeIntent(target(24), { sourceIn: 8, sourceOut: 20 }))).status).toBe('accepted-session-only');
    const seq = get(GVID_SEQUENCE_VIEW);
    expect(seq.tracks).toHaveLength(4);
    expect(ranges(seq.tracks[1].clips)).toEqual([['workshop', 8, 20, 24, 36]]);
    expect(seq.durationFrames).toBe(120);
    expect((await get(GVID_HISTORY_CONTROL).undo()).status).toBe('accepted-session-only');
    expect(get(GVID_SEQUENCE_VIEW).tracks).toHaveLength(2);
  });

  it('copies whole trimmed clips, cuts them with undo, and pastes at the playhead target', async () => {
    const { get, scope, target } = setup();
    const edit = get(GVID_EDIT_COMMAND);
    const history = get(GVID_HISTORY_CONTROL);
    const selected = () => ({ ...scope(), trackId: 'v1', clipId: 'clip-a' });
    expect((await edit.trimClip({ ...selected(), edge: 'in', frame: 8 })).status).toBe('accepted-session-only');
    const revision = get(GVID_GRAPH_VIEW).revision;
    expect((await edit.copyClip(selected())).status).toBe('accepted-session-only');
    expect(get(GVID_GRAPH_VIEW).revision).toBe(revision);
    expect(get(GVID_HISTORY_VIEW).undoLabel).toBe('Trim clip');
    expect((await edit.cutClip(selected())).status).toBe('accepted-session-only');
    expect(ranges(get(GVID_SEQUENCE_VIEW).tracks[0].clips)).toEqual([
      ['workshop', 5, 53, 48, 96],
    ]);
    expect(get(GVID_HISTORY_VIEW).undoLabel).toBe('Cut clip');
    expect((await history.undo()).status).toBe('accepted-session-only');
    expect(get(GVID_SEQUENCE_VIEW).tracks[0].clips[0]).toMatchObject({
      id: 'clip-a', sourceIn: 20, sourceOut: 60, timelineIn: 8, timelineOut: 48,
    });
    expect((await history.redo()).status).toBe('accepted-session-only');
    expect((await edit.pasteClip({ ...scope(), target: target(0) })).status).toBe('accepted-session-only');
    expect(ranges(get(GVID_SEQUENCE_VIEW).tracks[0].clips)).toEqual([
      ['lighthouse', 20, 60, 0, 40], ['workshop', 5, 53, 48, 96],
    ]);
    expect(get(GVID_HISTORY_VIEW).undoLabel).toBe('Paste clip');
    expect((await history.undo()).status).toBe('accepted-session-only');
    expect(get(GVID_SEQUENCE_VIEW).tracks[0].clips).toHaveLength(1);
  });

  it('pastes overlaps onto a new track and rejects stale or cross-project clipboard use', async () => {
    const { get, scope, target } = setup();
    const edit = get(GVID_EDIT_COMMAND);
    expect((await edit.pasteClip({ ...scope(), target: target(24) })).status).toBe('rejected');
    expect((await edit.copyClip({ ...scope(), trackId: 'v1', clipId: 'clip-a' })).status).toBe('accepted-session-only');
    expect((await edit.pasteClip({ ...scope(), target: target(24) })).status).toBe('accepted-session-only');
    expect(get(GVID_SEQUENCE_VIEW).tracks).toHaveLength(4);
    expect(ranges(get(GVID_SEQUENCE_VIEW).tracks[1].clips)).toEqual([
      ['lighthouse', 12, 60, 24, 72],
    ]);
    expect((await edit.cutClip({ ...scope(), expectedRevision: 1, trackId: 'v1', clipId: 'clip-b' })).status)
      .toBe('rejected');
    expect((await edit.pasteClip({ ...scope(), target: { ...target(24), ownerTabId: 'foreign' } })).status)
      .toBe('rejected');
    expect(get(GVID_PROJECT_CONTROL).open('mock-b', { discardSessionEdits: true }).status).toBe('opened');
    expect((await edit.pasteClip({ ...scope(), target: target(24) })).status).toBe('rejected');
  });

  it('splits the clip crossing the selected track playhead and undoes the split', async () => {
    const { get, scope } = setup();
    const edit = get(GVID_EDIT_COMMAND);
    expect((await edit.splitClip({ ...scope(), trackId: 'v1', frame: 0 })).status).toBe('rejected');
    expect((await edit.splitClip({ ...scope(), trackId: 'v1', frame: 24 })).status).toBe('accepted-session-only');
    expect(ranges(get(GVID_SEQUENCE_VIEW).tracks[0].clips)).toEqual([
      ['lighthouse', 12, 36, 0, 24], ['lighthouse', 36, 60, 24, 48],
      ['workshop', 5, 53, 48, 96],
    ]);
    expect(get(GVID_SEQUENCE_VIEW).durationFrames).toBe(96);
    expect((await get(GVID_HISTORY_CONTROL).undo()).status).toBe('accepted-session-only');
    expect(get(GVID_SEQUENCE_VIEW).tracks[0].clips).toHaveLength(2);
  });

  it('lifts a clip without closing time, then ripple-deletes it across tracks', async () => {
    const { get, scope, target, placeIntent } = setup();
    const edit = get(GVID_EDIT_COMMAND);
    const history = get(GVID_HISTORY_CONTROL);
    expect((await edit.deleteClip({ ...scope(), trackId: 'v1', clipId: 'clip-a', ripple: false })).status)
      .toBe('accepted-session-only');
    expect(ranges(get(GVID_SEQUENCE_VIEW).tracks[0].clips)).toEqual([
      ['workshop', 5, 53, 48, 96],
    ]);
    expect(get(GVID_SEQUENCE_VIEW).durationFrames).toBe(96);
    await history.undo();
    expect((await edit.place(placeIntent(target(0), { assetId: 'lighthouse',
      sourceIn: 0, sourceOut: 120 }))).status).toBe('accepted-session-only');
    expect((await edit.deleteClip({ ...scope(), trackId: 'v1', clipId: 'clip-b', ripple: true })).status)
      .toBe('accepted-session-only');
    const seq = get(GVID_SEQUENCE_VIEW);
    expect(seq.durationFrames).toBe(72);
    expect(ranges(seq.tracks[0].clips)).toEqual([['lighthouse', 12, 60, 0, 48]]);
    expect(ranges(seq.tracks[1].clips)).toEqual([
      ['lighthouse', 0, 48, 0, 48], ['lighthouse', 96, 120, 48, 72],
    ]);
    expect(get(GVID_HISTORY_VIEW).undoLabel).toBe('Ripple delete clip');
    await history.undo();
    expect(get(GVID_SEQUENCE_VIEW).durationFrames).toBe(120);
    expect(get(GVID_SEQUENCE_VIEW).tracks[1].clips).toHaveLength(1);
    const locked = { ...seq, tracks: [seq.tracks[0], { ...seq.tracks[1], locked: true }] };
    expect(rippleDeleteSpan(locked, 0, 24, 'locked-test')).toBeNull();
    expect((await edit.deleteClip({ ...scope(), expectedRevision: 1,
      trackId: 'v1', clipId: 'clip-a', ripple: true })).status).toBe('rejected');
  });

  it('moves clips within and between tracks, raises overlaps, and undoes the move', async () => {
    const { get, scope } = setup();
    const edit = get(GVID_EDIT_COMMAND);
    const history = get(GVID_HISTORY_CONTROL);
    const base = get(GVID_SEQUENCE_VIEW);
    const clipId = base.tracks[0].clips[0].id;
    const target = (trackId: string, frame: number): InsertTarget => ({
      projectId: scope().projectId, graphId: get(GVID_GRAPH_VIEW).graphId,
      sequenceId: base.id, trackId, frame, ownerTabId: 'timeline-1',
    });
    expect((await edit.moveClip({ ...scope(), sourceTrackId: 'v1', clipId,
      target: target('v1', 48) })).status).toBe('accepted-session-only');
    expect(get(GVID_SEQUENCE_VIEW).tracks).toHaveLength(4);
    expect(get(GVID_SEQUENCE_VIEW).tracks[1].clips[0]).toMatchObject({ id: clipId, timelineIn: 48, timelineOut: 96 });
    expect((await history.undo()).status).toBe('accepted-session-only');
    expect(get(GVID_SEQUENCE_VIEW).tracks).toHaveLength(2);
    expect(get(GVID_SEQUENCE_VIEW).tracks[0].clips[0]).toMatchObject({ id: clipId, timelineIn: 0 });
    expect((await edit.addTrack(scope())).status).toBe('accepted-session-only');
    expect((await edit.moveClip({ ...scope(), sourceTrackId: 'v1', clipId,
      target: target('v2', 72) })).status).toBe('accepted-session-only');
    expect(get(GVID_SEQUENCE_VIEW).tracks[1].clips[0]).toMatchObject({ id: clipId, timelineIn: 72, timelineOut: 120 });
    expect((await edit.moveClip({ ...scope(), sourceTrackId: 'v2', clipId: 'missing',
      target: target('v1', 0) })).status).toBe('rejected');
  });

  it('trims both clip edges against source and neighbors, with undo and stale-scope checks', async () => {
    const { get, scope } = setup();
    const edit = get(GVID_EDIT_COMMAND);
    const history = get(GVID_HISTORY_CONTROL);
    const trim = (clipId: string, edge: 'in' | 'out', frame: number) =>
      edit.trimClip({ ...scope(), trackId: 'v1', clipId, edge, frame });
    expect((await trim('clip-a', 'out', 40)).status).toBe('accepted-session-only');
    expect(ranges(get(GVID_SEQUENCE_VIEW).tracks[0].clips)).toEqual([
      ['lighthouse', 12, 52, 0, 40], ['workshop', 5, 53, 48, 96],
    ]);
    expect((await trim('clip-a', 'out', 49)).status).toBe('rejected');
    expect((await trim('clip-a', 'out', 48)).status).toBe('accepted-session-only');
    expect((await trim('clip-b', 'in', 53)).status).toBe('accepted-session-only');
    expect(get(GVID_SEQUENCE_VIEW).tracks[0].clips[1]).toMatchObject({ sourceIn: 10, timelineIn: 53 });
    expect((await trim('clip-b', 'in', 47)).status).toBe('rejected');
    expect((await trim('clip-b', 'in', 48)).status).toBe('accepted-session-only');
    expect((await trim('clip-b', 'out', 134)).status).toBe('rejected');
    expect((await trim('clip-b', 'out', 133)).status).toBe('accepted-session-only');
    expect(get(GVID_SEQUENCE_VIEW).tracks[0].clips[1]).toMatchObject({ sourceOut: 90, timelineOut: 133 });
    expect(get(GVID_SEQUENCE_VIEW).durationFrames).toBe(133);
    expect((await history.undo()).status).toBe('accepted-session-only');
    expect(get(GVID_SEQUENCE_VIEW).tracks[0].clips[1]).toMatchObject({ sourceOut: 53, timelineOut: 96 });
    expect((await edit.trimClip({ ...scope(), expectedRevision: 1, trackId: 'v1',
      clipId: 'clip-a', edge: 'out', frame: 30 })).status).toBe('rejected');
  });

  it('rejects stale, invalid and foreign drop edits', async () => {
    const { get, scope, target, placeIntent } = setup();
    const edit = get(GVID_EDIT_COMMAND);
    const original = get(GVID_GRAPH_VIEW);
    for (const intent of [
      placeIntent(target(10), { sessionId: 'old' }),
      placeIntent(target(10), { sourceIn: 20, sourceOut: 20 }),
      placeIntent(target(10), { target: { ...target(10), ownerTabId: 'other' } }),
      placeIntent(target(10), { target: { ...target(10), trackId: 'missing' } }),
    ]) expect((await edit.place(intent)).status).toBe('rejected');
    expect((await edit.addTrack({ ...scope(), expectedRevision: 0 })).status).toBe('rejected');
    expect(get(GVID_GRAPH_VIEW)).toBe(original);
    expect(get(GVID_HISTORY_VIEW).canUndo).toBe(false);
  });

  it('ripples every track after multi-track placement', async () => {
    const { get, target, placeIntent, intent } = setup();
    const edit = get(GVID_EDIT_COMMAND);
    await edit.place(placeIntent(target(20), { sourceIn: 0, sourceOut: 24 }));
    const at24 = target(24);
    get(GVID_ACTIVE_INSERT_TARGET_CONTROL).set(at24);
    expect((await edit.insert(intent(at24))).status).toBe('accepted-session-only');
    expect(ranges(get(GVID_SEQUENCE_VIEW).tracks[1].clips)).toEqual([
      ['workshop', 0, 4, 20, 24], ['workshop', 4, 24, 48, 68],
    ]);
  });

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
    const catalog = get(GVID_ASSET_CATALOG);
    expect(catalog).toHaveLength(10);
    expect(new Set(catalog.map((asset) => asset.id)).size).toBe(10);
    expect(catalog.slice(0, 2)).toMatchObject([
      { id: 'lighthouse', displayName: 'Lighthouse', version: 'v1', frameCount: 120, width: 640, height: 360 },
      { id: 'workshop', displayName: 'Workshop', version: 'v1', frameCount: 90, width: 640, height: 360 },
    ]);
    expect(catalog.slice(2).map((asset) => asset.id)).toEqual([
      'atrium-walkthrough', 'harbor-crane', 'interview-close-up', 'market-exterior',
      'product-turntable', 'rainy-street', 'studio-detail', 'train-arrival',
    ]);
    expect(catalog.filter((asset) => !asset.hasAudio).map((asset) => asset.id)).toEqual([
      'harbor-crane', 'product-turntable', 'studio-detail',
    ]);
    expect(get(GVID_BINDING_VIEW)).toMatchObject({
      bindingSetId: 'mock-a/bindings', revision: 1,
      byAssetId: { lighthouse: 'lighthouse/video-0', workshop: 'workshop/video-0' },
    });
    expect(Object.keys(get(GVID_BINDING_VIEW).byAssetId)).toHaveLength(10);
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
    expect(result.footprint).toEqual({
      graphId: 'mock-a/main', sequenceId: 'main', revision: 2,
      fromFrame: 24, toFrameExclusive: 120,
    });
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
    const result = await get(GVID_EDIT_COMMAND).insert(intent(end));
    expect(result.status).toBe('accepted-session-only');
    expect(result.footprint).toMatchObject({ revision: 2, fromFrame: 96, toFrameExclusive: 120 });
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
    expect(absent.footprint).toBeUndefined();
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
      expect(result.footprint).toBeUndefined();
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
    expect((await history.undo()).footprint).toMatchObject({ revision: 4, fromFrame: 24, toFrameExclusive: 144 });
    expect(get(GVID_SEQUENCE_VIEW)).toMatchObject({ revision: 4, durationFrames: first.durationFrames });
    expect(get(GVID_HISTORY_VIEW)).toMatchObject({ revision: 4, canUndo: true, canRedo: true });
    expect((await history.redo()).footprint).toMatchObject({ revision: 5, fromFrame: 24, toFrameExclusive: 144 });
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

  it('requires explicit acknowledgement before project controls discard accepted edits or redo history', async () => {
    const { get, target, intent } = setup();
    const projectControl = get(GVID_PROJECT_CONTROL);
    const at24 = target(24);
    get(GVID_ACTIVE_INSERT_TARGET_CONTROL).set(at24);
    await get(GVID_EDIT_COMMAND).insert(intent(at24));
    const acceptedProject = get(GVID_PROJECT_VIEW);
    const acceptedGraph = get(GVID_GRAPH_VIEW);
    const acceptedHistory = get(GVID_HISTORY_VIEW);
    expect(projectControl.open('mock-a').status).toBe('confirmation-required');
    expect(projectControl.open('mock-b').status).toBe('confirmation-required');
    expect(projectControl.close().status).toBe('confirmation-required');
    expect(get(GVID_PROJECT_VIEW)).toBe(acceptedProject);
    expect(get(GVID_GRAPH_VIEW)).toBe(acceptedGraph);
    expect(get(GVID_HISTORY_VIEW)).toEqual(acceptedHistory);
    await get(GVID_HISTORY_CONTROL).undo();
    const undone = get(GVID_GRAPH_VIEW);
    expect(get(GVID_HISTORY_VIEW)).toMatchObject({ canUndo: false, canRedo: true });
    expect(projectControl.close().status).toBe('confirmation-required');
    expect(get(GVID_GRAPH_VIEW)).toBe(undone);
    expect(projectControl.open('mock-b', { discardSessionEdits: true }).status).toBe('opened');
    expect(get(GVID_PROJECT_VIEW)).toMatchObject({ projectId: 'mock-b', revision: 1 });
    expect(get(GVID_HISTORY_VIEW)).toMatchObject({ canUndo: false, canRedo: false });
    const nextTarget = target(96);
    get(GVID_ACTIVE_INSERT_TARGET_CONTROL).set(nextTarget);
    await get(GVID_EDIT_COMMAND).insert(intent(nextTarget, { assetId: 'studio-b' }));
    expect(projectControl.close({ discardSessionEdits: true }).status).toBe('closed');
    expect(get(GVID_PROJECT_VIEW).status).toBe('closed');
  });

  it('accepts insert targets only from a live timeline tab after links resolve', async () => {
    const { grok, get, target, intent, links } = setup(false);
    const control = get(GVID_ACTIVE_INSERT_TARGET_CONTROL);
    const at24 = target(24);
    control.set(at24);
    expect(get(GVID_ACTIVE_INSERT_TARGET)).toBeNull();
    grok.registerTap(links);
    grok.flush();
    links.set([{ tabId: 'source-1', toolId: 'gvid.source' }, { tabId: 'settings-1', toolId: 'settings' }]);
    grok.flush();
    for (const ownerTabId of ['source-1', 'settings-1', 'missing']) {
      control.set({ ...at24, ownerTabId });
      expect(get(GVID_ACTIVE_INSERT_TARGET)).toBeNull();
      expect((await get(GVID_EDIT_COMMAND).insert(intent({ ...at24, ownerTabId }))).status).toBe('rejected');
    }
    links.set([{ tabId: 'timeline-1', toolId: 'gvid.timeline' }]);
    grok.flush();
    control.set(at24);
    expect(get(GVID_ACTIVE_INSERT_TARGET)).toEqual(at24);
    expect((await get(GVID_EDIT_COMMAND).insert(intent(at24))).status).toBe('accepted-session-only');
    links.set([{ tabId: 'timeline-1', toolId: 'gvid.source' }]);
    grok.flush();
    expect(get(GVID_ACTIVE_INSERT_TARGET)).toBeNull();
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
    const { grok, get, target, links } = setup(false);
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
