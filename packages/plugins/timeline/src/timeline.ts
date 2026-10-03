import { BaseTap, type AtomTapHandle, type Grip, type GripContext } from '@owebeeone/grip-react';
import {
  GVID_CHANGE_STATUS, GVID_DEST_SEQUENCE_ID, GVID_DEST_SEQUENCE_ID_TAP,
  GVID_DEST_TIMELINE_FRAME, GVID_GRAPH_VIEW, GVID_PROJECT_VIEW, GVID_SEQUENCE_VIEW,
  GVID_TIMELINE_MARKS, GVID_TIMELINE_MARKS_CONTROL, GVID_TIMELINE_SELECTION,
  GVID_TIMELINE_SELECTION_TAP, GVID_TIMELINE_TRANSPORT, GVID_TIMELINE_TRANSPORT_CONTROL,
  GVID_TIMELINE_VIEWPORT, GVID_TIMELINE_VIEWPORT_TAP,
  type AssetRecord, type ChangeStatus, type FrameMarks, type GraphView, type MarksControl,
  type ProjectView, type SequenceClip, type SequenceView, type SourceDragSpan, type TimelineClipDrag,
  type TimelineDropProjection, type TimelineSelection, type TimelineViewport, type SequenceTrack,
  type TransportControl, type TransportView,
} from '@gvidjs/contracts';

const MIN_ZOOM = 2;
const MAX_ZOOM = 32;
const DEFAULT_ZOOM = 8;

export function orderedTimelineTracks(sequence: SequenceView): readonly SequenceTrack[] {
  return [
    ...sequence.tracks.filter((track) => track.kind === 'video').reverse(),
    ...sequence.tracks.filter((track) => track.kind === 'audio'),
  ];
}

export function frameFromTimelineX(clientX: number, left: number, startFrame: number, pixelsPerFrame: number): number {
  if (!Number.isFinite(clientX) || !Number.isFinite(left) || !Number.isFinite(startFrame) ||
      !Number.isFinite(pixelsPerFrame) || pixelsPerFrame <= 0) return 0;
  const frame = startFrame + (clientX - left) / pixelsPerFrame;
  const lower = Math.floor(frame);
  return Math.max(0, lower + (frame - lower > 0.5 ? 1 : 0));
}

export function timelineWheelMovement(
  wheel: { deltaX: number; deltaY: number; deltaMode: number; shiftKey: boolean },
  pixelsPerFrame: number,
  viewportHeight: number,
): { axis: 'vertical'; pixels: number } | { axis: 'horizontal'; frames: number } {
  const unit = wheel.deltaMode === 1 ? 16 : wheel.deltaMode === 2 ? viewportHeight : 1;
  if (!wheel.shiftKey) return { axis: 'vertical', pixels: wheel.deltaY * unit };
  const delta = Math.abs(wheel.deltaX) > Math.abs(wheel.deltaY) ? wheel.deltaX : wheel.deltaY;
  const pixels = delta * unit;
  return { axis: 'horizontal', frames: pixels === 0 ? 0 :
    Math.sign(pixels) * Math.max(1, Math.round(Math.abs(pixels) / pixelsPerFrame)) };
}

export function boundedFrame(frame: number, duration: number): number | null {
  return Number.isInteger(frame) && frame >= 0 && frame < duration ? frame : null;
}

export function snapTimelineFrame(sequence: SequenceView, frame: number, options: {
  pixelsPerFrame: number;
  spanFrames?: number;
  anchors?: readonly number[];
  excludeClipId?: string;
  minFrame?: number;
  maxFrame?: number;
}): number {
  if (!Number.isSafeInteger(frame) || !Number.isFinite(options.pixelsPerFrame) ||
    options.pixelsPerFrame <= 0) return frame;
  const span = options.spanFrames ?? 0;
  const anchors = [0, sequence.durationFrames, ...(options.anchors ?? [])];
  for (const track of sequence.tracks.filter((row) => row.kind === 'video')) for (const clip of track.clips) {
    if (clip.id !== options.excludeClipId) anchors.push(clip.timelineIn, clip.timelineOut);
  }
  let snapped = frame;
  let distance = Infinity;
  for (const anchor of anchors) for (const candidate of span > 0 ? [anchor, anchor - span] : [anchor]) {
    if (candidate < (options.minFrame ?? 0) || candidate > (options.maxFrame ?? Number.MAX_SAFE_INTEGER)) continue;
    const pixels = Math.abs(frame - candidate) * options.pixelsPerFrame;
    if (pixels <= 8 && pixels < distance) { snapped = candidate; distance = pixels; }
  }
  return snapped;
}

export function clipBoundaryFrame(sequence: SequenceView, frame: number, direction: 'up' | 'down'): number {
  if (boundedFrame(frame, sequence.durationFrames) === null) return frame;
  let nearest = frame;
  for (const track of sequence.tracks) {
    for (const clip of track.clips) {
      for (const candidate of [clip.timelineIn, clip.timelineOut - 1]) {
        if (direction === 'up' && candidate < frame && (nearest === frame || candidate > nearest)) nearest = candidate;
        if (direction === 'down' && candidate > frame && (nearest === frame || candidate < nearest)) nearest = candidate;
      }
    }
  }
  return nearest;
}

export function projectDropPreview(
  sequence: SequenceView, targetTrackId: string, pointerFrame: number,
  input: { kind: 'source'; span: SourceDragSpan; asset: AssetRecord } |
    { kind: 'clip'; moving: TimelineClipDrag },
): TimelineDropProjection | null {
  const target = sequence.tracks.find((track) => track.id === targetTrackId);
  if (!target || target.locked || !Number.isSafeInteger(pointerFrame) || pointerFrame < 0) return null;
  const videoTarget = sequence.tracks.find((track) => track.id ===
    (target.kind === 'audio' ? target.id.replace(/^a(\d+)$/, 'v$1') : target.id));
  const audioTarget = sequence.tracks.find((track) => track.id ===
    videoTarget?.id.replace(/^v(\d+)$/, 'a$1'));
  if (!videoTarget || videoTarget.locked) return null;

  let clip: Pick<SequenceClip, 'assetId' | 'sourceIn' | 'sourceOut' | 'linkedClipId'>;
  let sourceTrackId: string | null = null;
  let clipId: string | null = null;
  let hasAudio = false;
  let frame = pointerFrame;
  if (input.kind === 'source') {
    const { span, asset } = input;
    if (asset.id !== span.assetId || asset.version !== span.assetVersion || asset.status !== 'ready' ||
      asset.frameRate.num !== 24 || asset.frameRate.den !== 1 ||
      !Number.isSafeInteger(span.sourceIn) || !Number.isSafeInteger(span.sourceOut) ||
      span.sourceIn < 0 || span.sourceOut <= span.sourceIn || span.sourceOut > asset.frameCount) return null;
    clip = { assetId: span.assetId, sourceIn: span.sourceIn, sourceOut: span.sourceOut };
    hasAudio = asset.hasAudio;
  } else {
    const { moving } = input;
    const source = sequence.tracks.find((track) => track.id === moving.sourceTrackId);
    const found = source?.clips.find((item) => item.id === moving.clipId);
    const sourceVideo = sequence.tracks.find((track) => track.id ===
      source?.id.replace(/^a(\d+)$/, 'v$1'));
    const sourceAudio = sequence.tracks.find((track) => track.id ===
      sourceVideo?.id.replace(/^v(\d+)$/, 'a$1'));
    if (!source || source.locked || !found || !Number.isSafeInteger(moving.grabOffsetFrames) ||
      !sourceVideo || sourceVideo.locked || found.linkedClipId && sourceAudio?.locked ||
      moving.grabOffsetFrames < 0 ||
      moving.grabOffsetFrames >= found.timelineOut - found.timelineIn) return null;
    clip = found;
    hasAudio = Boolean(found.linkedClipId);
    sourceTrackId = source.id;
    clipId = found.id;
    frame = Math.max(0, pointerFrame - moving.grabOffsetFrames);
  }
  if (target.kind === 'audio' && !hasAudio || hasAudio && audioTarget?.locked) return null;
  const end = frame + clip.sourceOut - clip.sourceIn;
  if (!Number.isSafeInteger(end)) return null;
  const movingVideoId = sourceTrackId?.startsWith('a') ? clip.linkedClipId : clipId;
  const createsTrack = videoTarget.clips.some((item) =>
    !(videoTarget.id === (sourceTrackId?.replace(/^a(\d+)$/, 'v$1')) && item.id === movingVideoId) &&
    item.timelineIn < end && frame < item.timelineOut);
  const maxTrack = sequence.tracks.reduce((max, track) => {
    const match = /^v(\d+)$/.exec(track.id);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return {
    kind: input.kind, assetId: clip.assetId, sourceIn: clip.sourceIn, sourceOut: clip.sourceOut,
    sourceTrackId, clipId, targetTrackId: videoTarget.id,
    resolvedTrackId: createsTrack ? `v${maxTrack + 1}` : videoTarget.id,
    createsTrack, hasAudio, frame,
  };
}

export function markState(inFrame: number | null, outFrame: number | null, duration: number): FrameMarks {
  if (inFrame === null && outFrame === null) return { inFrame, outFrame, validity: 'unset' };
  if (inFrame !== null && outFrame !== null &&
      inFrame >= 0 && inFrame < outFrame && outFrame <= duration) {
    return { inFrame, outFrame, validity: 'valid' };
  }
  if ((inFrame === null || boundedFrame(inFrame, duration) !== null) &&
      (outFrame === null || (Number.isInteger(outFrame) && outFrame > 0 && outFrame <= duration)) &&
      (inFrame === null || outFrame === null)) {
    return { inFrame, outFrame, validity: 'pending' };
  }
  return { inFrame, outFrame, validity: 'invalid', reason: 'Playback In must precede Out within the sequence.' };
}

interface Owner {
  projectId: string;
  sessionId: string;
  graphId: string;
  sequenceId: string;
}

export class TimelineTabTap extends BaseTap {
  private owner: Owner | null = null;
  private sequence: SequenceView | null = null;
  private live = false;
  private sequenceId: string | null = null;
  private frame: number | null = null;
  private playing = false;
  private shuttleRate = 0;
  private inFrame: number | null = null;
  private outFrame: number | null = null;
  private selection: TimelineSelection = { trackId: null, clipId: null };
  private viewport: TimelineViewport = { startFrame: 0, pixelsPerFrame: DEFAULT_ZOOM,
    verticalScroll: 0, snapEnabled: true, showKeyframes: false, keyframeTool: null };
  private timer: ReturnType<typeof setInterval> | null = null;

  readonly sequenceHandle: AtomTapHandle<string | null> = {
    get: () => this.sequenceId,
    set: (id) => this.selectSequence(id),
    update: (fn) => this.selectSequence(fn(this.sequenceId)),
  };
  readonly selectionHandle: AtomTapHandle<TimelineSelection> = {
    get: () => this.selection,
    set: (value) => this.select(value),
    update: (fn) => this.select(fn(this.selection)),
  };
  readonly viewportHandle: AtomTapHandle<TimelineViewport> = {
    get: () => this.viewport,
    set: (value) => this.setViewport(value),
    update: (fn) => this.setViewport(fn(this.viewport)),
  };
  readonly transportControl: TransportControl = {
    play: () => this.play(),
    pause: () => this.pause(),
    shuttle: (direction) => this.shuttle(direction),
    seek: (frame) => this.seek(frame),
    step: (delta) => this.step(delta),
  };
  readonly marksControl: MarksControl = {
    setIn: () => this.setMark('in'),
    setOut: () => this.setMark('out'),
    clear: () => this.clearMarks(),
  };

  constructor(readonly tabId: string, initialSequenceId?: string | null) {
    super({
      provides: [
        GVID_DEST_SEQUENCE_ID, GVID_DEST_SEQUENCE_ID_TAP,
        GVID_DEST_TIMELINE_FRAME, GVID_TIMELINE_TRANSPORT, GVID_TIMELINE_TRANSPORT_CONTROL,
        GVID_TIMELINE_MARKS, GVID_TIMELINE_MARKS_CONTROL,
        GVID_TIMELINE_SELECTION, GVID_TIMELINE_SELECTION_TAP,
        GVID_TIMELINE_VIEWPORT, GVID_TIMELINE_VIEWPORT_TAP,
      ],
      homeParamGrips: [GVID_PROJECT_VIEW, GVID_GRAPH_VIEW, GVID_SEQUENCE_VIEW, GVID_CHANGE_STATUS],
    });
    this.sequenceId = initialSequenceId ?? null;
  }

  private input<T>(grip: Grip<T>): T | undefined {
    return this.paramDrips.get(grip)?.get() as T | undefined;
  }

  private acceptedSequence(): { owner: Owner; sequence: SequenceView } | null {
    const project = this.input<ProjectView>(GVID_PROJECT_VIEW);
    const graph = this.input<GraphView>(GVID_GRAPH_VIEW);
    const sequence = this.input<SequenceView>(GVID_SEQUENCE_VIEW);
    const status = this.input<ChangeStatus>(GVID_CHANGE_STATUS);
    if (!project?.projectId || project.status !== 'ready' || status?.state !== 'live' ||
        !graph || !sequence || project.graphId !== graph.graphId ||
        graph.graphId !== sequence.graphId || graph.revision !== sequence.revision ||
        project.revision !== graph.revision || project.sessionId.length === 0) return null;
    return {
      owner: { projectId: project.projectId, sessionId: project.sessionId,
        graphId: graph.graphId, sequenceId: sequence.id },
      sequence,
    };
  }

  private stopClock(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.playing = false;
    this.shuttleRate = 0;
  }

  private reconcile(): void {
    const accepted = this.acceptedSequence();
    const project = this.input<ProjectView>(GVID_PROJECT_VIEW);
    const nextOwner = accepted?.owner ?? (project?.projectId && project.status === 'ready' && this.owner &&
      project.projectId === this.owner.projectId && project.sessionId === this.owner.sessionId &&
      project.graphId === this.owner.graphId ? this.owner : null);
    const ownerChanged = this.owner?.projectId !== nextOwner?.projectId ||
      this.owner?.sessionId !== nextOwner?.sessionId ||
      this.owner?.graphId !== nextOwner?.graphId ||
      this.owner?.sequenceId !== nextOwner?.sequenceId;
    const priorDuration = this.sequence?.durationFrames ?? 0;
    if (ownerChanged) {
      this.stopClock();
      this.inFrame = null;
      this.outFrame = null;
      this.selection = { trackId: null, clipId: null };
      this.viewport = { ...this.viewport, startFrame: 0, verticalScroll: 0, keyframeTool: null };
      this.frame = null;
      this.sequenceId = nextOwner?.sequenceId ?? null;
    }
    this.owner = nextOwner;
    this.live = !!accepted;
    if (!this.live) this.stopClock();
    this.sequence = accepted?.sequence ?? (nextOwner ? this.sequence : null);
    const duration = this.sequence?.durationFrames ?? 0;
    if (!ownerChanged && priorDuration !== duration) this.stopClock();
    if (!this.sequence || this.sequenceId !== this.sequence.id || duration <= 0) {
      this.stopClock();
      this.frame = null;
    } else if (this.frame === null || boundedFrame(this.frame, duration) === null) {
      this.stopClock();
      this.frame = 0;
    }
    if (markState(this.inFrame, this.outFrame, duration).validity === 'invalid') this.stopClock();
    const track = this.sequence?.tracks.find((item) => item.id === this.selection.trackId);
    if (!track) this.selection = { trackId: null, clipId: null };
    else if (this.selection.clipId && !track.clips.some((clip) => clip.id === this.selection.clipId)) {
      this.selection = { trackId: track.id, clipId: null };
    }
    const tool = this.viewport.keyframeTool;
    if (tool && (tool.sessionId !== this.owner?.sessionId ||
      !this.sequence?.tracks.find((row) => row.id === tool.trackId)?.clips
        .find((clip) => clip.id === tool.clipId)?.keyframes?.some((keyframe) => keyframe.id === tool.keyframeId))) {
      this.viewport = { ...this.viewport, keyframeTool: null };
    }
    this.viewport = { ...this.viewport, startFrame: Math.min(this.viewport.startFrame, Math.max(0, duration - 1)) };
  }

  private selectSequence(id: string | null): void {
    const accepted = this.acceptedSequence();
    if (id !== null && id !== accepted?.sequence.id) return;
    if (id === this.sequenceId) return;
    this.stopClock();
    this.sequenceId = id;
    this.frame = id && accepted && accepted.sequence.durationFrames > 0 ? 0 : null;
    this.inFrame = null;
    this.outFrame = null;
    this.selection = { trackId: null, clipId: null };
    this.viewport = { ...this.viewport, keyframeTool: null };
    this.produce();
  }

  private select(value: TimelineSelection): void {
    if (!this.live) return;
    const track = this.sequence?.tracks.find((item) => item.id === value.trackId);
    const clipId = track?.clips.some((clip) => clip.id === value.clipId) ? value.clipId : null;
    const next = { trackId: track?.id ?? null, clipId };
    if (next.trackId === this.selection.trackId && next.clipId === this.selection.clipId) return;
    this.selection = next;
    this.produce();
  }

  private setViewport(value: TimelineViewport): void {
    const duration = this.sequence?.durationFrames ?? 0;
    const showKeyframes = typeof value.showKeyframes === 'boolean'
      ? value.showKeyframes : this.viewport.showKeyframes;
    const tool = value.keyframeTool;
    const validTool = tool && tool.sessionId === this.owner?.sessionId &&
      !!this.sequence?.tracks.find((track) => track.id === tool.trackId)?.clips
        .find((clip) => clip.id === tool.clipId)?.keyframes
        ?.some((keyframe) => keyframe.id === tool.keyframeId);
    this.viewport = {
      startFrame: Number.isFinite(value.startFrame)
        ? Math.max(0, Math.min(Math.floor(value.startFrame), Math.max(0, duration - 1))) : this.viewport.startFrame,
      pixelsPerFrame: Number.isFinite(value.pixelsPerFrame)
        ? Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value.pixelsPerFrame)) : this.viewport.pixelsPerFrame,
      verticalScroll: Number.isFinite(value.verticalScroll) ? Math.max(0, value.verticalScroll) : this.viewport.verticalScroll,
      snapEnabled: typeof value.snapEnabled === 'boolean' ? value.snapEnabled : this.viewport.snapEnabled,
      showKeyframes,
      keyframeTool: !showKeyframes ? null : tool === undefined ? this.viewport.keyframeTool :
        validTool ? tool : null,
    };
    this.produce();
  }

  private seek(frame: number): void {
    if (!this.live) return;
    const accepted = boundedFrame(frame, this.sequence?.durationFrames ?? 0);
    if (accepted === null || this.frame === null) return;
    const marks = markState(this.inFrame, this.outFrame, this.sequence!.durationFrames);
    if (this.playing && marks.validity === 'valid' &&
        (accepted < marks.inFrame! || accepted >= marks.outFrame!)) this.stopClock();
    this.frame = accepted;
    this.produce();
  }

  private step(delta: number): void {
    if (!Number.isInteger(delta) || this.frame === null) return;
    this.stopClock();
    this.seek(Math.max(0, Math.min(this.frame + delta, (this.sequence?.durationFrames ?? 1) - 1)));
  }

  private play(): void {
    if (!this.playing) this.shuttle(1);
  }

  private shuttle(direction: -1 | 0 | 1): void {
    if (direction === 0) { this.pause(); return; }
    if (!this.live) return;
    const duration = this.sequence?.durationFrames ?? 0;
    const marks = markState(this.inFrame, this.outFrame, duration);
    if (this.frame === null || marks.validity === 'invalid' || duration <= 0) return;
    const start = marks.validity === 'valid' ? marks.inFrame! : 0;
    const end = marks.validity === 'valid' ? marks.outFrame! : duration;
    if (this.frame < start || this.frame >= end) this.frame = direction > 0 ? start : end - 1;
    this.shuttleRate = this.playing && Math.sign(this.shuttleRate) === direction ?
      direction * Math.min(4, Math.abs(this.shuttleRate) * 2) : direction;
    if (!this.playing) {
      this.playing = true;
      const rate = this.sequence?.frameRate;
      const interval = rate && rate.num > 0 && rate.den > 0 ? 1000 * rate.den / rate.num : 1000 / 24;
      this.timer = setInterval(() => this.tick(), interval);
    }
    this.produce();
  }

  private tick(): void {
    this.reconcile();
    const duration = this.sequence?.durationFrames ?? 0;
    const marks = markState(this.inFrame, this.outFrame, duration);
    if (!this.live || !this.playing || this.frame === null || marks.validity === 'invalid') { this.stopClock(); this.produce(); return; }
    const start = marks.validity === 'valid' ? marks.inFrame! : 0;
    const end = marks.validity === 'valid' ? marks.outFrame! : duration;
    const next = this.frame + this.shuttleRate;
    if (next < start || next >= end) {
      this.frame = Math.max(start, Math.min(end - 1, next));
      this.stopClock();
    } else this.frame = next;
    this.produce();
  }

  private pause(): void { this.stopClock(); this.produce(); }

  private setMark(which: 'in' | 'out'): void {
    if (!this.live || this.frame === null || !this.sequence) return;
    if (which === 'in') this.inFrame = this.frame;
    else this.outFrame = this.frame + 1;
    const marks = markState(this.inFrame, this.outFrame, this.sequence.durationFrames);
    if (marks.validity === 'invalid' || this.playing) this.stopClock();
    this.produce();
  }

  private clearMarks(): void {
    this.stopClock();
    this.inFrame = null;
    this.outFrame = null;
    this.produce();
  }

  produce(opts?: { destContext?: GripContext }): void {
    const duration = this.sequence?.durationFrames ?? 0;
    const marks = markState(this.inFrame, this.outFrame, duration);
    const transport: TransportView = {
      frame: this.live ? this.frame : null, frameCount: this.live ? duration : 0, playing: this.playing,
      shuttleRate: this.shuttleRate,
      rate: this.sequence?.frameRate ?? { num: 24, den: 1 },
      disabledReason: !this.live || !this.sequence ? 'No live sequence is available.'
        : this.frame === null ? 'The sequence has no playable frames.'
          : marks.validity === 'invalid' ? marks.reason : undefined,
    };
    this.publish(new Map<Grip<unknown>, unknown>([
      [GVID_DEST_SEQUENCE_ID, this.sequenceId], [GVID_DEST_SEQUENCE_ID_TAP, this.sequenceHandle],
      [GVID_DEST_TIMELINE_FRAME, this.live ? this.frame : null], [GVID_TIMELINE_TRANSPORT, transport],
      [GVID_TIMELINE_TRANSPORT_CONTROL, this.transportControl],
      [GVID_TIMELINE_MARKS, marks], [GVID_TIMELINE_MARKS_CONTROL, this.marksControl],
      [GVID_TIMELINE_SELECTION, this.selection], [GVID_TIMELINE_SELECTION_TAP, this.selectionHandle],
      [GVID_TIMELINE_VIEWPORT, this.viewport], [GVID_TIMELINE_VIEWPORT_TAP, this.viewportHandle],
    ]), opts?.destContext);
  }

  produceOnParams(): void { this.reconcile(); this.produce(); }
  produceOnDestParams(): void {}

  onDetach(): void { this.stopClock(); super.onDetach(); }
}
