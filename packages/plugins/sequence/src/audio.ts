import { BaseTap, type Grip, type GripContext } from '@owebeeone/grip-react';
import {
  GVID_ASSET_CATALOG, GVID_CHANGE_STATUS, GVID_GRAPH_VIEW, GVID_PROJECT_VIEW, GVID_SEQUENCE_AUDIO_CONTROL,
  GVID_SEQUENCE_AUDIO_VIEW, GVID_SEQUENCE_DESTINATION, GVID_SEQUENCE_VIEW,
  GVID_TIMELINE_TRANSPORT,
  type AssetRecord, type ChangeStatus, type GraphView, type ProjectView, type SequenceAudioControl,
  type SequenceAudioView, type SequenceDestination, type SequenceView, type TransportView,
} from '@gvidjs/contracts';

export interface AudibleClip {
  trackId: string;
  clipId: string;
  assetId: string;
}

export function audibleClipsAt(sequence: SequenceView, frame: number): readonly AudibleClip[] {
  return sequence.tracks.filter((track) => track.kind === 'audio' && !track.muted)
    .flatMap((track) => track.clips.filter((clip) =>
      clip.timelineIn <= frame && frame < clip.timelineOut).map((clip) => ({
      trackId: track.id, clipId: clip.id, assetId: clip.assetId,
    })));
}

function mockFrequency(assetId: string): number {
  let hash = 0;
  for (const char of assetId) hash = (hash * 31 + char.charCodeAt(0)) % 240;
  return 180 + hash;
}

interface Voice {
  clipId: string;
  oscillator: OscillatorNode;
  gain: GainNode;
}

export class SequenceAudioPreviewTap extends BaseTap {
  private context: AudioContext | null = null;
  private readonly voices = new Map<string, Voice>();
  private detached = false;
  private readonly control: SequenceAudioControl = { enable: () => this.resume() };

  constructor() {
    super({
      provides: [GVID_SEQUENCE_AUDIO_VIEW, GVID_SEQUENCE_AUDIO_CONTROL],
      homeParamGrips: [GVID_SEQUENCE_DESTINATION, GVID_PROJECT_VIEW, GVID_GRAPH_VIEW,
        GVID_CHANGE_STATUS,
        GVID_SEQUENCE_VIEW, GVID_TIMELINE_TRANSPORT, GVID_ASSET_CATALOG],
    });
  }

  private stop(trackId: string): void {
    const voice = this.voices.get(trackId);
    if (!voice) return;
    voice.oscillator.stop();
    voice.oscillator.disconnect();
    voice.gain.disconnect();
    this.voices.delete(trackId);
  }

  private stopAll(): void {
    for (const trackId of this.voices.keys()) this.stop(trackId);
  }

  private resume(): void {
    if (!this.context || this.context.state === 'running') return;
    void this.context.resume().then(() => {
      if (!this.detached) this.produce();
    }, () => {
      if (!this.detached) this.produce();
    });
  }

  private activeClips(): readonly AudibleClip[] {
    const destination = this.paramDrips.get(GVID_SEQUENCE_DESTINATION)?.get() as SequenceDestination | undefined;
    const project = this.paramDrips.get(GVID_PROJECT_VIEW)?.get() as ProjectView | undefined;
    const change = this.paramDrips.get(GVID_CHANGE_STATUS)?.get() as ChangeStatus | undefined;
    const graph = this.paramDrips.get(GVID_GRAPH_VIEW)?.get() as GraphView | undefined;
    const sequence = this.paramDrips.get(GVID_SEQUENCE_VIEW)?.get() as SequenceView | undefined;
    const transport = this.paramDrips.get(GVID_TIMELINE_TRANSPORT)?.get() as TransportView | undefined;
    const assets = this.paramDrips.get(GVID_ASSET_CATALOG)?.get() as readonly AssetRecord[] | undefined;
    if (destination?.mode !== 'wired' || destination.timelineFrame === null ||
      !project?.projectId || project.status !== 'ready' || change?.state !== 'live' || !graph || !sequence ||
      destination.projectId !== project.projectId || destination.sessionId !== project.sessionId ||
      destination.sequenceId !== sequence.id || graph.sequence.id !== sequence.id ||
      graph.graphId !== project.graphId || sequence.graphId !== graph.graphId ||
      graph.revision !== sequence.revision || graph.revision !== project.revision ||
      !transport?.playing || transport.frame === null || transport.frame < 0 ||
      transport.frame >= sequence.durationFrames) return [];
    return audibleClipsAt(sequence, transport.frame).filter((clip) =>
      assets?.some((asset) => asset.id === clip.assetId && asset.hasAudio && asset.status === 'ready'));
  }

  produce(opts?: { destContext?: GripContext }): void {
    if (this.detached) return;
    const clips = this.activeClips();
    const activeIds = new Set(clips.map((clip) => clip.trackId));
    for (const trackId of this.voices.keys()) if (!activeIds.has(trackId)) this.stop(trackId);

    let state: SequenceAudioView['state'] = 'silent';
    if (clips.length > 0) {
      if (!this.context && typeof AudioContext !== 'undefined') {
        try { this.context = new AudioContext(); } catch { /* Browser audio is unavailable. */ }
      }
      if (!this.context) state = 'unavailable';
      else if (this.context.state !== 'running') state = 'blocked';
      else {
        for (const clip of clips) {
          if (this.voices.get(clip.trackId)?.clipId === clip.clipId) continue;
          this.stop(clip.trackId);
          const oscillator = this.context.createOscillator();
          const gain = this.context.createGain();
          oscillator.type = 'sine';
          oscillator.frequency.value = mockFrequency(clip.assetId);
          gain.gain.value = 0.018;
          oscillator.connect(gain);
          gain.connect(this.context.destination);
          oscillator.start();
          this.voices.set(clip.trackId, { clipId: clip.clipId, oscillator, gain });
        }
        state = 'playing';
      }
    }
    const view: SequenceAudioView = { state,
      activeTrackIds: state === 'playing' ? Object.freeze([...activeIds]) : Object.freeze([]) };
    this.publish(new Map<Grip<unknown>, unknown>([
      [GVID_SEQUENCE_AUDIO_VIEW, view], [GVID_SEQUENCE_AUDIO_CONTROL, this.control],
    ]), opts?.destContext);
  }

  produceOnParams(): void { this.produce(); }
  produceOnDestParams(): void {}

  onDetach(): void {
    this.detached = true;
    this.stopAll();
    if (this.context) void this.context.close();
    this.context = null;
    super.onDetach();
  }
}
