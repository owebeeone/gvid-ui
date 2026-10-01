import type { GrythPlugin } from '@grythjs/plugin-api';
import { defineGrip } from '@grythjs/plugin-api';
import type { AtomTapHandle } from '@owebeeone/grip-react';

export const GVID_TOOLS = {
  assets: 'gvid.assets',
  source: 'gvid.source',
  sequence: 'gvid.sequence-preview',
  timeline: 'gvid.timeline',
} as const;

export const GVID_ASSETS_PLUGIN = defineGrip<GrythPlugin>('Gvid.Plugin.Assets');
export const GVID_SOURCE_PLUGIN = defineGrip<GrythPlugin>('Gvid.Plugin.Source');
export const GVID_PREVIEW_PLUGIN = defineGrip<GrythPlugin>('Gvid.Plugin.SequencePreview');
export const GVID_TIMELINE_PLUGIN = defineGrip<GrythPlugin>('Gvid.Plugin.Timeline');

export interface Rational {
  num: number;
  den: number;
}

export interface ProjectView {
  projectId: string | null;
  sessionId: string;
  graphId: string;
  revision: number;
  bindingSetId: string;
  bindingRevision: number;
  sessionOnly: true;
  status: 'ready' | 'closed';
}

export interface ProjectControl {
  open(projectId: string): void;
  close(): void;
}

export interface AssetRecord {
  id: string;
  displayName: string;
  version: string;
  fingerprint: string;
  streamId: string;
  frameCount: number;
  width: number;
  height: number;
  frameRate: Rational;
  status: 'ready' | 'missing' | 'changed' | 'offline';
  reason?: string;
}

export interface BindingView {
  bindingSetId: string;
  revision: number;
  byAssetId: Readonly<Record<string, string>>;
}

export interface SequenceClip {
  id: string;
  assetId: string;
  sourceIn: number;
  sourceOut: number;
  timelineIn: number;
  timelineOut: number;
}

export interface SequenceTrack {
  id: string;
  label: string;
  kind: 'video';
  locked: boolean;
  clips: readonly SequenceClip[];
}

export interface SequenceView {
  id: string;
  graphId: string;
  revision: number;
  frameRate: Rational;
  durationFrames: number;
  tracks: readonly SequenceTrack[];
}

export interface GraphView {
  graphId: string;
  revision: number;
  sequence: SequenceView;
}

export interface ChangeStatus {
  state: 'live' | 'stale' | 'closed';
  reason?: string;
}

export interface InsertTarget {
  projectId: string;
  graphId: string;
  sequenceId: string;
  trackId: string;
  frame: number;
  ownerTabId: string;
}

export interface InsertTargetControl {
  set(target: InsertTarget): void;
  clear(ownerTabId?: string): void;
}

export interface EditorResult {
  status: 'accepted-session-only' | 'rejected' | 'pending';
  revision: number;
  message: string;
  commandId: string;
}

export interface InsertSourceSpan {
  projectId: string;
  sessionId: string;
  expectedRevision: number;
  bindingSetId: string;
  assetId: string;
  assetVersion: string;
  sourceIn: number;
  sourceOut: number;
  target: InsertTarget;
}

export interface EditorControl {
  insert(intent: InsertSourceSpan): Promise<EditorResult>;
}

export interface HistoryView {
  revision: number;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
}

export interface HistoryControl {
  undo(): Promise<EditorResult>;
  redo(): Promise<EditorResult>;
}

export interface TabLinkView {
  tabId: string;
  sourceTabId: string | null;
  params: Readonly<Record<string, unknown>>;
}

export interface SourceDestination {
  viewerId: string;
  projectId: string | null;
  sessionId: string;
  assetId: string | null;
  assetVersion: string | null;
  fingerprint: string | null;
  sourceFrame: number | null;
  mode: 'wired' | 'standalone' | 'unresolved';
  reason?: string;
}

export interface SequenceDestination {
  viewerId: string;
  projectId: string | null;
  sessionId: string;
  sequenceId: string | null;
  timelineFrame: number | null;
  mode: 'wired' | 'standalone' | 'unresolved';
  reason?: string;
}

export interface TransportView {
  frame: number | null;
  frameCount: number;
  playing: boolean;
  rate: Rational;
  disabledReason?: string;
}

export interface TransportControl {
  play(): void;
  pause(): void;
  seek(frame: number): void;
  step(delta: number): void;
}

export interface FrameMarks {
  inFrame: number | null;
  outFrame: number | null;
  validity: 'unset' | 'pending' | 'valid' | 'invalid';
  reason?: string;
}

export interface MarksControl {
  setIn(): void;
  setOut(): void;
  clear(): void;
}

export interface TimelineSelection {
  trackId: string | null;
  clipId: string | null;
}

export interface TimelineViewport {
  startFrame: number;
  pixelsPerFrame: number;
  verticalScroll: number;
}

export interface Diagnostic {
  code: string;
  message: string;
}

export type FrameResource =
  | { kind: 'mock-png'; leaseId: string; objectUrl: string }
  | { kind: 'decoded-frame'; leaseId: string; frame: VideoFrame | ImageBitmap }
  | { kind: 'media-resource'; leaseId: string; descriptorId: string };

export interface SourceFrameKey {
  requestId: string;
  cancelGroupId: string;
  viewerId: string;
  sessionId: string;
  projectId: string;
  assetId: string;
  assetVersion: string;
  fingerprint: string;
  streamId: string;
  sourceFrame: number;
  sourcePts: Rational;
}

export interface SequenceFrameKey {
  requestId: string;
  cancelGroupId: string;
  viewerId: string;
  sessionId: string;
  projectId: string;
  graphId: string;
  sequenceId: string;
  revision: number;
  bindingSetId: string;
  bindingRevision: number;
  timelineFrame: number;
}

export interface FrameResult<K> {
  key: K;
  state: 'pending' | 'ready' | 'gap' | 'failed';
  fidelity: 'mock' | 'proxy' | 'exact';
  resource?: FrameResource;
  diagnostic?: Diagnostic;
  composition?: 'mock-single-track' | 'composite';
}

export interface FramePresentation<K> {
  state: 'empty' | 'pending' | 'current' | 'stale' | 'gap' | 'failed';
  requestedFrame: number | null;
  key?: K;
  resource?: FrameResource;
  fidelity?: 'mock' | 'proxy' | 'exact';
  reason?: string;
  composition?: 'mock-single-track' | 'composite';
}

export interface FrameProvider {
  source(key: SourceFrameKey, asset: AssetRecord, signal: AbortSignal): Promise<FrameResult<SourceFrameKey>>;
  sequence(
    key: SequenceFrameKey,
    clip: SequenceClip | null,
    asset: AssetRecord | null,
    signal: AbortSignal,
  ): Promise<FrameResult<SequenceFrameKey>>;
  release(leaseId: string): void;
}

export const GVID_DEST_PROJECT_ID = defineGrip<string | null>('Gvid.Dest.ProjectId', null);
export const GVID_PROJECT_VIEW = defineGrip<ProjectView>('Gvid.Project.View');
export const GVID_PROJECT_CONTROL = defineGrip<ProjectControl>('Gvid.Project.Control');
export const GVID_GRAPH_VIEW = defineGrip<GraphView>('Gvid.Graph.View');
export const GVID_CHANGE_STATUS = defineGrip<ChangeStatus>('Gvid.Graph.ChangeStatus');
export const GVID_ASSET_CATALOG = defineGrip<readonly AssetRecord[]>('Gvid.Asset.Catalog', []);
export const GVID_BINDING_VIEW = defineGrip<BindingView>('Gvid.Binding.View');
export const GVID_SEQUENCE_VIEW = defineGrip<SequenceView>('Gvid.Sequence.View');

export const GVID_DEST_ASSET_ID = defineGrip<string | null>('Gvid.Dest.AssetId', null);
export const GVID_DEST_ASSET_ID_TAP = defineGrip<AtomTapHandle<string | null>>('Gvid.Dest.AssetId.Tap');
export const GVID_ASSET_QUERY = defineGrip<string>('Gvid.Asset.Query', '');
export const GVID_ASSET_QUERY_TAP = defineGrip<AtomTapHandle<string>>('Gvid.Asset.Query.Tap');
export const GVID_DEST_SEQUENCE_ID = defineGrip<string | null>('Gvid.Dest.SequenceId', null);
export const GVID_DEST_SEQUENCE_ID_TAP = defineGrip<AtomTapHandle<string | null>>('Gvid.Dest.SequenceId.Tap');

export const GVID_SOURCE_LINK = defineGrip<TabLinkView>('Gvid.Source.Link');
export const GVID_SOURCE_DESTINATION = defineGrip<SourceDestination>('Gvid.Source.Destination');
export const GVID_SEQUENCE_LINK = defineGrip<TabLinkView>('Gvid.Sequence.Link');
export const GVID_SEQUENCE_DESTINATION = defineGrip<SequenceDestination>('Gvid.Sequence.Destination');
export const GVID_DEST_VIEWER_ID = defineGrip<string>('Gvid.Dest.ViewerId');

export const GVID_DEST_SOURCE_FRAME = defineGrip<number | null>('Gvid.Dest.SourceFrame', null);
export const GVID_SOURCE_TRANSPORT = defineGrip<TransportView>('Gvid.Source.Transport');
export const GVID_SOURCE_TRANSPORT_CONTROL = defineGrip<TransportControl>('Gvid.Source.Transport.Control');
export const GVID_SOURCE_MARKS = defineGrip<FrameMarks>('Gvid.Source.Marks');
export const GVID_SOURCE_MARKS_CONTROL = defineGrip<MarksControl>('Gvid.Source.Marks.Control');

export const GVID_DEST_TIMELINE_FRAME = defineGrip<number | null>('Gvid.Dest.TimelineFrame', null);
export const GVID_TIMELINE_TRANSPORT = defineGrip<TransportView>('Gvid.Timeline.Transport');
export const GVID_TIMELINE_TRANSPORT_CONTROL = defineGrip<TransportControl>('Gvid.Timeline.Transport.Control');
export const GVID_TIMELINE_MARKS = defineGrip<FrameMarks>('Gvid.Timeline.Marks');
export const GVID_TIMELINE_MARKS_CONTROL = defineGrip<MarksControl>('Gvid.Timeline.Marks.Control');
export const GVID_TIMELINE_SELECTION = defineGrip<TimelineSelection>('Gvid.Timeline.Selection');
export const GVID_TIMELINE_SELECTION_TAP = defineGrip<AtomTapHandle<TimelineSelection>>('Gvid.Timeline.Selection.Tap');
export const GVID_TIMELINE_VIEWPORT = defineGrip<TimelineViewport>('Gvid.Timeline.Viewport');
export const GVID_TIMELINE_VIEWPORT_TAP = defineGrip<AtomTapHandle<TimelineViewport>>('Gvid.Timeline.Viewport.Tap');

export const GVID_ACTIVE_INSERT_TARGET = defineGrip<InsertTarget | null>('Gvid.Insert.Target', null);
export const GVID_ACTIVE_INSERT_TARGET_CONTROL = defineGrip<InsertTargetControl>('Gvid.Insert.Target.Control');
export const GVID_EDIT_COMMAND = defineGrip<EditorControl>('Gvid.Edit.Command');
export const GVID_EDIT_RESULT = defineGrip<EditorResult | null>('Gvid.Edit.Result', null);
export const GVID_HISTORY_VIEW = defineGrip<HistoryView>('Gvid.History.View');
export const GVID_HISTORY_CONTROL = defineGrip<HistoryControl>('Gvid.History.Control');

export const GVID_FRAME_PROVIDER = defineGrip<FrameProvider>('Gvid.Frame.Provider');
export const GVID_SOURCE_FRAME_RESULT = defineGrip<FrameResult<SourceFrameKey> | null>('Gvid.Source.FrameResult', null);
export const GVID_SOURCE_PRESENTATION = defineGrip<FramePresentation<SourceFrameKey>>('Gvid.Source.Presentation');
export const GVID_SEQUENCE_PREVIEW_RESULT = defineGrip<FrameResult<SequenceFrameKey> | null>('Gvid.Sequence.PreviewResult', null);
export const GVID_SEQUENCE_PRESENTATION = defineGrip<FramePresentation<SequenceFrameKey>>('Gvid.Sequence.Presentation');
