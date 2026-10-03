import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAtomValueTap, GripRegistry, Grok, type Grip } from '@owebeeone/grip-react';
import {
  GVID_CHANGE_STATUS, GVID_DEST_TIMELINE_FRAME, GVID_GRAPH_VIEW, GVID_PROJECT_VIEW,
  GVID_SEQUENCE_VIEW, GVID_TIMELINE_MARKS, GVID_TIMELINE_SELECTION,
  GVID_TIMELINE_TRANSPORT, type AssetRecord, type ChangeStatus, type GraphView, type ProjectView,
  type SequenceView, type SourceDragSpan, type TimelineClipDrag,
} from '@gvidjs/contracts';
import { boundedFrame, clipBoundaryFrame, frameFromTimelineX, markState, orderedTimelineTracks,
  projectDropPreview, snapTimelineFrame, timelineWheelMovement,
  TimelineTabTap } from './timeline';

const sequence: SequenceView = {
  id: 'main', graphId: 'graph-a', revision: 1, frameRate: { num: 24, den: 1 },
  durationFrames: 8,
  tracks: [{ id: 'v1', label: 'V1', kind: 'video', locked: false, clips: [
    { id: 'a', assetId: 'lighthouse', sourceIn: 12, sourceOut: 16, timelineIn: 0, timelineOut: 4 },
    { id: 'b', assetId: 'workshop', sourceIn: 5, sourceOut: 9, timelineIn: 4, timelineOut: 8 },
  ] }],
};
const project: ProjectView = {
  projectId: 'mock-a', sessionId: 'session-a', graphId: 'graph-a', revision: 1,
  bindingSetId: 'bindings-a', bindingRevision: 1, sessionOnly: true, status: 'ready',
};
const asset: AssetRecord = {
  id: 'workshop', displayName: 'Workshop', version: 'v1', fingerprint: 'workshop/v1',
  streamId: 'workshop/video-0', frameCount: 90, width: 640, height: 360,
  frameRate: { num: 24, den: 1 }, hasAudio: true, status: 'ready',
};
const sourceDrag: SourceDragSpan = {
  projectId: 'mock-a', sessionId: 'session-a', assetId: 'workshop', assetVersion: 'v1',
  sourceIn: 10, sourceOut: 14, viewerId: 'source',
};
const clipDrag: TimelineClipDrag = {
  projectId: 'mock-a', sessionId: 'session-a', expectedRevision: 1, sequenceId: 'main',
  sourceTrackId: 'v1', clipId: 'a', grabOffsetFrames: 1,
};

function setup(initialSequence: SequenceView = sequence) {
  const grok = new Grok(new GripRegistry());
  const projectTap = createAtomValueTap(GVID_PROJECT_VIEW, { initial: project });
  const graphTap = createAtomValueTap(GVID_GRAPH_VIEW, { initial: { graphId: 'graph-a', revision: 1, sequence: initialSequence } });
  const sequenceTap = createAtomValueTap(GVID_SEQUENCE_VIEW, { initial: initialSequence });
  const statusTap = createAtomValueTap(GVID_CHANGE_STATUS, { initial: { state: 'live' } as ChangeStatus });
  for (const tap of [projectTap, graphTap, sequenceTap, statusTap]) grok.registerTap(tap);
  const context = grok.mainPresentationContext.getOrCreateMatchingContext('tab:timeline-test');
  const tap = new TimelineTabTap('timeline-test');
  context.getGripHomeContext().registerTap(tap);
  const read = <T>(grip: Grip<T>): T | undefined => {
    const drip = context.getGripConsumerContext().getOrCreateConsumer(grip);
    drip.subscribe(() => {});
    grok.flush();
    return drip.get();
  };
  read(GVID_TIMELINE_TRANSPORT);
  return { grok, tap, projectTap, graphTap, sequenceTap, statusTap, context, read };
}

afterEach(() => vi.useRealTimers());

describe('timeline tab transport', () => {
  it('routes wheel motion vertically and Shift+wheel horizontally', () => {
    expect(timelineWheelMovement({ deltaX: 50, deltaY: 120, deltaMode: 0, shiftKey: false }, 8, 200))
      .toEqual({ axis: 'vertical', pixels: 120 });
    expect(timelineWheelMovement({ deltaX: 0, deltaY: 3, deltaMode: 1, shiftKey: false }, 8, 200))
      .toEqual({ axis: 'vertical', pixels: 48 });
    expect(timelineWheelMovement({ deltaX: 0, deltaY: 120, deltaMode: 0, shiftKey: true }, 8, 200))
      .toEqual({ axis: 'horizontal', frames: 15 });
    expect(timelineWheelMovement({ deltaX: -80, deltaY: 0, deltaMode: 0, shiftKey: true }, 8, 200))
      .toEqual({ axis: 'horizontal', frames: -10 });
  });

  it('orders V tracks high-to-low above A tracks low-to-high and projects both halves', () => {
    const paired: SequenceView = { ...sequence, tracks: [
      { ...sequence.tracks[0], clips: sequence.tracks[0].clips.map((clip) =>
        ({ ...clip, linkedClipId: `audio-${clip.id}` })) },
      { id: 'v2', label: 'V2', kind: 'video', locked: false, clips: [] },
      { id: 'a1', label: 'A1', kind: 'audio', locked: false, clips: sequence.tracks[0].clips.map((clip) =>
        ({ ...clip, id: `audio-${clip.id}`, linkedClipId: clip.id })) },
      { id: 'a2', label: 'A2', kind: 'audio', locked: false, clips: [] },
    ] };
    expect(orderedTimelineTracks(paired).map((track) => track.id)).toEqual(['v2', 'v1', 'a1', 'a2']);
    expect(projectDropPreview(paired, 'a2', 8, { kind: 'source', span: sourceDrag, asset }))
      .toMatchObject({ targetTrackId: 'v2', resolvedTrackId: 'v2', hasAudio: true, frame: 8 });
    expect(projectDropPreview(paired, 'a2', 10, { kind: 'clip', moving: {
      ...clipDrag, sourceTrackId: 'a1', clipId: 'audio-a',
    } })).toMatchObject({ targetTrackId: 'v2', sourceTrackId: 'a1',
      resolvedTrackId: 'v2', hasAudio: true, frame: 9 });
    expect(projectDropPreview(paired, 'a2', 8, { kind: 'source', span: sourceDrag,
      asset: { ...asset, hasAudio: false } })).toBeNull();
  });
  it('snaps clicks and drops to the nearest frame line, with ties biased left', () => {
    expect(frameFromTimelineX(139.9, 100, 0, 8)).toBe(5);
    expect(frameFromTimelineX(140, 100, 0, 8)).toBe(5);
    expect(frameFromTimelineX(136, 100, 0, 8)).toBe(4);
    expect(frameFromTimelineX(136.01, 100, 0, 8)).toBe(5);
    expect(frameFromTimelineX(139.9, 100, 20, 8)).toBe(25);
    expect(frameFromTimelineX(119.9, 100, 20, 4)).toBe(25);
    expect(frameFromTimelineX(80, 100, 20, 8)).toBe(17);
    expect(frameFromTimelineX(80, 100, 0, 8)).toBe(0);
  });

  it('projects source drops into the hovered track or a new top track on overlap', () => {
    expect(projectDropPreview(sequence, 'v1', 8, { kind: 'source', span: sourceDrag, asset }))
      .toMatchObject({ kind: 'source', frame: 8, sourceIn: 10, sourceOut: 14,
        targetTrackId: 'v1', resolvedTrackId: 'v1', createsTrack: false });
    expect(projectDropPreview(sequence, 'v1', 3, { kind: 'source', span: sourceDrag, asset }))
      .toMatchObject({ frame: 3, targetTrackId: 'v1', resolvedTrackId: 'v2', createsTrack: true });
    expect(projectDropPreview(sequence, 'v1', 3, { kind: 'source', span: { ...sourceDrag, sourceOut: 91 }, asset }))
      .toBeNull();
    expect(projectDropPreview(sequence, 'v1', 3, { kind: 'source', span: sourceDrag,
      asset: { ...asset, version: 'v2' } })).toBeNull();
  });

  it('projects clip moves with grab offset and excludes the moving clip from collision', () => {
    expect(projectDropPreview(sequence, 'v1', 1, { kind: 'clip', moving: clipDrag }))
      .toMatchObject({ kind: 'clip', clipId: 'a', frame: 0, sourceIn: 12, sourceOut: 16,
        resolvedTrackId: 'v1', createsTrack: false });
    expect(projectDropPreview(sequence, 'v1', 6, { kind: 'clip', moving: clipDrag }))
      .toMatchObject({ frame: 5, targetTrackId: 'v1', resolvedTrackId: 'v2', createsTrack: true });
    expect(projectDropPreview(sequence, 'missing', 6, { kind: 'clip', moving: clipDrag })).toBeNull();
    expect(projectDropPreview({ ...sequence, tracks: [{ ...sequence.tracks[0], locked: true }] }, 'v1', 6,
      { kind: 'clip', moving: clipDrag })).toBeNull();
  });

  it('snaps clip starts, ends, and trim edges only within the pixel tolerance', () => {
    expect(snapTimelineFrame(sequence, 5, { pixelsPerFrame: 8 })).toBe(4);
    expect(snapTimelineFrame(sequence, 6, { pixelsPerFrame: 8 })).toBe(6);
    expect(snapTimelineFrame(sequence, 9, { pixelsPerFrame: 8, spanFrames: 5 })).toBe(8);
    expect(snapTimelineFrame(sequence, 10, { pixelsPerFrame: 8, anchors: [11] })).toBe(11);
    expect(snapTimelineFrame(sequence, 5, { pixelsPerFrame: 8, minFrame: 5, maxFrame: 7 })).toBe(5);
  });

  it('visits current clip edges before adjacent clip edges', () => {
    expect(clipBoundaryFrame(sequence, 2, 'up')).toBe(0);
    expect(clipBoundaryFrame(sequence, 0, 'up')).toBe(0);
    expect(clipBoundaryFrame(sequence, 4, 'up')).toBe(3);
    expect(clipBoundaryFrame(sequence, 1, 'down')).toBe(3);
    expect(clipBoundaryFrame(sequence, 3, 'down')).toBe(4);
    expect(clipBoundaryFrame(sequence, 6, 'down')).toBe(7);
    expect(clipBoundaryFrame(sequence, 7, 'down')).toBe(7);
  });

  it('jumps across gaps and visits overlapping clip boundaries', () => {
    const withGap: SequenceView = { ...sequence, durationFrames: 12, tracks: [{ ...sequence.tracks[0], clips: [
      { ...sequence.tracks[0].clips[0], timelineOut: 2, sourceOut: 14 },
      { ...sequence.tracks[0].clips[1], timelineIn: 6, timelineOut: 10 },
    ] }] };
    expect(clipBoundaryFrame(withGap, 4, 'up')).toBe(1);
    expect(clipBoundaryFrame(withGap, 4, 'down')).toBe(6);
    expect(clipBoundaryFrame(withGap, 11, 'up')).toBe(9);
    expect(clipBoundaryFrame(withGap, 11, 'down')).toBe(11);
    const layered: SequenceView = { ...sequence, tracks: [...sequence.tracks, {
      id: 'v2', label: 'V2', kind: 'video', locked: false,
      clips: [{ id: 'top', assetId: 'workshop', sourceIn: 0, sourceOut: 2, timelineIn: 2, timelineOut: 4 }],
    }] };
    expect(clipBoundaryFrame(layered, 3, 'up')).toBe(2);
  });

  it('chooses the closest boundary across video and audio tracks', () => {
    const layered: SequenceView = { ...sequence, durationFrames: 24, tracks: [
      { id: 'v1', label: 'V1', kind: 'video', locked: false, clips: [
        { id: 'lower', assetId: 'workshop', sourceIn: 0, sourceOut: 4, timelineIn: 8, timelineOut: 12 },
      ] },
      { id: 'v2', label: 'V2', kind: 'video', locked: false, clips: [
        { id: 'upper', assetId: 'lighthouse', sourceIn: 0, sourceOut: 20, timelineIn: 0, timelineOut: 20 },
      ] },
      { id: 'a3', label: 'A3', kind: 'audio', locked: false, clips: [
        { id: 'audio', assetId: 'workshop', sourceIn: 0, sourceOut: 3, timelineIn: 13, timelineOut: 16 },
      ] },
    ] };
    expect(clipBoundaryFrame(layered, 10, 'up')).toBe(8);
    expect(clipBoundaryFrame(layered, 10, 'down')).toBe(11);
    expect(clipBoundaryFrame(layered, 11, 'down')).toBe(13);
    expect(clipBoundaryFrame(layered, 13, 'down')).toBe(15);
    expect(clipBoundaryFrame(layered, 15, 'down')).toBe(19);
    expect(clipBoundaryFrame(layered, 8, 'up')).toBe(0);
  });

  it('keeps exact pending, valid and invalid half-open marks', () => {
    expect(boundedFrame(8, 8)).toBeNull();
    expect(markState(null, null, 8).validity).toBe('unset');
    expect(markState(2, null, 8).validity).toBe('pending');
    expect(markState(null, 1, 8).validity).toBe('pending');
    expect(markState(2, 8, 8).validity).toBe('valid');
    expect(markState(2, 2, 8).validity).toBe('invalid');
    expect(markState(2, 9, 8).validity).toBe('invalid');
  });

  it('keeps timeline marks when selecting a different clip on the sequence', () => {
    const { tap, read } = setup();
    tap.transportControl.seek(1);
    tap.marksControl.setIn();
    tap.transportControl.seek(6);
    tap.marksControl.setOut();
    tap.selectionHandle.set({ trackId: 'v1', clipId: 'a' });
    tap.selectionHandle.set({ trackId: 'v1', clipId: 'b' });
    expect(read(GVID_TIMELINE_MARKS)).toMatchObject({ inFrame: 1, outFrame: 7, validity: 'valid' });
    expect(read(GVID_TIMELINE_SELECTION)).toMatchObject({ trackId: 'v1', clipId: 'b' });
  });

  it('starts at In when outside and pauses without showing Out', () => {
    vi.useFakeTimers();
    const { tap, read } = setup();
    expect(read(GVID_DEST_TIMELINE_FRAME)).toBe(0);
    tap.transportControl.seek(2);
    tap.marksControl.setIn();
    expect(read(GVID_TIMELINE_MARKS)?.validity).toBe('pending');
    tap.transportControl.seek(5);
    tap.marksControl.setOut();
    expect(read(GVID_TIMELINE_MARKS)).toMatchObject({ inFrame: 2, outFrame: 6, validity: 'valid' });
    tap.transportControl.seek(6);
    tap.transportControl.play();
    expect(read(GVID_DEST_TIMELINE_FRAME)).toBe(2);
    vi.advanceTimersByTime(250);
    expect(read(GVID_DEST_TIMELINE_FRAME)).toBe(5);
    expect(read(GVID_TIMELINE_TRANSPORT)?.playing).toBe(false);
    tap.transportControl.seek(0);
    tap.transportControl.play();
    expect(read(GVID_DEST_TIMELINE_FRAME)).toBe(2);
    tap.transportControl.pause();
  });

  it('keeps Out - 1 on Play and pauses on the next tick', () => {
    vi.useFakeTimers();
    const { tap, read } = setup();
    tap.transportControl.seek(2);
    tap.marksControl.setIn();
    tap.transportControl.seek(5);
    tap.marksControl.setOut();
    tap.transportControl.play();
    expect(read(GVID_DEST_TIMELINE_FRAME)).toBe(5);
    expect(read(GVID_TIMELINE_TRANSPORT)?.playing).toBe(true);
    vi.advanceTimersByTime(42);
    expect(read(GVID_DEST_TIMELINE_FRAME)).toBe(5);
    expect(read(GVID_TIMELINE_TRANSPORT)?.playing).toBe(false);
  });

  it('keeps the final unmarked frame until playback stops', () => {
    vi.useFakeTimers();
    const { tap, read } = setup();
    tap.transportControl.seek(7);
    tap.transportControl.play();
    expect(read(GVID_DEST_TIMELINE_FRAME)).toBe(7);
    vi.advanceTimersByTime(42);
    expect(read(GVID_DEST_TIMELINE_FRAME)).toBe(7);
    expect(read(GVID_TIMELINE_TRANSPORT)?.playing).toBe(false);
  });

  it('shuttles backward and forward, accelerates on repeated direction, and stops on K', () => {
    vi.useFakeTimers();
    const { tap, read } = setup();
    tap.transportControl.seek(5);
    tap.transportControl.shuttle(-1);
    expect(read(GVID_TIMELINE_TRANSPORT)?.shuttleRate).toBe(-1);
    vi.advanceTimersByTime(42);
    expect(read(GVID_DEST_TIMELINE_FRAME)).toBe(4);
    tap.transportControl.shuttle(-1);
    expect(read(GVID_TIMELINE_TRANSPORT)?.shuttleRate).toBe(-2);
    vi.advanceTimersByTime(42);
    expect(read(GVID_DEST_TIMELINE_FRAME)).toBe(2);
    tap.transportControl.shuttle(1);
    expect(read(GVID_TIMELINE_TRANSPORT)?.shuttleRate).toBe(1);
    vi.advanceTimersByTime(42);
    expect(read(GVID_DEST_TIMELINE_FRAME)).toBe(3);
    tap.transportControl.shuttle(0);
    expect(read(GVID_TIMELINE_TRANSPORT)).toMatchObject({ playing: false, shuttleRate: 0 });
  });

  it('shuttles backward inside marked bounds without publishing the exclusive Out', () => {
    vi.useFakeTimers();
    const { tap, read } = setup();
    tap.transportControl.seek(2);
    tap.marksControl.setIn();
    tap.transportControl.seek(5);
    tap.marksControl.setOut();
    tap.transportControl.seek(7);
    tap.transportControl.shuttle(-1);
    expect(read(GVID_DEST_TIMELINE_FRAME)).toBe(5);
    vi.advanceTimersByTime(42);
    expect(read(GVID_DEST_TIMELINE_FRAME)).toBe(4);
    vi.advanceTimersByTime(125);
    expect(read(GVID_DEST_TIMELINE_FRAME)).toBe(2);
    expect(read(GVID_TIMELINE_TRANSPORT)).toMatchObject({ playing: false, shuttleRate: 0 });
  });

  it('keeps an Out-only mark at frame zero pending without limiting playback', () => {
    vi.useFakeTimers();
    const { tap, read } = setup();
    tap.marksControl.setOut();
    expect(read(GVID_TIMELINE_MARKS)).toMatchObject({ inFrame: null, outFrame: 1, validity: 'pending' });
    tap.transportControl.play();
    vi.advanceTimersByTime(42);
    expect(read(GVID_DEST_TIMELINE_FRAME)).toBe(1);
    expect(read(GVID_TIMELINE_TRANSPORT)?.playing).toBe(true);
    tap.transportControl.pause();
  });

  it('marks the sequence end as Out and never publishes that boundary as a frame', () => {
    vi.useFakeTimers();
    const { tap, read, context, grok } = setup({ ...sequence, durationFrames: 96 });
    const frameDrip = context.getGripConsumerContext().getOrCreateConsumer(GVID_DEST_TIMELINE_FRAME);
    const publishedFrames: Array<number | null | undefined> = [];
    frameDrip.subscribe(() => publishedFrames.push(frameDrip.get()));
    grok.flush();
    tap.transportControl.seek(94);
    tap.marksControl.setIn();
    tap.transportControl.seek(95);
    tap.marksControl.setOut();
    expect(read(GVID_TIMELINE_MARKS)).toMatchObject({ inFrame: 94, outFrame: 96, validity: 'valid' });
    tap.transportControl.seek(94);
    tap.transportControl.play();
    vi.advanceTimersByTime(42);
    expect(read(GVID_DEST_TIMELINE_FRAME)).toBe(95);
    expect(read(GVID_TIMELINE_TRANSPORT)?.playing).toBe(true);
    vi.advanceTimersByTime(42);
    expect(read(GVID_DEST_TIMELINE_FRAME)).toBe(95);
    expect(read(GVID_TIMELINE_TRANSPORT)?.playing).toBe(false);
    expect(publishedFrames).toContain(95);
    expect(publishedFrames).not.toContain(96);
  });

  it('pauses on a revision gap and invalidates marks on a shorter accepted sequence', () => {
    vi.useFakeTimers();
    const { tap, read, sequenceTap, graphTap, projectTap, grok } = setup();
    tap.transportControl.seek(2);
    tap.marksControl.setIn();
    tap.transportControl.seek(6);
    tap.marksControl.setOut();
    tap.transportControl.play();
    const shorter = { ...sequence, revision: 2, durationFrames: 5 };
    graphTap.set({ graphId: 'graph-a', revision: 2, sequence: shorter });
    grok.flush();
    expect(read(GVID_TIMELINE_TRANSPORT)?.playing).toBe(false);
    expect(read(GVID_DEST_TIMELINE_FRAME)).toBeNull();
    sequenceTap.set(shorter);
    projectTap.set({ ...project, revision: 2 });
    grok.flush();
    expect(read(GVID_TIMELINE_MARKS)?.validity).toBe('invalid');
    expect(read(GVID_TIMELINE_TRANSPORT)?.disabledReason).toMatch(/In must precede Out/);
    tap.transportControl.play();
    expect(read(GVID_TIMELINE_TRANSPORT)?.playing).toBe(false);
  });

  it('clears owner-bound state and repairs removed clip selection', () => {
    const { tap, read, sequenceTap, graphTap, projectTap, grok } = setup();
    tap.selectionHandle.set({ trackId: 'v1', clipId: 'a' });
    const revised = { ...sequence, revision: 2, tracks: [{ ...sequence.tracks[0], clips: [sequence.tracks[0].clips[1]] }] };
    sequenceTap.set(revised);
    graphTap.set({ graphId: 'graph-a', revision: 2, sequence: revised });
    projectTap.set({ ...project, revision: 2 });
    grok.flush();
    expect(read(GVID_TIMELINE_SELECTION)).toEqual({ trackId: 'v1', clipId: null });
    tap.transportControl.seek(3);
    tap.marksControl.setIn();
    const nextProject = { ...project, projectId: 'mock-b', sessionId: 'session-b', revision: 1 };
    const nextSequence = { ...sequence, revision: 1 };
    projectTap.set(nextProject);
    graphTap.set({ graphId: 'graph-a', revision: 1, sequence: nextSequence } as GraphView);
    sequenceTap.set(nextSequence);
    grok.flush();
    expect(read(GVID_TIMELINE_MARKS)?.validity).toBe('unset');
    expect(read(GVID_DEST_TIMELINE_FRAME)).toBe(0);
    expect(read(GVID_TIMELINE_SELECTION)).toEqual({ trackId: null, clipId: null });
  });

  it('keeps marks, selection and viewport local to each timeline tab', () => {
    const { grok, tap, read } = setup();
    const otherContext = grok.mainPresentationContext.getOrCreateMatchingContext('tab:timeline-other');
    const other = new TimelineTabTap('timeline-other');
    otherContext.getGripHomeContext().registerTap(other);
    const otherRead = <T>(grip: Grip<T>) => {
      const drip = otherContext.getGripConsumerContext().getOrCreateConsumer(grip);
      drip.subscribe(() => {});
      grok.flush();
      return drip.get();
    };
    otherRead(GVID_TIMELINE_TRANSPORT);
    tap.transportControl.seek(3);
    tap.marksControl.setIn();
    tap.selectionHandle.set({ trackId: 'v1', clipId: 'a' });
    tap.viewportHandle.set({ startFrame: 4, pixelsPerFrame: 16, verticalScroll: 0,
      snapEnabled: false, showKeyframes: true, keyframeTool: null });
    expect(read(GVID_TIMELINE_MARKS)?.inFrame).toBe(3);
    expect(otherRead(GVID_TIMELINE_MARKS)?.validity).toBe('unset');
    expect(otherRead(GVID_TIMELINE_SELECTION)).toEqual({ trackId: null, clipId: null });
    expect(other.viewportHandle.get()).toEqual({ startFrame: 0, pixelsPerFrame: 8,
      verticalScroll: 0, snapEnabled: true, showKeyframes: false, keyframeTool: null });
    expect(otherRead(GVID_DEST_TIMELINE_FRAME)).toBe(0);
  });

  it('validates keyframe manipulator focus and closes it when hidden', () => {
    const withKeyframe: SequenceView = { ...sequence, tracks: [{ ...sequence.tracks[0], clips: [
      { ...sequence.tracks[0].clips[0], keyframes: [{ id: 'keyframe-1', sourceFrame: 13 }] },
      sequence.tracks[0].clips[1],
    ] }] };
    const { tap } = setup(withKeyframe);
    const initial = tap.viewportHandle.get();
    tap.viewportHandle.set({ ...initial, showKeyframes: true, keyframeTool: {
      sessionId: 'stale', trackId: 'v1', clipId: 'a', keyframeId: 'keyframe-1',
    } });
    expect(tap.viewportHandle.get().keyframeTool).toBeNull();
    tap.viewportHandle.set({ ...initial, showKeyframes: true, keyframeTool: {
      sessionId: project.sessionId, trackId: 'v1', clipId: 'a', keyframeId: 'keyframe-1',
    } });
    expect(tap.viewportHandle.get().keyframeTool?.keyframeId).toBe('keyframe-1');
    tap.viewportHandle.set({ ...tap.viewportHandle.get(), showKeyframes: false, keyframeTool: null });
    expect(tap.viewportHandle.get()).toMatchObject({ showKeyframes: false, keyframeTool: null });
  });
});
