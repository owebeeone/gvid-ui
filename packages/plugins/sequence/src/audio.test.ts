import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAtomValueTap, GripRegistry, Grok } from '@owebeeone/grip-react';
import {
  GVID_ASSET_CATALOG, GVID_CHANGE_STATUS, GVID_GRAPH_VIEW, GVID_PROJECT_VIEW, GVID_SEQUENCE_AUDIO_VIEW,
  GVID_SEQUENCE_DESTINATION, GVID_SEQUENCE_VIEW, GVID_TIMELINE_TRANSPORT,
  type AssetRecord, type ProjectView, type SequenceDestination, type SequenceView,
  type TransportView,
} from '@gvidjs/contracts';
import { audibleClipsAt, SequenceAudioPreviewTap } from './audio';

const sequence: SequenceView = {
  id: 'main', graphId: 'graph-a', revision: 1, frameRate: { num: 24, den: 1 }, durationFrames: 8,
  tracks: [
    { id: 'v1', label: 'V1', kind: 'video', locked: false, clips: [
      { id: 'v-clip', assetId: 'asset-a', sourceIn: 0, sourceOut: 8, timelineIn: 0, timelineOut: 8,
        linkedClipId: 'a-clip' },
    ] },
    { id: 'a1', label: 'A1', kind: 'audio', locked: false, clips: [
      { id: 'a-clip', assetId: 'asset-a', sourceIn: 0, sourceOut: 8, timelineIn: 0, timelineOut: 8,
        linkedClipId: 'v-clip' },
    ] },
  ],
};
const asset: AssetRecord = {
  id: 'asset-a', displayName: 'Asset A', version: 'v1', fingerprint: 'a', streamId: 'video-0',
  frameCount: 8, width: 640, height: 360, frameRate: { num: 24, den: 1 }, hasAudio: true,
  status: 'ready',
};
const project: ProjectView = {
  projectId: 'mock-a', sessionId: 'session-a', graphId: 'graph-a', revision: 1,
  bindingSetId: 'bind-a', bindingRevision: 1, sessionOnly: true, status: 'ready',
};
const destination: SequenceDestination = {
  viewerId: 'viewer', projectId: 'mock-a', sessionId: 'session-a', sequenceId: 'main',
  timelineFrame: 0, mode: 'wired',
};
const transport: TransportView = {
  frame: 0, frameCount: 8, playing: true, shuttleRate: 1, rate: { num: 24, den: 1 },
};

afterEach(() => vi.unstubAllGlobals());

describe('sequence audio preview', () => {
  it('selects unmuted A tracks independently of video visibility', () => {
    expect(audibleClipsAt(sequence, 0)).toEqual([
      { trackId: 'a1', clipId: 'a-clip', assetId: 'asset-a' },
    ]);
    expect(audibleClipsAt({ ...sequence, tracks: [
      { ...sequence.tracks[0], hidden: true }, sequence.tracks[1],
    ] }, 0)).toHaveLength(1);
    expect(audibleClipsAt({ ...sequence, tracks: [sequence.tracks[0],
      { ...sequence.tracks[1], muted: true },
    ] }, 0)).toEqual([]);
    expect(audibleClipsAt(sequence, 8)).toEqual([]);
  });

  it('stops the mock sound on mute or pause, without stopping it for hidden video', () => {
    const started = vi.fn();
    const stopped = vi.fn();
    class MockAudioContext {
      state = 'running';
      destination = {};
      createOscillator() {
        return { type: 'sine', frequency: { value: 0 }, connect: vi.fn(),
          disconnect: vi.fn(), start: started, stop: stopped };
      }
      createGain() {
        return { gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
      }
      close() { this.state = 'closed'; return Promise.resolve(); }
    }
    vi.stubGlobal('AudioContext', MockAudioContext);
    const grok = new Grok(new GripRegistry());
    const sequenceTap = createAtomValueTap(GVID_SEQUENCE_VIEW, { initial: sequence });
    const transportTap = createAtomValueTap(GVID_TIMELINE_TRANSPORT, { initial: transport });
    const statusTap = createAtomValueTap(GVID_CHANGE_STATUS, { initial: { state: 'live' as const } });
    for (const tap of [
      sequenceTap, transportTap, statusTap,
      createAtomValueTap(GVID_SEQUENCE_DESTINATION, { initial: destination }),
      createAtomValueTap(GVID_PROJECT_VIEW, { initial: project }),
      createAtomValueTap(GVID_GRAPH_VIEW, { initial: { graphId: 'graph-a', revision: 1, sequence } }),
      createAtomValueTap(GVID_ASSET_CATALOG, { initial: [asset] }),
    ]) grok.registerTap(tap);
    const viewer = grok.mainPresentationContext.getOrCreateMatchingContext('tab:viewer');
    const tap = new SequenceAudioPreviewTap();
    viewer.getGripHomeContext().registerTap(tap);
    const drip = viewer.getGripConsumerContext().getOrCreateConsumer(GVID_SEQUENCE_AUDIO_VIEW);
    drip.subscribe(() => {});
    grok.flush();
    expect(drip.get()).toEqual({ state: 'playing', activeTrackIds: ['a1'] });
    expect(started).toHaveBeenCalledTimes(1);

    transportTap.set({ ...transport, frame: 1 });
    grok.flush();
    expect(drip.get()?.state).toBe('playing');
    expect(started).toHaveBeenCalledTimes(1);
    expect(stopped).not.toHaveBeenCalled();

    sequenceTap.set({ ...sequence, tracks: [{ ...sequence.tracks[0], hidden: true }, sequence.tracks[1]] });
    grok.flush();
    expect(drip.get()?.state).toBe('playing');
    expect(stopped).not.toHaveBeenCalled();

    sequenceTap.set({ ...sequence, tracks: [sequence.tracks[0], { ...sequence.tracks[1], muted: true }] });
    grok.flush();
    expect(drip.get()).toEqual({ state: 'silent', activeTrackIds: [] });
    expect(stopped).toHaveBeenCalledTimes(1);

    sequenceTap.set(sequence);
    grok.flush();
    expect(started).toHaveBeenCalledTimes(2);
    statusTap.set({ state: 'stale', reason: 'revision gap' });
    grok.flush();
    expect(stopped).toHaveBeenCalledTimes(2);
    statusTap.set({ state: 'live' });
    grok.flush();
    expect(started).toHaveBeenCalledTimes(3);
    transportTap.set({ ...transport, playing: false, shuttleRate: 0 });
    grok.flush();
    expect(stopped).toHaveBeenCalledTimes(3);
    viewer.getGripHomeContext().unregisterTap(tap);
  });
});
