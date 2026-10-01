import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAtomValueTap, GripRegistry, Grok, type Grip } from '@owebeeone/grip-react';
import {
  GVID_CHANGE_STATUS, GVID_DEST_TIMELINE_FRAME, GVID_GRAPH_VIEW, GVID_PROJECT_VIEW,
  GVID_SEQUENCE_VIEW, GVID_TIMELINE_MARKS, GVID_TIMELINE_SELECTION,
  GVID_TIMELINE_TRANSPORT, type ChangeStatus, type GraphView, type ProjectView,
  type SequenceView,
} from '@gvidjs/contracts';
import { boundedFrame, markState, TimelineTabTap } from './timeline';

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
  it('keeps exact pending, valid and invalid half-open marks', () => {
    expect(boundedFrame(8, 8)).toBeNull();
    expect(markState(null, null, 8).validity).toBe('unset');
    expect(markState(2, null, 8).validity).toBe('pending');
    expect(markState(null, 1, 8).validity).toBe('pending');
    expect(markState(2, 8, 8).validity).toBe('valid');
    expect(markState(2, 2, 8).validity).toBe('invalid');
    expect(markState(2, 9, 8).validity).toBe('invalid');
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
    tap.viewportHandle.set({ startFrame: 4, pixelsPerFrame: 16, verticalScroll: 0 });
    expect(read(GVID_TIMELINE_MARKS)?.inFrame).toBe(3);
    expect(otherRead(GVID_TIMELINE_MARKS)?.validity).toBe('unset');
    expect(otherRead(GVID_TIMELINE_SELECTION)).toEqual({ trackId: null, clipId: null });
    expect(other.viewportHandle.get()).toEqual({ startFrame: 0, pixelsPerFrame: 8, verticalScroll: 0 });
    expect(otherRead(GVID_DEST_TIMELINE_FRAME)).toBe(0);
  });
});
