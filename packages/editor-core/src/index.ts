import { BaseTap, type Grip, type GripContext, type Grok } from '@owebeeone/grip-react';
import { DESKTOP_TAB_LINKS, type TabLinkInfo } from '@grythjs/plugin-api';
import {
  GVID_ACTIVE_INSERT_TARGET, GVID_ACTIVE_INSERT_TARGET_CONTROL, GVID_ASSET_CATALOG,
  GVID_BINDING_VIEW, GVID_CHANGE_STATUS, GVID_DEST_PROJECT_ID, GVID_EDIT_COMMAND, GVID_EFFECT_PROFILES,
  GVID_EDIT_RESULT, GVID_GRAPH_VIEW, GVID_HISTORY_CONTROL, GVID_HISTORY_VIEW,
  GVID_PROJECT_CONTROL, GVID_PROJECT_VIEW, GVID_SEQUENCE_VIEW, GVID_TOOLS,
  GVID_SOURCE_MARKER_CATALOG,
  NEUTRAL_EFFECTS, evaluateClipEffects, sameEffects, validEffects,
  type AddClipKeyframe, type AddClipMarker, type AddSourceMarker, type ApplyEffectsProfile,
  type AssetRecord, type BindingView, type ChangeStatus, type ClipEffectsState,
  type ClipKeyframe, type ClipMarker, type DeleteClipKeyframe, type EditorControl, type EffectsProfile,
  type ChangeFootprint, type EditorResult, type GraphView, type HistoryControl, type HistoryView,
  type DeleteTimelineClip, type DeleteTrack, type InsertSourceSpan, type InsertTarget, type InsertTargetControl,
  type MoveTimelineClip, type PasteTimelineClip, type PlaceSourceSpan, type ProjectControl, type ProjectTransitionResult, type ProjectView,
  type SaveEffectsProfile, type SelectedTimelineClip, type SetAudioMuted, type SetClipEffects,
  type SetVideoHidden, type SplitTimelineClip,
  type SequenceClip, type SequenceTrack, type SequenceView, type TimelineEditScope,
  type SourceMarkerScope, type SourceMarkerSet, type TrimTimelineClip, type UpdateClipMarker, type UpdateSourceMarker,
} from '@gvidjs/contracts';

const RATE = Object.freeze({ num: 24, den: 1 });
const EXTRA_ASSETS = [
  { id: 'atrium-walkthrough', name: 'Atrium Walkthrough', frames: 144, hasAudio: true },
  { id: 'harbor-crane', name: 'Harbor Crane', frames: 72, hasAudio: false },
  { id: 'interview-close-up', name: 'Interview Close-up', frames: 240, hasAudio: true },
  { id: 'market-exterior', name: 'Market Exterior', frames: 180, hasAudio: true },
  { id: 'product-turntable', name: 'Product Turntable', frames: 36, hasAudio: false },
  { id: 'rainy-street', name: 'Rainy Street', frames: 360, hasAudio: true },
  { id: 'studio-detail', name: 'Studio Detail', frames: 24, hasAudio: false },
  { id: 'train-arrival', name: 'Train Arrival', frames: 96, hasAudio: true },
] as const;
const EMPTY_SEQUENCE: SequenceView = Object.freeze({
  id: '', graphId: '', revision: 0, frameRate: RATE, durationFrames: 0, tracks: Object.freeze([]),
});

interface JournalEntry {
  before: SequenceView;
  after: SequenceView;
  beforeProfiles?: readonly EffectsProfile[];
  afterProfiles?: readonly EffectsProfile[];
  beforeSourceMarkers?: readonly SourceMarkerSet[];
  afterSourceMarkers?: readonly SourceMarkerSet[];
  fromFrame: number;
  label: string;
}
interface ClipClipboard {
  projectId: string;
  sessionId: string;
  assetId: string;
  assetVersion: string;
  sourceIn: number;
  sourceOut: number;
  markers: readonly ClipMarker[];
  keyframes: readonly ClipKeyframe[];
  effects: ClipEffectsState;
}
interface State {
  project: ProjectView;
  graph: GraphView;
  assets: readonly AssetRecord[];
  binding: BindingView;
  change: ChangeStatus;
  target: InsertTarget | null;
  result: EditorResult | null;
  clipboard: ClipClipboard | null;
  sourceMarkers: readonly SourceMarkerSet[];
  profiles: readonly EffectsProfile[];
  journal: readonly JournalEntry[];
  cursor: number;
}

let sessionSerial = 0;
function newSession(): string {
  sessionSerial += 1;
  return `mock-session-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}-${sessionSerial}`;
}

function makeAsset(projectId: string, id: string, displayName: string, frameCount: number,
  hasAudio = true): AssetRecord {
  return Object.freeze({
    id, displayName, version: 'v1', fingerprint: `${projectId}/${id}/v1`,
    streamId: `${id}/video-0`, frameCount, width: 640, height: 360,
    frameRate: RATE, hasAudio, status: 'ready',
  });
}

function makeSequence(projectId: string, assets: readonly AssetRecord[]): SequenceView {
  const graphId = `${projectId}/main`;
  const second = projectId === 'mock-a' ? 'workshop' : 'studio-b';
  const clips: readonly SequenceClip[] = Object.freeze([
    Object.freeze({ id: 'clip-a', assetId: 'lighthouse', sourceIn: 12, sourceOut: 60, timelineIn: 0, timelineOut: 48 }),
    Object.freeze({ id: 'clip-b', assetId: second, sourceIn: 5, sourceOut: 53, timelineIn: 48, timelineOut: 96 }),
  ]);
  return withAudioTracks(Object.freeze({
    id: 'main', graphId, revision: 1, frameRate: RATE, durationFrames: 96,
    tracks: Object.freeze([Object.freeze({ id: 'v1', label: 'V1', kind: 'video', locked: false, clips })]),
  }), assets);
}

function initialState(projectId: 'mock-a' | 'mock-b'): State {
  const assets = Object.freeze([
    makeAsset(projectId, 'lighthouse', projectId === 'mock-a' ? 'Lighthouse' : 'Lighthouse B', 120),
    projectId === 'mock-a' ? makeAsset(projectId, 'workshop', 'Workshop', 90) :
      makeAsset(projectId, 'studio-b', 'Studio B', 90, false),
    ...EXTRA_ASSETS.map((item) => makeAsset(projectId, item.id, item.name, item.frames, item.hasAudio)),
  ]);
  const seq = makeSequence(projectId, assets);
  const binding: BindingView = Object.freeze({
    bindingSetId: `${projectId}/bindings`, revision: 1,
    byAssetId: Object.freeze(Object.fromEntries(assets.map((item) => [item.id, item.streamId]))),
  });
  return {
    project: Object.freeze({
      projectId, sessionId: newSession(), graphId: seq.graphId, revision: 1,
      bindingSetId: binding.bindingSetId, bindingRevision: 1, sessionOnly: true, status: 'ready',
    }),
    graph: Object.freeze({ graphId: seq.graphId, revision: 1, sequence: seq }),
    assets, binding, change: Object.freeze({ state: 'live' }), target: null, result: null, clipboard: null,
    sourceMarkers: Object.freeze([]), profiles: Object.freeze([]), journal: Object.freeze([]), cursor: 0,
  };
}

function closedState(): State {
  return {
    project: Object.freeze({
      projectId: null, sessionId: newSession(), graphId: '', revision: 0,
      bindingSetId: '', bindingRevision: 0, sessionOnly: true, status: 'closed',
    }),
    graph: Object.freeze({ graphId: '', revision: 0, sequence: EMPTY_SEQUENCE }),
    assets: Object.freeze([]),
    binding: Object.freeze({ bindingSetId: '', revision: 0, byAssetId: Object.freeze({}) }),
    change: Object.freeze({ state: 'closed' }), target: null, result: null, clipboard: null,
    sourceMarkers: Object.freeze([]), profiles: Object.freeze([]), journal: Object.freeze([]), cursor: 0,
  };
}

function history(state: State): HistoryView {
  return Object.freeze({
    revision: state.graph.revision,
    canUndo: state.project.status === 'ready' && state.cursor > 0,
    canRedo: state.project.status === 'ready' && state.cursor < state.journal.length,
    undoLabel: state.journal[state.cursor - 1]?.label,
    redoLabel: state.journal[state.cursor]?.label,
  });
}

function isFrame(value: number): boolean { return Number.isSafeInteger(value) && value >= 0; }
function sourceMarkersInSpan(sets: readonly SourceMarkerSet[], asset: AssetRecord,
  sourceIn: number, sourceOut: number): readonly ClipMarker[] {
  return Object.freeze((sets.find((set) => set.assetId === asset.id && set.assetVersion === asset.version &&
    set.fingerprint === asset.fingerprint)?.markers ?? []).filter((marker) =>
    sourceIn <= marker.sourceFrame && marker.sourceFrame < sourceOut));
}
function replaceSourceMarkerSet(sets: readonly SourceMarkerSet[], asset: AssetRecord,
  markers: readonly ClipMarker[]): readonly SourceMarkerSet[] {
  const next: SourceMarkerSet = Object.freeze({ assetId: asset.id, assetVersion: asset.version,
    fingerprint: asset.fingerprint, markers: Object.freeze([...markers]) });
  return Object.freeze([...sets.filter((set) => set.assetId !== asset.id), next]);
}
function validSourceMarkers(sets: readonly SourceMarkerSet[], assets: readonly AssetRecord[]): boolean {
  const assetIds = new Set<string>();
  for (const set of sets) {
    const asset = assets.find((item) => item.id === set.assetId && item.version === set.assetVersion &&
      item.fingerprint === set.fingerprint);
    if (!asset || assetIds.has(set.assetId)) return false;
    assetIds.add(set.assetId);
    const markerIds = new Set<string>();
    const frames = new Set<number>();
    for (const marker of set.markers) {
      if (!marker.id || markerIds.has(marker.id) || frames.has(marker.sourceFrame) || !isFrame(marker.sourceFrame) ||
        marker.sourceFrame >= asset.frameCount || typeof marker.label !== 'string' || marker.label.length > 80 ||
        !['red', 'green', 'blue', 'yellow'].includes(marker.color)) return false;
      markerIds.add(marker.id);
      frames.add(marker.sourceFrame);
    }
  }
  return true;
}
function videoTrackId(trackId: string): string {
  return trackId.replace(/^a(\d+)$/, 'v$1');
}
function audioTrackId(trackId: string): string {
  return trackId.replace(/^v(\d+)$/, 'a$1');
}
function withAudioTracks(seq: SequenceView, assets: readonly AssetRecord[]): SequenceView {
  const videos: SequenceTrack[] = seq.tracks.filter((track) => track.kind === 'video').map((track) => Object.freeze({
    ...track, clips: Object.freeze(track.clips.map((clip) => {
      const hasAudio = assets.find((asset) => asset.id === clip.assetId)?.hasAudio === true;
      return Object.freeze({ ...clip, linkedClipId: hasAudio ? `audio-${clip.id}` : undefined });
    })),
  }));
  const audio = videos.map((track) => {
    const id = audioTrackId(track.id);
    const existing = seq.tracks.find((item) => item.id === id);
    return Object.freeze({
      id, label: id.toUpperCase(), kind: 'audio' as const, locked: existing?.locked ?? false,
      muted: existing?.muted ?? false,
      clips: Object.freeze(track.clips.filter((clip) => clip.linkedClipId).map((clip) => Object.freeze({
        ...clip, id: clip.linkedClipId!, linkedClipId: clip.id,
      }))),
    });
  });
  return Object.freeze({ ...seq, tracks: Object.freeze([...videos, ...audio]) });
}
function videoSelection(seq: SequenceView, trackId: string, clipId: string):
  { track: SequenceTrack; clip: SequenceClip } | null {
  const source = seq.tracks.find((track) => track.id === trackId);
  const selected = source?.clips.find((clip) => clip.id === clipId);
  const track = seq.tracks.find((item) => item.id === videoTrackId(trackId));
  const clip = track?.clips.find((item) => item.id ===
    (source?.kind === 'audio' ? selected?.linkedClipId : clipId));
  return track && clip ? { track, clip } : null;
}
function linkedTrackLocked(seq: SequenceView, trackId: string, clip: SequenceClip): boolean {
  return Boolean(clip.linkedClipId && seq.tracks.find((track) =>
    track.id === audioTrackId(videoTrackId(trackId)))?.locked);
}
function sameTarget(a: InsertTarget, b: InsertTarget): boolean {
  return a.projectId === b.projectId && a.graphId === b.graphId &&
    a.sequenceId === b.sequenceId && a.trackId === b.trackId &&
    a.frame === b.frame && a.ownerTabId === b.ownerTabId;
}

function validateSequence(seq: SequenceView, assets: readonly AssetRecord[]): boolean {
  if (!isFrame(seq.durationFrames) || seq.frameRate.num !== 24 || seq.frameRate.den !== 1 ||
    !seq.tracks.some((track) => track.kind === 'video')) return false;
  const ids = new Set<string>();
  const trackIds = new Set<string>();
  for (const track of seq.tracks) {
    if (!track.id || trackIds.has(track.id) || !track.label ||
      (track.kind !== 'video' && track.kind !== 'audio') ||
      (track.kind === 'video' && (track.muted !== undefined ||
        track.hidden !== undefined && typeof track.hidden !== 'boolean')) ||
      (track.kind === 'audio' && (track.hidden !== undefined ||
        track.muted !== undefined && typeof track.muted !== 'boolean'))) return false;
    trackIds.add(track.id);
    let previousEnd = 0;
    for (const clip of track.clips) {
      const source = assets.find((item) => item.id === clip.assetId && item.status === 'ready');
      if (!clip.id || ids.has(clip.id) || !source || !isFrame(clip.sourceIn) ||
          !isFrame(clip.sourceOut) || clip.sourceOut <= clip.sourceIn ||
          clip.sourceOut > source.frameCount || !isFrame(clip.timelineIn) ||
          !isFrame(clip.timelineOut) || clip.timelineOut <= clip.timelineIn ||
          clip.timelineIn < previousEnd || clip.timelineOut > seq.durationFrames ||
          clip.sourceOut - clip.sourceIn !== clip.timelineOut - clip.timelineIn) return false;
      if (clip.effects !== undefined && !validEffects(clip.effects)) return false;
      const markerIds = new Set<string>();
      for (const marker of clip.markers ?? []) {
        if (!marker.id || markerIds.has(marker.id) || !isFrame(marker.sourceFrame) ||
          marker.sourceFrame >= source.frameCount || typeof marker.label !== 'string' || marker.label.length > 80 ||
          !['red', 'green', 'blue', 'yellow'].includes(marker.color)) return false;
        markerIds.add(marker.id);
      }
      const keyframeIds = new Set<string>();
      const keyframeFrames = new Set<number>();
      for (const keyframe of clip.keyframes ?? []) {
        if (!keyframe.id || keyframeIds.has(keyframe.id) || !isFrame(keyframe.sourceFrame) ||
          keyframe.sourceFrame >= source.frameCount || keyframeFrames.has(keyframe.sourceFrame) ||
          keyframe.effects !== undefined && !validEffects(keyframe.effects)) return false;
        keyframeIds.add(keyframe.id);
        keyframeFrames.add(keyframe.sourceFrame);
      }
      ids.add(clip.id);
      previousEnd = clip.timelineOut;
    }
  }
  const canonical = withAudioTracks(seq, assets);
  if (canonical.tracks.length !== seq.tracks.length) return false;
  for (let index = 0; index < seq.tracks.length; index++) {
    const actual = seq.tracks[index];
    const expected = canonical.tracks[index];
    if (actual.id !== expected.id || actual.kind !== expected.kind ||
      actual.clips.length !== expected.clips.length) return false;
    for (let clipIndex = 0; clipIndex < actual.clips.length; clipIndex++) {
      const clip = actual.clips[clipIndex];
      const paired = expected.clips[clipIndex];
      if (clip.id !== paired.id || clip.linkedClipId !== paired.linkedClipId ||
        clip.assetId !== paired.assetId || clip.sourceIn !== paired.sourceIn ||
        clip.sourceOut !== paired.sourceOut || clip.timelineIn !== paired.timelineIn ||
        clip.timelineOut !== paired.timelineOut ||
        (clip.effects === undefined) !== (paired.effects === undefined) ||
        clip.effects && paired.effects && !sameEffects(clip.effects, paired.effects)) return false;
      const actualMarkers = clip.markers ?? [];
      const pairedMarkers = paired.markers ?? [];
      if (actualMarkers.length !== pairedMarkers.length || actualMarkers.some((marker, index) =>
        marker.id !== pairedMarkers[index].id || marker.sourceFrame !== pairedMarkers[index].sourceFrame ||
        marker.label !== pairedMarkers[index].label || marker.color !== pairedMarkers[index].color)) return false;
      const actualKeyframes = clip.keyframes ?? [];
      const pairedKeyframes = paired.keyframes ?? [];
      if (actualKeyframes.length !== pairedKeyframes.length || actualKeyframes.some((keyframe, index) =>
        keyframe.id !== pairedKeyframes[index].id || keyframe.sourceFrame !== pairedKeyframes[index].sourceFrame ||
        (keyframe.effects === undefined) !== (pairedKeyframes[index].effects === undefined) ||
        keyframe.effects && pairedKeyframes[index].effects &&
          !sameEffects(keyframe.effects, pairedKeyframes[index].effects))) return false;
    }
  }
  return true;
}

function prepareSequence(seq: SequenceView | null, assets: readonly AssetRecord[]): SequenceView | null {
  if (!seq) return null;
  const paired = withAudioTracks(seq, assets);
  return validateSequence(paired, assets) ? paired : null;
}

function rippleInsert(
  seq: SequenceView, trackId: string, frame: number, source: AssetRecord,
  sourceIn: number, sourceOut: number, insertedId: string, splitId: string,
  markers: readonly ClipMarker[] = [],
): SequenceView | null {
  const duration = sourceOut - sourceIn;
  const track = seq.tracks.find((item) => item.id === trackId);
  if (!track || track.locked || track.kind !== 'video' ||
      !isFrame(frame) || frame > seq.durationFrames ||
      !Number.isSafeInteger(seq.durationFrames + duration)) return null;
  const tracks = seq.tracks.map((row) => {
    if (row.locked && row.clips.some((clip) => clip.timelineOut > frame)) return null;
    const clips: SequenceClip[] = [];
    for (const clip of row.clips) {
      if (clip.timelineOut <= frame) clips.push(clip);
      else if (clip.timelineIn >= frame) clips.push(Object.freeze({
        ...clip, timelineIn: clip.timelineIn + duration, timelineOut: clip.timelineOut + duration,
      }));
      else {
        const leftDuration = frame - clip.timelineIn;
        clips.push(Object.freeze({ ...clip, sourceOut: clip.sourceIn + leftDuration, timelineOut: frame,
          markers: clip.markers?.filter((marker) => marker.sourceFrame < clip.sourceIn + leftDuration),
          keyframes: clip.keyframes?.filter((keyframe) => keyframe.sourceFrame < clip.sourceIn + leftDuration) }));
        clips.push(Object.freeze({
          ...clip, id: `${splitId}-${row.id}`, sourceIn: clip.sourceIn + leftDuration,
          timelineIn: frame + duration, timelineOut: clip.timelineOut + duration,
          markers: clip.markers?.filter((marker) => marker.sourceFrame >= clip.sourceIn + leftDuration),
          keyframes: clip.keyframes?.filter((keyframe) => keyframe.sourceFrame >= clip.sourceIn + leftDuration),
        }));
      }
    }
    if (row.id === trackId) clips.push(Object.freeze({
      id: insertedId, assetId: source.id, sourceIn, sourceOut,
      timelineIn: frame, timelineOut: frame + duration, markers,
    }));
    clips.sort((a, b) => a.timelineIn - b.timelineIn);
    return Object.freeze({ ...row, clips: Object.freeze(clips) });
  });
  if (tracks.some((row) => row === null)) return null;
  const next: SequenceView = Object.freeze({
    ...seq, durationFrames: seq.durationFrames + duration,
    tracks: Object.freeze(tracks as SequenceTrack[]),
  });
  return next;
}

function nextTrackId(seq: SequenceView): string {
  const max = seq.tracks.reduce((value, track) => {
    const match = /^v(\d+)$/.exec(track.id);
    return match ? Math.max(value, Number(match[1])) : value;
  }, 0);
  return `v${max + 1}`;
}

function placeSpan(seq: SequenceView, trackId: string, frame: number, source: AssetRecord,
  sourceIn: number, sourceOut: number, clipId: string, markers: readonly ClipMarker[] = [],
  keyframes: readonly ClipKeyframe[] = [], effects?: ClipEffectsState): SequenceView | null {
  const track = seq.tracks.find((item) => item.id === trackId);
  const end = frame + sourceOut - sourceIn;
  if (!track || track.locked || source.hasAudio && seq.tracks.find((item) =>
    item.id === audioTrackId(trackId))?.locked || !isFrame(frame) || !Number.isSafeInteger(end)) return null;
  const clip: SequenceClip = Object.freeze({ id: clipId, assetId: source.id, sourceIn, sourceOut,
    timelineIn: frame, timelineOut: end, markers: Object.freeze([...markers]),
    keyframes: Object.freeze([...keyframes]), effects });
  const overlap = track.clips.some((item) => item.timelineIn < end && frame < item.timelineOut);
  const tracks = overlap ? Object.freeze([...seq.tracks, Object.freeze({
    id: nextTrackId(seq), label: nextTrackId(seq).toUpperCase(), kind: 'video' as const,
    locked: false, clips: Object.freeze([clip]),
  })]) : Object.freeze(seq.tracks.map((item) => item.id === trackId ? Object.freeze({
    ...item, clips: Object.freeze([...item.clips, clip].sort((a, b) => a.timelineIn - b.timelineIn)),
  }) : item));
  return Object.freeze({ ...seq, durationFrames: Math.max(seq.durationFrames, end), tracks });
}

function moveClip(seq: SequenceView, sourceTrackId: string, clipId: string,
  targetTrackId: string, frame: number): SequenceView | null {
  const sourceTrack = seq.tracks.find((item) => item.id === sourceTrackId);
  const targetTrack = seq.tracks.find((item) => item.id === targetTrackId);
  const clip = sourceTrack?.clips.find((item) => item.id === clipId);
  if (!sourceTrack || !targetTrack || !clip || sourceTrack.locked || targetTrack.locked ||
    linkedTrackLocked(seq, sourceTrackId, clip) || linkedTrackLocked(seq, targetTrackId, clip) ||
    !isFrame(frame)) return null;
  const end = frame + clip.timelineOut - clip.timelineIn;
  if (!Number.isSafeInteger(end)) return null;
  const moved = Object.freeze({ ...clip, timelineIn: frame, timelineOut: end });
  const withoutSource = seq.tracks.map((track) => track.id === sourceTrackId ? Object.freeze({
    ...track, clips: Object.freeze(track.clips.filter((item) => item.id !== clipId)),
  }) : track);
  const destination = withoutSource.find((item) => item.id === targetTrackId)!;
  const overlap = destination.clips.some((item) => item.timelineIn < end && frame < item.timelineOut);
  const tracks = overlap ? Object.freeze([...withoutSource, Object.freeze({
    id: nextTrackId(seq), label: nextTrackId(seq).toUpperCase(), kind: 'video' as const,
    locked: false, clips: Object.freeze([moved]),
  })]) : Object.freeze(withoutSource.map((track) => track.id === targetTrackId ? Object.freeze({
    ...track, clips: Object.freeze([...track.clips, moved].sort((a, b) => a.timelineIn - b.timelineIn)),
  }) : track));
  return Object.freeze({ ...seq, durationFrames: Math.max(seq.durationFrames, end), tracks });
}

function trimClip(seq: SequenceView, intent: TrimTimelineClip): SequenceView | null {
  const track = seq.tracks.find((item) => item.id === intent.trackId);
  const clip = track?.clips.find((item) => item.id === intent.clipId);
  if (!track || track.locked || !clip || linkedTrackLocked(seq, track.id, clip) ||
    !isFrame(intent.frame)) return null;
  const delta = intent.frame - (intent.edge === 'in' ? clip.timelineIn : clip.timelineOut);
  const trimmed = intent.edge === 'in'
    ? Object.freeze({ ...clip, timelineIn: intent.frame, sourceIn: clip.sourceIn + delta })
    : Object.freeze({ ...clip, timelineOut: intent.frame, sourceOut: clip.sourceOut + delta });
  const tracks = Object.freeze(seq.tracks.map((row) => row.id === track.id ? Object.freeze({
    ...row, clips: Object.freeze(row.clips.map((item) => item.id === clip.id ? trimmed : item)),
  }) : row));
  return Object.freeze({ ...seq, durationFrames: Math.max(seq.durationFrames, trimmed.timelineOut), tracks });
}

function liftClip(seq: SequenceView, trackId: string, clipId: string): SequenceView {
  return Object.freeze({ ...seq, tracks: Object.freeze(seq.tracks.map((track) => track.id === trackId ?
    Object.freeze({ ...track, clips: Object.freeze(track.clips.filter((clip) => clip.id !== clipId)) }) : track)) });
}

function setClipMarkers(seq: SequenceView, trackId: string, clipId: string,
  markers: readonly ClipMarker[]): SequenceView {
  return Object.freeze({ ...seq, tracks: Object.freeze(seq.tracks.map((track) => track.id === trackId ?
    Object.freeze({ ...track, clips: Object.freeze(track.clips.map((clip) => clip.id === clipId ?
      Object.freeze({ ...clip, markers: Object.freeze(markers) }) : clip)) }) : track)) });
}

function setClipKeyframes(seq: SequenceView, trackId: string, clipId: string,
  keyframes: readonly ClipKeyframe[]): SequenceView {
  return Object.freeze({ ...seq, tracks: Object.freeze(seq.tracks.map((track) => track.id === trackId ?
    Object.freeze({ ...track, clips: Object.freeze(track.clips.map((clip) => clip.id === clipId ?
      Object.freeze({ ...clip, keyframes: Object.freeze(keyframes) }) : clip)) }) : track)) });
}

function withClipEffects(seq: SequenceView, trackId: string, clipId: string,
  keyframeId: string | null, effects: ClipEffectsState): SequenceView {
  return Object.freeze({ ...seq, tracks: Object.freeze(seq.tracks.map((track) => track.id === trackId ?
    Object.freeze({ ...track, clips: Object.freeze(track.clips.map((clip) => {
      if (clip.id !== clipId) return clip;
      if (keyframeId === null) return Object.freeze({ ...clip, effects: Object.freeze({ ...effects }) });
      return Object.freeze({ ...clip, keyframes: Object.freeze((clip.keyframes ?? []).map((keyframe) =>
        keyframe.id === keyframeId ? Object.freeze({ ...keyframe, effects: Object.freeze({ ...effects }) }) : keyframe)) });
    })) }) : track)) });
}

export function rippleDeleteSpan(seq: SequenceView, start: number, end: number,
  splitId: string): SequenceView | null {
  if (!isFrame(start) || !isFrame(end) || start >= end || end > seq.durationFrames) return null;
  const duration = end - start;
  const tracks = seq.tracks.map((track) => {
    if (track.locked && track.clips.some((clip) => clip.timelineOut > start)) return null;
    const clips: SequenceClip[] = [];
    for (const clip of track.clips) {
      if (clip.timelineOut <= start) clips.push(clip);
      else if (clip.timelineIn >= end) clips.push(Object.freeze({ ...clip,
        timelineIn: clip.timelineIn - duration, timelineOut: clip.timelineOut - duration }));
      else {
        const left = clip.timelineIn < start;
        if (left) clips.push(Object.freeze({ ...clip,
          sourceOut: clip.sourceIn + start - clip.timelineIn, timelineOut: start,
          markers: clip.markers?.filter((marker) => marker.sourceFrame < clip.sourceIn + start - clip.timelineIn),
          keyframes: clip.keyframes?.filter((keyframe) => keyframe.sourceFrame < clip.sourceIn + start - clip.timelineIn) }));
        if (clip.timelineOut > end) clips.push(Object.freeze({ ...clip,
          id: left ? `${splitId}-${track.id}-${clip.id}` : clip.id,
          sourceIn: clip.sourceOut - (clip.timelineOut - end),
          timelineIn: start, timelineOut: clip.timelineOut - duration,
          markers: clip.markers?.filter((marker) => marker.sourceFrame >= clip.sourceOut - (clip.timelineOut - end)),
          keyframes: clip.keyframes?.filter((keyframe) => keyframe.sourceFrame >= clip.sourceOut - (clip.timelineOut - end)) }));
      }
    }
    return Object.freeze({ ...track, clips: Object.freeze(clips) });
  });
  if (tracks.some((track) => track === null)) return null;
  return Object.freeze({ ...seq, durationFrames: seq.durationFrames - duration,
    tracks: Object.freeze(tracks as SequenceTrack[]) });
}

// One root producer publishes every accepted projection together before an edit promise settles.
class MockEditorRootTap extends BaseTap {
  private state: State = initialState('mock-a');
  private commandSerial = 0;
  private clipSerial = 0;
  private markerSerial = 0;
  private keyframeSerial = 0;
  private profileSerial = 0;
  private knownLinks: readonly TabLinkInfo[] | null = null;
  private readonly projectControl: ProjectControl = {
    open: (id, options) => this.open(id, options?.discardSessionEdits === true),
    close: (options) => this.close(options?.discardSessionEdits === true),
  };
  private readonly targetControl: InsertTargetControl = {
    set: (target) => this.setTarget(target), clear: (owner) => this.clearTarget(owner),
  };
  private readonly editorControl: EditorControl = {
    insert: (intent) => this.insert(intent), place: (intent) => this.place(intent),
    addTrack: (intent) => this.addTrack(intent), deleteTrack: (intent) => this.deleteTrack(intent),
    setVideoHidden: (intent) => this.setVideoHidden(intent),
    setAudioMuted: (intent) => this.setAudioMuted(intent),
    copyClip: (intent) => this.copyClip(intent), cutClip: (intent) => this.cutClip(intent),
    pasteClip: (intent) => this.pasteClip(intent),
    deleteClip: (intent) => this.deleteClip(intent), splitClip: (intent) => this.splitClip(intent),
    moveClip: (intent) => this.moveClip(intent), trimClip: (intent) => this.trimClip(intent),
    addClipMarker: (intent) => this.addClipMarker(intent),
    updateClipMarker: (intent) => this.updateClipMarker(intent),
    addClipKeyframe: (intent) => this.addClipKeyframe(intent),
    deleteClipKeyframe: (intent) => this.deleteClipKeyframe(intent),
    setClipEffects: (intent) => this.setClipEffects(intent),
    saveEffectsProfile: (intent) => this.saveEffectsProfile(intent),
    applyEffectsProfile: (intent) => this.applyEffectsProfile(intent),
    addSourceMarker: (intent) => this.addSourceMarker(intent),
    updateSourceMarker: (intent) => this.updateSourceMarker(intent),
  };
  private readonly historyControl: HistoryControl = {
    undo: () => this.moveHistory('undo'), redo: () => this.moveHistory('redo'),
  };

  constructor() {
    super({ provides: [
      GVID_DEST_PROJECT_ID, GVID_PROJECT_VIEW, GVID_PROJECT_CONTROL,
      GVID_GRAPH_VIEW, GVID_SEQUENCE_VIEW, GVID_CHANGE_STATUS,
      GVID_ASSET_CATALOG, GVID_BINDING_VIEW, GVID_SOURCE_MARKER_CATALOG,
      GVID_ACTIVE_INSERT_TARGET, GVID_ACTIVE_INSERT_TARGET_CONTROL,
      GVID_EDIT_COMMAND, GVID_EDIT_RESULT, GVID_HISTORY_VIEW, GVID_HISTORY_CONTROL,
      GVID_EFFECT_PROFILES,
    ], homeParamGrips: [DESKTOP_TAB_LINKS] });
  }

  produceOnParams(): void {
    if (this.state.target && !this.isTimelineOwner(this.state.target.ownerTabId)) {
      this.clearTarget(this.state.target.ownerTabId);
    }
  }

  produceOnDestParams(): void {}

  private currentLinks(): readonly TabLinkInfo[] | null {
    const links = this.paramDrips.get(DESKTOP_TAB_LINKS)?.get() as TabLinkInfo[] | undefined;
    if (links && (links.length > 0 || this.knownLinks !== null)) this.knownLinks = links;
    return this.knownLinks;
  }

  private isTimelineOwner(tabId: string): boolean {
    return this.currentLinks()?.some((link) =>
      link.tabId === tabId && link.toolId === GVID_TOOLS.timeline) ?? false;
  }

  produce(opts?: { destContext?: GripContext }): void {
    const updates = new Map<Grip<unknown>, unknown>();
    const put = <T>(grip: Grip<T>, value: T): void => { updates.set(grip as Grip<unknown>, value); };
    put(GVID_DEST_PROJECT_ID, this.state.project.projectId);
    put(GVID_PROJECT_VIEW, this.state.project);
    put(GVID_PROJECT_CONTROL, this.projectControl);
    put(GVID_GRAPH_VIEW, this.state.graph);
    put(GVID_SEQUENCE_VIEW, this.state.graph.sequence);
    put(GVID_CHANGE_STATUS, this.state.change);
    put(GVID_ASSET_CATALOG, this.state.assets);
    put(GVID_SOURCE_MARKER_CATALOG, this.state.sourceMarkers);
    put(GVID_EFFECT_PROFILES, this.state.profiles);
    put(GVID_BINDING_VIEW, this.state.binding);
    put(GVID_ACTIVE_INSERT_TARGET, this.state.target);
    put(GVID_ACTIVE_INSERT_TARGET_CONTROL, this.targetControl);
    put(GVID_EDIT_COMMAND, this.editorControl);
    put(GVID_EDIT_RESULT, this.state.result);
    put(GVID_HISTORY_VIEW, history(this.state));
    put(GVID_HISTORY_CONTROL, this.historyControl);
    this.publish(updates, opts?.destContext);
  }

  private commit(next: State): void { this.state = next; this.produce(); }

  private open(id: string, discardSessionEdits: boolean): ProjectTransitionResult {
    if (id !== 'mock-a' && id !== 'mock-b') throw new RangeError(`Unknown mock project: ${id}`);
    if (this.state.journal.length > 0 && !discardSessionEdits) {
      return { status: 'confirmation-required', message: 'Opening a project will discard session-only edits.' };
    }
    this.clipSerial = 0;
    this.markerSerial = 0;
    this.keyframeSerial = 0;
    this.profileSerial = 0;
    this.commit(initialState(id));
    return { status: 'opened', message: `Opened ${id}; session only.` };
  }
  private close(discardSessionEdits: boolean): ProjectTransitionResult {
    if (this.state.journal.length > 0 && !discardSessionEdits) {
      return { status: 'confirmation-required', message: 'Closing the project will discard session-only edits.' };
    }
    this.clipSerial = 0;
    this.markerSerial = 0;
    this.keyframeSerial = 0;
    this.profileSerial = 0;
    this.commit(closedState());
    return { status: 'closed', message: 'Project closed.' };
  }

  private validTarget(target: InsertTarget): boolean {
    const { project, graph } = this.state;
    const track = graph.sequence.tracks.find((item) => item.id === target.trackId);
    return project.status === 'ready' && this.state.change.state === 'live' &&
      target.projectId === project.projectId && target.graphId === graph.graphId &&
      target.sequenceId === graph.sequence.id && Boolean(target.ownerTabId) &&
      Boolean(track && !track.locked && track.kind === 'video') &&
      this.isTimelineOwner(target.ownerTabId) &&
      isFrame(target.frame) && target.frame <= graph.sequence.durationFrames;
  }
  private setTarget(target: InsertTarget): void {
    this.commit({ ...this.state, target: this.validTarget(target) ? Object.freeze({ ...target }) : null });
  }
  private clearTarget(owner?: string): void {
    if (owner === undefined || this.state.target?.ownerTabId === owner) {
      this.commit({ ...this.state, target: null });
    }
  }

  private makeResult(status: EditorResult['status'], message: string,
    revision = this.state.graph.revision, footprint?: ChangeFootprint): EditorResult {
    this.commandSerial += 1;
    return Object.freeze({ status, revision, message, commandId: `mock-command-${this.commandSerial}`,
      ...(footprint ? { footprint } : {}) });
  }
  private reject(message: string): Promise<EditorResult> {
    const result = this.makeResult('rejected', message);
    this.commit({ ...this.state, result });
    return Promise.resolve(result);
  }
  private accept(seq: SequenceView, journal: readonly JournalEntry[], cursor: number,
    fromFrame: number, message: string, clipboard = this.state.clipboard,
    sourceMarkers = this.state.sourceMarkers, profiles = this.state.profiles): Promise<EditorResult> {
    const revision = this.state.graph.revision + 1;
    const accepted = Object.freeze({ ...seq, revision });
    const footprint: ChangeFootprint = Object.freeze({
      graphId: this.state.graph.graphId, sequenceId: accepted.id, revision,
      fromFrame, toFrameExclusive: Math.max(this.state.graph.sequence.durationFrames, accepted.durationFrames),
    });
    const result = this.makeResult('accepted-session-only', message, revision, footprint);
    const project = Object.freeze({ ...this.state.project, revision });
    const graph = Object.freeze({ graphId: this.state.graph.graphId, revision, sequence: accepted });
    const target = this.state.target && this.state.target.frame <= accepted.durationFrames &&
      accepted.tracks.some((track) => track.id === this.state.target?.trackId) ? this.state.target : null;
    this.commit({ ...this.state, project, graph, target, result, journal, cursor,
      clipboard, sourceMarkers, profiles });
    return Promise.resolve(result);
  }

  private insert(intent: InsertSourceSpan): Promise<EditorResult> {
    const { project, graph, assets, binding, target } = this.state;
    if (project.status !== 'ready' || this.state.change.state !== 'live') return this.reject('Project is closed or stale.');
    if (intent.projectId !== project.projectId || intent.sessionId !== project.sessionId ||
        intent.expectedRevision !== graph.revision || intent.bindingSetId !== binding.bindingSetId) {
      return this.reject('Project, session, graph revision, or binding set is stale.');
    }
    if (!target || !sameTarget(intent.target, target) || !this.validTarget(target)) {
      return this.reject('Insert target is missing or no longer current.');
    }
    const source = assets.find((item) => item.id === intent.assetId);
    if (!source || source.status !== 'ready' || source.version !== intent.assetVersion ||
        !binding.byAssetId[source.id] || !isFrame(intent.sourceIn) ||
        !isFrame(intent.sourceOut) || intent.sourceOut <= intent.sourceIn ||
        intent.sourceOut > source.frameCount) return this.reject('Source span or asset version is invalid.');
    if (source.frameRate.num !== 24 || source.frameRate.den !== 1 ||
        graph.sequence.frameRate.num !== 24 || graph.sequence.frameRate.den !== 1) {
      return this.reject('Source duration cannot be placed exactly on the sequence frame grid.');
    }
    const serial = this.clipSerial + 1;
    const next = rippleInsert(graph.sequence, target.trackId, target.frame, source,
      intent.sourceIn, intent.sourceOut, `insert-${serial}`, `split-${serial}`,
      sourceMarkersInSpan(this.state.sourceMarkers, source, intent.sourceIn, intent.sourceOut));
    const paired = prepareSequence(next, assets);
    if (!paired) return this.reject('Insert would create an invalid or locked track.');
    this.clipSerial = serial;
    const entry: JournalEntry = Object.freeze({ before: graph.sequence, after: paired,
      fromFrame: target.frame, label: 'Insert source span' });
    const journal = Object.freeze([...this.state.journal.slice(0, this.state.cursor), entry]);
    return this.accept(paired, journal, journal.length, target.frame,
      `Inserted ${intent.sourceOut - intent.sourceIn} frames at ${target.frame}; session only.`);
  }

  private validEditScope(intent: TimelineEditScope): boolean {
    const { project, graph, change } = this.state;
    return project.status === 'ready' && change.state === 'live' &&
      intent.projectId === project.projectId && intent.sessionId === project.sessionId &&
      intent.expectedRevision === graph.revision && intent.sequenceId === graph.sequence.id;
  }

  private addTrack(intent: TimelineEditScope): Promise<EditorResult> {
    if (!this.validEditScope(intent)) return this.reject('Project, session, or graph revision is stale.');
    const seq = this.state.graph.sequence;
    const id = nextTrackId(seq);
    const next = prepareSequence(Object.freeze({ ...seq, tracks: Object.freeze([...seq.tracks, Object.freeze({
      id, label: id.toUpperCase(), kind: 'video' as const, locked: false, clips: Object.freeze([]),
    })]) }), this.state.assets);
    if (!next) return this.reject('Track could not be added.');
    const entry: JournalEntry = Object.freeze({ before: seq, after: next, fromFrame: 0, label: 'Add track' });
    const journal = Object.freeze([...this.state.journal.slice(0, this.state.cursor), entry]);
    return this.accept(next, journal, journal.length, 0, `Added ${id.toUpperCase()}; session only.`);
  }

  private deleteTrack(intent: DeleteTrack): Promise<EditorResult> {
    if (!this.validEditScope(intent)) return this.reject('Project, session, or graph revision is stale.');
    const seq = this.state.graph.sequence;
    const track = seq.tracks.find((item) => item.id === videoTrackId(intent.trackId));
    if (!track || seq.tracks.filter((item) => item.kind === 'video').length <= 1) {
      return this.reject('At least one video/audio track pair must remain.');
    }
    const next = prepareSequence(Object.freeze({ ...seq, tracks: Object.freeze(seq.tracks.filter((item) =>
      item.id !== track.id && item.id !== audioTrackId(track.id))) }), this.state.assets);
    if (!next) return this.reject('Track could not be deleted.');
    const entry: JournalEntry = Object.freeze({ before: seq, after: next, fromFrame: 0, label: 'Delete track' });
    const journal = Object.freeze([...this.state.journal.slice(0, this.state.cursor), entry]);
    return this.accept(next, journal, journal.length, 0, `Deleted ${track.label} and its clips; session only.`);
  }

  private setVideoHidden(intent: SetVideoHidden): Promise<EditorResult> {
    if (!this.validEditScope(intent)) return this.reject('Project, session, or graph revision is stale.');
    const seq = this.state.graph.sequence;
    const track = seq.tracks.find((item) => item.id === intent.trackId && item.kind === 'video');
    if (!track || typeof intent.hidden !== 'boolean') return this.reject('Video track visibility is invalid.');
    if (Boolean(track.hidden) === intent.hidden) return this.reject('Video track visibility is unchanged.');
    const next = prepareSequence(Object.freeze({ ...seq, tracks: Object.freeze(seq.tracks.map((item) =>
      item.id === track.id ? Object.freeze({ ...item, hidden: intent.hidden }) : item)) }), this.state.assets);
    if (!next) return this.reject('Video track visibility could not be changed.');
    const entry: JournalEntry = Object.freeze({ before: seq, after: next, fromFrame: 0,
      label: intent.hidden ? 'Hide video track' : 'Show video track' });
    const journal = Object.freeze([...this.state.journal.slice(0, this.state.cursor), entry]);
    return this.accept(next, journal, journal.length, 0,
      `${intent.hidden ? 'Hid' : 'Showed'} ${track.label}; session only.`);
  }

  private setAudioMuted(intent: SetAudioMuted): Promise<EditorResult> {
    if (!this.validEditScope(intent)) return this.reject('Project, session, or graph revision is stale.');
    const seq = this.state.graph.sequence;
    const track = seq.tracks.find((item) => item.id === intent.trackId && item.kind === 'audio');
    if (!track || typeof intent.muted !== 'boolean') return this.reject('Audio track mute is invalid.');
    if (Boolean(track.muted) === intent.muted) return this.reject('Audio track mute is unchanged.');
    const next = prepareSequence(Object.freeze({ ...seq, tracks: Object.freeze(seq.tracks.map((item) =>
      item.id === track.id ? Object.freeze({ ...item, muted: intent.muted }) : item)) }), this.state.assets);
    if (!next) return this.reject('Audio track mute could not be changed.');
    const entry: JournalEntry = Object.freeze({ before: seq, after: next, fromFrame: 0,
      label: intent.muted ? 'Mute audio track' : 'Unmute audio track' });
    const journal = Object.freeze([...this.state.journal.slice(0, this.state.cursor), entry]);
    return this.accept(next, journal, journal.length, 0,
      `${intent.muted ? 'Muted' : 'Unmuted'} ${track.label}; session only.`);
  }

  private selectedClip(intent: SelectedTimelineClip): { track: SequenceTrack; clip: SequenceClip; clipboard: ClipClipboard } | null {
    const selection = videoSelection(this.state.graph.sequence, intent.trackId, intent.clipId);
    const track = selection?.track;
    const clip = selection?.clip;
    const asset = this.state.assets.find((item) => item.id === clip?.assetId && item.status === 'ready');
    if (!track || !clip || !asset || !this.state.binding.byAssetId[asset.id]) return null;
    return { track, clip, clipboard: Object.freeze({
      projectId: this.state.project.projectId!, sessionId: this.state.project.sessionId,
      assetId: asset.id, assetVersion: asset.version, sourceIn: clip.sourceIn, sourceOut: clip.sourceOut,
      markers: Object.freeze([...(clip.markers ?? [])]),
      keyframes: Object.freeze([...(clip.keyframes ?? [])]),
      effects: clip.effects ?? NEUTRAL_EFFECTS,
    }) };
  }

  private copyClip(intent: SelectedTimelineClip): Promise<EditorResult> {
    if (!this.validEditScope(intent)) return this.reject('Project, session, or graph revision is stale.');
    const selected = this.selectedClip(intent);
    if (!selected) return this.reject('Selected clip is no longer available.');
    const result = this.makeResult('accepted-session-only', 'Copied clip; session only.');
    this.commit({ ...this.state, clipboard: selected.clipboard, result });
    return Promise.resolve(result);
  }

  private cutClip(intent: SelectedTimelineClip): Promise<EditorResult> {
    if (!this.validEditScope(intent)) return this.reject('Project, session, or graph revision is stale.');
    const selected = this.selectedClip(intent);
    if (!selected || selected.track.locked ||
      linkedTrackLocked(this.state.graph.sequence, selected.track.id, selected.clip)) {
      return this.reject('Selected clip cannot be cut.');
    }
    const seq = this.state.graph.sequence;
    const next = prepareSequence(liftClip(seq, selected.track.id, selected.clip.id), this.state.assets);
    if (!next) return this.reject('Clip could not be cut.');
    const entry: JournalEntry = Object.freeze({ before: seq, after: next,
      fromFrame: selected.clip.timelineIn, label: 'Cut clip' });
    const journal = Object.freeze([...this.state.journal.slice(0, this.state.cursor), entry]);
    return this.accept(next, journal, journal.length, selected.clip.timelineIn,
      'Cut clip; session only.', selected.clipboard);
  }

  private pasteClip(intent: PasteTimelineClip): Promise<EditorResult> {
    const { graph, assets, binding, clipboard } = this.state;
    if (!this.validEditScope(intent) || intent.target.projectId !== intent.projectId ||
      intent.target.graphId !== graph.graphId || intent.target.sequenceId !== intent.sequenceId ||
      !this.validTarget(intent.target)) return this.reject('Paste target is stale or not a live timeline.');
    if (!clipboard || clipboard.projectId !== intent.projectId || clipboard.sessionId !== intent.sessionId) {
      return this.reject('No clip is copied in this project session.');
    }
    const source = assets.find((item) => item.id === clipboard.assetId);
    if (!source || source.status !== 'ready' || source.version !== clipboard.assetVersion ||
      !binding.byAssetId[source.id] || clipboard.sourceOut > source.frameCount ||
      source.frameRate.num !== 24 || source.frameRate.den !== 1) {
      return this.reject('Copied clip source is no longer available.');
    }
    const frame = intent.target.frame;
    const serial = this.clipSerial + 1;
    const next = prepareSequence(placeSpan(graph.sequence, intent.target.trackId, frame, source,
      clipboard.sourceIn, clipboard.sourceOut, `paste-${serial}`, clipboard.markers, clipboard.keyframes,
      clipboard.effects), assets);
    if (!next) return this.reject('Clip cannot be pasted onto that track.');
    this.clipSerial = serial;
    const addedTrack = next.tracks.length > graph.sequence.tracks.length;
    const entry: JournalEntry = Object.freeze({ before: graph.sequence, after: next,
      fromFrame: frame, label: addedTrack ? 'Paste clip on new track' : 'Paste clip' });
    const journal = Object.freeze([...this.state.journal.slice(0, this.state.cursor), entry]);
    return this.accept(next, journal, journal.length, frame,
      `Pasted clip at ${frame}${addedTrack ? ' on a new track' : ''}; session only.`);
  }

  private deleteClip(intent: DeleteTimelineClip): Promise<EditorResult> {
    if (!this.validEditScope(intent)) return this.reject('Project, session, or graph revision is stale.');
    const seq = this.state.graph.sequence;
    const selection = videoSelection(seq, intent.trackId, intent.clipId);
    const track = selection?.track;
    const clip = selection?.clip;
    if (!track || track.locked || !clip || linkedTrackLocked(seq, track.id, clip)) {
      return this.reject('Selected clip cannot be deleted.');
    }
    const serial = this.clipSerial + 1;
    const next = prepareSequence(intent.ripple ? rippleDeleteSpan(seq, clip.timelineIn, clip.timelineOut, `ripple-${serial}`) :
      liftClip(seq, track.id, clip.id), this.state.assets);
    if (!next) {
      return this.reject('Ripple delete would change a locked track or invalidate the sequence.');
    }
    if (intent.ripple) this.clipSerial = serial;
    const label = intent.ripple ? 'Ripple delete clip' : 'Delete clip';
    const entry: JournalEntry = Object.freeze({ before: seq, after: next,
      fromFrame: clip.timelineIn, label });
    const journal = Object.freeze([...this.state.journal.slice(0, this.state.cursor), entry]);
    return this.accept(next, journal, journal.length, clip.timelineIn,
      `${label}; session only.`);
  }

  private splitClip(intent: SplitTimelineClip): Promise<EditorResult> {
    if (!this.validEditScope(intent)) return this.reject('Project, session, or graph revision is stale.');
    const seq = this.state.graph.sequence;
    const track = seq.tracks.find((item) => item.id === videoTrackId(intent.trackId));
    const clip = track?.clips.find((item) => item.timelineIn < intent.frame && intent.frame < item.timelineOut);
    if (!track || track.locked || !clip || linkedTrackLocked(seq, track.id, clip) ||
      !isFrame(intent.frame)) {
      return this.reject('No unlocked clip crosses the playhead on this track.');
    }
    const serial = this.clipSerial + 1;
    const offset = intent.frame - clip.timelineIn;
    const left = Object.freeze({ ...clip, sourceOut: clip.sourceIn + offset, timelineOut: intent.frame,
      markers: clip.markers?.filter((marker) => marker.sourceFrame < clip.sourceIn + offset),
      keyframes: clip.keyframes?.filter((keyframe) => keyframe.sourceFrame < clip.sourceIn + offset) });
    const right = Object.freeze({ ...clip, id: `split-${serial}`,
      sourceIn: clip.sourceIn + offset, timelineIn: intent.frame,
      markers: clip.markers?.filter((marker) => marker.sourceFrame >= clip.sourceIn + offset),
      keyframes: clip.keyframes?.filter((keyframe) => keyframe.sourceFrame >= clip.sourceIn + offset) });
    const next = prepareSequence(Object.freeze({ ...seq, tracks: Object.freeze(seq.tracks.map((row) => row.id === track.id ?
      Object.freeze({ ...row, clips: Object.freeze(row.clips.flatMap((item) =>
        item.id === clip.id ? [left, right] : [item])) }) : row)) }), this.state.assets);
    if (!next) return this.reject('Clip could not be split.');
    this.clipSerial = serial;
    const entry: JournalEntry = Object.freeze({ before: seq, after: next,
      fromFrame: intent.frame, label: 'Split clip' });
    const journal = Object.freeze([...this.state.journal.slice(0, this.state.cursor), entry]);
    return this.accept(next, journal, journal.length, intent.frame,
      `Split clip at ${intent.frame}; session only.`);
  }

  private place(intent: PlaceSourceSpan): Promise<EditorResult> {
    const { graph, assets, binding } = this.state;
    if (!this.validEditScope(intent) || intent.bindingSetId !== binding.bindingSetId) {
      return this.reject('Project, session, graph revision, or binding set is stale.');
    }
    if (intent.target.projectId !== intent.projectId || intent.target.graphId !== graph.graphId ||
      intent.target.sequenceId !== intent.sequenceId || !this.isTimelineOwner(intent.target.ownerTabId)) {
      return this.reject('Drop target is not a live timeline.');
    }
    const source = assets.find((item) => item.id === intent.assetId);
    if (!source || source.status !== 'ready' || source.version !== intent.assetVersion ||
      !binding.byAssetId[source.id] || !isFrame(intent.sourceIn) || !isFrame(intent.sourceOut) ||
      intent.sourceOut <= intent.sourceIn || intent.sourceOut > source.frameCount ||
      source.frameRate.num !== 24 || source.frameRate.den !== 1) {
      return this.reject('Source span or asset version is invalid.');
    }
    const frame = intent.target.frame;
    const serial = this.clipSerial + 1;
    const next = prepareSequence(placeSpan(graph.sequence, intent.target.trackId, frame, source,
      intent.sourceIn, intent.sourceOut, `place-${serial}`,
      sourceMarkersInSpan(this.state.sourceMarkers, source, intent.sourceIn, intent.sourceOut)), assets);
    if (!next) return this.reject('Drop would create an invalid or locked track.');
    this.clipSerial = serial;
    const addedTrack = next.tracks.length > graph.sequence.tracks.length;
    const entry: JournalEntry = Object.freeze({ before: graph.sequence, after: next,
      fromFrame: frame, label: addedTrack ? 'Place source on new track' : 'Place source span' });
    const journal = Object.freeze([...this.state.journal.slice(0, this.state.cursor), entry]);
    return this.accept(next, journal, journal.length, frame,
      `Placed ${intent.sourceOut - intent.sourceIn} frames at ${frame}${addedTrack ? ' on a new track' : ''}; session only.`);
  }

  private moveClip(intent: MoveTimelineClip): Promise<EditorResult> {
    const { graph, assets } = this.state;
    if (!this.validEditScope(intent) || intent.target.projectId !== intent.projectId ||
      intent.target.graphId !== graph.graphId || intent.target.sequenceId !== intent.sequenceId ||
      !this.isTimelineOwner(intent.target.ownerTabId)) {
      return this.reject('Clip move target is stale or not a live timeline.');
    }
    const selected = videoSelection(graph.sequence, intent.sourceTrackId, intent.clipId);
    const original = selected?.clip;
    if (!selected || !original) return this.reject('Clip is no longer on its source track.');
    const next = prepareSequence(moveClip(graph.sequence, selected.track.id, original.id,
      videoTrackId(intent.target.trackId), intent.target.frame), assets);
    if (!next) return this.reject('Clip cannot be moved onto that track.');
    if (selected.track.id === videoTrackId(intent.target.trackId) && original.timelineIn === intent.target.frame) {
      return this.reject('Clip is already at that position.');
    }
    const addedTrack = next.tracks.length > graph.sequence.tracks.length;
    const fromFrame = Math.min(original.timelineIn, intent.target.frame);
    const entry: JournalEntry = Object.freeze({ before: graph.sequence, after: next,
      fromFrame, label: addedTrack ? 'Move clip to new track' : 'Move clip' });
    const journal = Object.freeze([...this.state.journal.slice(0, this.state.cursor), entry]);
    return this.accept(next, journal, journal.length, fromFrame,
      `Moved clip to ${intent.target.frame}${addedTrack ? ' on a new track' : ''}; session only.`);
  }

  private trimClip(intent: TrimTimelineClip): Promise<EditorResult> {
    if (!this.validEditScope(intent)) return this.reject('Project, session, or graph revision is stale.');
    const seq = this.state.graph.sequence;
    const selected = videoSelection(seq, intent.trackId, intent.clipId);
    const original = selected?.clip;
    if (!original || (intent.edge !== 'in' && intent.edge !== 'out')) return this.reject('Clip trim target is invalid.');
    const oldFrame = intent.edge === 'in' ? original.timelineIn : original.timelineOut;
    if (oldFrame === intent.frame) return this.reject('Clip edge is already at that frame.');
    const next = prepareSequence(trimClip(seq, { ...intent, trackId: selected!.track.id,
      clipId: original.id }), this.state.assets);
    if (!next) {
      return this.reject('Clip trim exceeds the source or adjacent clip.');
    }
    const fromFrame = Math.min(oldFrame, intent.frame);
    const entry: JournalEntry = Object.freeze({ before: seq, after: next, fromFrame, label: 'Trim clip' });
    const journal = Object.freeze([...this.state.journal.slice(0, this.state.cursor), entry]);
    return this.accept(next, journal, journal.length, fromFrame,
      `Trimmed clip ${intent.edge} to ${intent.frame}; session only.`);
  }

  private addClipMarker(intent: AddClipMarker): Promise<EditorResult> {
    if (!this.validEditScope(intent)) return this.reject('Project, session, or graph revision is stale.');
    const seq = this.state.graph.sequence;
    const selected = videoSelection(seq, intent.trackId, intent.clipId);
    const track = selected?.track;
    const clip = selected?.clip;
    if (!track || !clip || track.locked || linkedTrackLocked(seq, track.id, clip) ||
      !isFrame(intent.frame) || intent.frame < clip.timelineIn || intent.frame >= clip.timelineOut) {
      return this.reject('Select an unlocked clip at the playhead to add a marker.');
    }
    const sourceFrame = clip.sourceIn + intent.frame - clip.timelineIn;
    if (clip.markers?.some((marker) => marker.sourceFrame === sourceFrame)) {
      return this.reject('This clip already has a marker at that frame.');
    }
    const serial = this.markerSerial + 1;
    const marker: ClipMarker = Object.freeze({ id: `marker-${serial}`, sourceFrame, label: '', color: 'red' });
    const next = prepareSequence(setClipMarkers(seq, track.id, clip.id, [...(clip.markers ?? []), marker]), this.state.assets);
    if (!next) return this.reject('Marker could not be added.');
    this.markerSerial = serial;
    const entry: JournalEntry = Object.freeze({ before: seq, after: next,
      fromFrame: intent.frame, label: 'Add clip marker' });
    const journal = Object.freeze([...this.state.journal.slice(0, this.state.cursor), entry]);
    return this.accept(next, journal, journal.length, intent.frame, `Added marker at frame ${intent.frame}; session only.`);
  }

  private updateClipMarker(intent: UpdateClipMarker): Promise<EditorResult> {
    if (!this.validEditScope(intent)) return this.reject('Project, session, or graph revision is stale.');
    const seq = this.state.graph.sequence;
    const selected = videoSelection(seq, intent.trackId, intent.clipId);
    const track = selected?.track;
    const clip = selected?.clip;
    const marker = clip?.markers?.find((item) => item.id === intent.markerId);
    if (!track || !clip || !marker || track.locked || linkedTrackLocked(seq, track.id, clip) ||
      typeof intent.label !== 'string' || intent.label.trim().length > 80 ||
      !['red', 'green', 'blue', 'yellow'].includes(intent.color)) {
      return this.reject('Marker edit is invalid or the clip is locked.');
    }
    const label = intent.label.trim();
    if (marker.label === label && marker.color === intent.color) return this.reject('Marker is unchanged.');
    const markers = clip.markers!.map((item) => item.id === marker.id ?
      Object.freeze({ ...item, label, color: intent.color }) : item);
    const next = prepareSequence(setClipMarkers(seq, track.id, clip.id, markers), this.state.assets);
    if (!next) return this.reject('Marker could not be updated.');
    const fromFrame = Math.max(0, clip.timelineIn + marker.sourceFrame - clip.sourceIn);
    const entry: JournalEntry = Object.freeze({ before: seq, after: next, fromFrame, label: 'Edit clip marker' });
    const journal = Object.freeze([...this.state.journal.slice(0, this.state.cursor), entry]);
    return this.accept(next, journal, journal.length, fromFrame, 'Updated marker; session only.');
  }

  private addClipKeyframe(intent: AddClipKeyframe): Promise<EditorResult> {
    if (!this.validEditScope(intent)) return this.reject('Project, session, or graph revision is stale.');
    const seq = this.state.graph.sequence;
    const selected = videoSelection(seq, intent.trackId, intent.clipId);
    const track = selected?.track;
    const clip = selected?.clip;
    if (!track || !clip || track.locked || linkedTrackLocked(seq, track.id, clip) ||
      !isFrame(intent.frame) || intent.frame < clip.timelineIn || intent.frame >= clip.timelineOut) {
      return this.reject('Select an unlocked clip frame to add a keyframe.');
    }
    const sourceFrame = clip.sourceIn + intent.frame - clip.timelineIn;
    if (clip.keyframes?.some((keyframe) => keyframe.sourceFrame === sourceFrame)) {
      return this.reject('This clip already has a keyframe at that frame.');
    }
    const serial = this.keyframeSerial + 1;
    const keyframe: ClipKeyframe = Object.freeze({ id: `keyframe-${serial}`, sourceFrame,
      effects: Object.freeze({ ...evaluateClipEffects(clip, intent.frame) }) });
    const next = prepareSequence(setClipKeyframes(seq, track.id, clip.id,
      [...(clip.keyframes ?? []), keyframe]), this.state.assets);
    if (!next) return this.reject('Keyframe could not be added.');
    this.keyframeSerial = serial;
    const entry: JournalEntry = Object.freeze({ before: seq, after: next,
      fromFrame: intent.frame, label: 'Add clip keyframe' });
    const journal = Object.freeze([...this.state.journal.slice(0, this.state.cursor), entry]);
    return this.accept(next, journal, journal.length, intent.frame,
      `Added keyframe at frame ${intent.frame}; session only.`);
  }

  private deleteClipKeyframe(intent: DeleteClipKeyframe): Promise<EditorResult> {
    if (!this.validEditScope(intent)) return this.reject('Project, session, or graph revision is stale.');
    const seq = this.state.graph.sequence;
    const selected = videoSelection(seq, intent.trackId, intent.clipId);
    const track = selected?.track;
    const clip = selected?.clip;
    const keyframe = clip?.keyframes?.find((item) => item.id === intent.keyframeId);
    if (!track || !clip || !keyframe || track.locked || linkedTrackLocked(seq, track.id, clip)) {
      return this.reject('Keyframe cannot be deleted from this clip.');
    }
    const frame = clip.timelineIn + keyframe.sourceFrame - clip.sourceIn;
    const next = prepareSequence(setClipKeyframes(seq, track.id, clip.id,
      clip.keyframes!.filter((item) => item.id !== keyframe.id)), this.state.assets);
    if (!next) return this.reject('Keyframe could not be deleted.');
    const entry: JournalEntry = Object.freeze({ before: seq, after: next,
      fromFrame: frame, label: 'Delete clip keyframe' });
    const journal = Object.freeze([...this.state.journal.slice(0, this.state.cursor), entry]);
    return this.accept(next, journal, journal.length, frame,
      `Deleted keyframe at frame ${frame}; session only.`);
  }

  private setClipEffects(intent: SetClipEffects): Promise<EditorResult> {
    if (!this.validEditScope(intent)) return this.reject('Project, session, or graph revision is stale.');
    const seq = this.state.graph.sequence;
    const selected = videoSelection(seq, intent.trackId, intent.clipId);
    const track = selected?.track;
    const clip = selected?.clip;
    const keyframe = intent.keyframeId === null ? null :
      clip?.keyframes?.find((item) => item.id === intent.keyframeId);
    if (!track || !clip || track.locked || linkedTrackLocked(seq, track.id, clip) ||
      !validEffects(intent.effects) || intent.keyframeId !== null &&
        (!keyframe || keyframe.sourceFrame < clip.sourceIn || keyframe.sourceFrame >= clip.sourceOut)) {
      return this.reject('Clip effects target or values are invalid.');
    }
    const current = keyframe?.effects ?? clip.effects ?? NEUTRAL_EFFECTS;
    if (sameEffects(current, intent.effects)) return this.reject('Clip effects are unchanged.');
    const next = prepareSequence(withClipEffects(seq, track.id, clip.id,
      intent.keyframeId, intent.effects), this.state.assets);
    if (!next) return this.reject('Clip effects could not be updated.');
    const frame = keyframe ? clip.timelineIn + keyframe.sourceFrame - clip.sourceIn : clip.timelineIn;
    const entry: JournalEntry = Object.freeze({ before: seq, after: next, fromFrame: frame,
      label: keyframe ? 'Edit keyframe effects' : 'Edit clip effects' });
    const journal = Object.freeze([...this.state.journal.slice(0, this.state.cursor), entry]);
    return this.accept(next, journal, journal.length, frame,
      `${keyframe ? 'Keyframe' : 'Clip'} effects updated; session only.`);
  }

  private saveEffectsProfile(intent: SaveEffectsProfile): Promise<EditorResult> {
    if (!this.validEditScope(intent)) return this.reject('Project, session, or graph revision is stale.');
    const seq = this.state.graph.sequence;
    const selected = videoSelection(seq, intent.trackId, intent.clipId);
    const clip = selected?.clip;
    const name = intent.name.trim();
    if (!clip || !name || name.length > 80) return this.reject('Select a clip and enter a profile name.');
    const prior = this.state.profiles.find((item) => item.name.toLowerCase() === name.toLowerCase());
    const serial = this.profileSerial + (prior ? 0 : 1);
    const profile: EffectsProfile = Object.freeze({
      id: prior?.id ?? `effects-profile-${serial}`, name, version: (prior?.version ?? 0) + 1,
      base: Object.freeze({ ...(clip.effects ?? NEUTRAL_EFFECTS) }),
      keyframes: Object.freeze((clip.keyframes ?? []).filter((item) =>
        item.sourceFrame >= clip.sourceIn && item.sourceFrame < clip.sourceOut)
        .map((item) => Object.freeze({ offset: item.sourceFrame - clip.sourceIn,
          effects: Object.freeze({ ...(item.effects ?? evaluateClipEffects(clip,
            clip.timelineIn + item.sourceFrame - clip.sourceIn)) }) }))),
    });
    const profiles = Object.freeze([...this.state.profiles.filter((item) => item.id !== prior?.id), profile]);
    const entry: JournalEntry = Object.freeze({ before: seq, after: seq,
      beforeProfiles: this.state.profiles, afterProfiles: profiles,
      fromFrame: clip.timelineIn, label: prior ? 'Update effects profile' : 'Save effects profile' });
    const journal = Object.freeze([...this.state.journal.slice(0, this.state.cursor), entry]);
    this.profileSerial = serial;
    return this.accept(seq, journal, journal.length, clip.timelineIn,
      `${prior ? 'Updated' : 'Saved'} effects profile ${name}; session only.`,
      this.state.clipboard, this.state.sourceMarkers, profiles);
  }

  private applyEffectsProfile(intent: ApplyEffectsProfile): Promise<EditorResult> {
    if (!this.validEditScope(intent)) return this.reject('Project, session, or graph revision is stale.');
    const seq = this.state.graph.sequence;
    const selected = videoSelection(seq, intent.trackId, intent.clipId);
    const track = selected?.track;
    const clip = selected?.clip;
    const profile = this.state.profiles.find((item) => item.id === intent.profileId &&
      item.version === intent.profileVersion);
    if (!track || !clip || track.locked || linkedTrackLocked(seq, track.id, clip) || !profile) {
      return this.reject('Effects profile or target clip is unavailable.');
    }
    const duration = clip.timelineOut - clip.timelineIn;
    if (!validEffects(profile.base) || profile.keyframes.some((item) =>
      !isFrame(item.offset) || item.offset >= duration || !validEffects(item.effects))) {
      return this.reject('Effects profile keyframes do not fit this clip.');
    }
    const keyframes = Object.freeze(profile.keyframes.map((item, index) => Object.freeze({
      id: `keyframe-${this.keyframeSerial + index + 1}`,
      sourceFrame: clip.sourceIn + item.offset, effects: Object.freeze({ ...item.effects }),
    })));
    const replaced = setClipKeyframes(withClipEffects(seq, track.id, clip.id, null, profile.base),
      track.id, clip.id, keyframes);
    const next = prepareSequence(replaced, this.state.assets);
    if (!next) return this.reject('Effects profile could not be applied.');
    this.keyframeSerial += keyframes.length;
    const entry: JournalEntry = Object.freeze({ before: seq, after: next, fromFrame: clip.timelineIn,
      label: 'Apply effects profile' });
    const journal = Object.freeze([...this.state.journal.slice(0, this.state.cursor), entry]);
    return this.accept(next, journal, journal.length, clip.timelineIn,
      `Applied ${profile.name} to clip; session only.`);
  }

  private sourceMarkerAsset(intent: SourceMarkerScope): AssetRecord | null {
    const { project, graph, assets, binding, change } = this.state;
    if (project.status !== 'ready' || change.state !== 'live' ||
      intent.projectId !== project.projectId || intent.sessionId !== project.sessionId ||
      intent.expectedRevision !== graph.revision) return null;
    const asset = assets.find((item) => item.id === intent.assetId);
    return asset?.status === 'ready' && asset.version === intent.assetVersion &&
      asset.fingerprint === intent.fingerprint && !!binding.byAssetId[asset.id] ? asset : null;
  }

  private addSourceMarker(intent: AddSourceMarker): Promise<EditorResult> {
    const asset = this.sourceMarkerAsset(intent);
    if (!asset || !isFrame(intent.frame) || intent.frame >= asset.frameCount) {
      return this.reject('Source marker target is stale or outside the asset.');
    }
    const markers = sourceMarkersInSpan(this.state.sourceMarkers, asset, 0, asset.frameCount);
    if (markers.some((marker) => marker.sourceFrame === intent.frame)) {
      return this.reject('This source already has a marker at that frame.');
    }
    const serial = this.markerSerial + 1;
    const marker: ClipMarker = Object.freeze({ id: `source-marker-${serial}`,
      sourceFrame: intent.frame, label: '', color: 'red' });
    const nextSourceMarkers = replaceSourceMarkerSet(this.state.sourceMarkers, asset, [...markers, marker]);
    if (!validSourceMarkers(nextSourceMarkers, this.state.assets)) return this.reject('Source marker could not be added.');
    this.markerSerial = serial;
    const seq = this.state.graph.sequence;
    const entry: JournalEntry = Object.freeze({ before: seq, after: seq,
      beforeSourceMarkers: this.state.sourceMarkers, afterSourceMarkers: nextSourceMarkers,
      fromFrame: 0, label: 'Add source marker' });
    const journal = Object.freeze([...this.state.journal.slice(0, this.state.cursor), entry]);
    return this.accept(seq, journal, journal.length, 0,
      `Added source marker at frame ${intent.frame}; session only.`, this.state.clipboard, nextSourceMarkers);
  }

  private updateSourceMarker(intent: UpdateSourceMarker): Promise<EditorResult> {
    const asset = this.sourceMarkerAsset(intent);
    const markers = asset ? sourceMarkersInSpan(this.state.sourceMarkers, asset, 0, asset.frameCount) : [];
    const marker = markers.find((item) => item.id === intent.markerId);
    if (!asset || !marker || typeof intent.label !== 'string' || intent.label.trim().length > 80 ||
      !['red', 'green', 'blue', 'yellow'].includes(intent.color)) {
      return this.reject('Source marker edit is invalid or stale.');
    }
    const label = intent.label.trim();
    if (marker.label === label && marker.color === intent.color) return this.reject('Marker is unchanged.');
    const nextSourceMarkers = replaceSourceMarkerSet(this.state.sourceMarkers, asset,
      markers.map((item) => item.id === marker.id ? Object.freeze({ ...item, label, color: intent.color }) : item));
    if (!validSourceMarkers(nextSourceMarkers, this.state.assets)) return this.reject('Source marker could not be updated.');
    const seq = this.state.graph.sequence;
    const entry: JournalEntry = Object.freeze({ before: seq, after: seq,
      beforeSourceMarkers: this.state.sourceMarkers, afterSourceMarkers: nextSourceMarkers,
      fromFrame: 0, label: 'Edit source marker' });
    const journal = Object.freeze([...this.state.journal.slice(0, this.state.cursor), entry]);
    return this.accept(seq, journal, journal.length, 0,
      'Updated source marker; session only.', this.state.clipboard, nextSourceMarkers);
  }

  private moveHistory(direction: 'undo' | 'redo'): Promise<EditorResult> {
    const { journal, cursor, project } = this.state;
    if (project.status !== 'ready' || this.state.change.state !== 'live') return this.reject('Project is closed or stale.');
    if (direction === 'undo' && cursor === 0) return this.reject('Nothing to undo.');
    if (direction === 'redo' && cursor === journal.length) return this.reject('Nothing to redo.');
    const entry = journal[direction === 'undo' ? cursor - 1 : cursor];
    const next = direction === 'undo' ? entry.before : entry.after;
    const sourceMarkers = direction === 'undo' ? entry.beforeSourceMarkers ?? this.state.sourceMarkers :
      entry.afterSourceMarkers ?? this.state.sourceMarkers;
    const profiles = direction === 'undo' ? entry.beforeProfiles ?? this.state.profiles :
      entry.afterProfiles ?? this.state.profiles;
    if (!validateSequence(next, this.state.assets) || !validSourceMarkers(sourceMarkers, this.state.assets)) {
      return this.reject('History state is invalid.');
    }
    return this.accept(next, journal, cursor + (direction === 'undo' ? -1 : 1), entry.fromFrame,
      `${direction === 'undo' ? 'Undid' : 'Redid'} ${entry.label.toLowerCase()}; session only.`,
      this.state.clipboard, sourceMarkers, profiles);
  }
}

export function registerMockTaps(grok: Grok): void {
  grok.registerTap(new MockEditorRootTap());
  grok.query(DESKTOP_TAB_LINKS, grok.mainContext);
}
