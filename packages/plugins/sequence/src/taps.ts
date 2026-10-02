import { DESKTOP_TAB_LINKS, type DesktopTabLinkInfo } from '@grythjs/desktop';
import { BaseTap, createAtomValueTap, type GripContext, type Tap } from '@owebeeone/grip-react';
import {
  GVID_ASSET_CATALOG, GVID_BINDING_VIEW, GVID_CHANGE_STATUS, GVID_DEST_SEQUENCE_ID,
  GVID_DEST_TIMELINE_FRAME, GVID_DEST_VIEWER_ID, GVID_FRAME_PROVIDER, GVID_GRAPH_VIEW,
  GVID_PROJECT_VIEW, GVID_SEQUENCE_DESTINATION, GVID_SEQUENCE_LINK,
  GVID_SEQUENCE_PRESENTATION, GVID_SEQUENCE_PREVIEW_RESULT, GVID_SEQUENCE_VIEW,
  GVID_TOOLS,
  type AssetRecord, type BindingView, type ChangeStatus, type FramePresentation,
  type FrameProvider, type FrameResult, type GraphView, type ProjectView,
  type SequenceClip, type SequenceDestination, type SequenceFrameKey, type SequenceView,
  type TabLinkView,
} from '@gvidjs/contracts';

function unresolved(viewerId: string, project?: ProjectView, reason = 'Sequence link is unavailable.'): SequenceDestination {
  return {
    viewerId, projectId: project?.projectId ?? null, sessionId: project?.sessionId ?? '',
    sequenceId: null, timelineFrame: null, mode: 'unresolved', reason,
  };
}

export function resolveSequenceDestination(
  viewerId: string,
  link: TabLinkView | undefined,
  links: readonly DesktopTabLinkInfo[],
  project: ProjectView | undefined,
  sequence: SequenceView | undefined,
  inheritedSequenceId: string | null | undefined,
  inheritedFrame: number | null | undefined,
): SequenceDestination {
  if (!link || !links.some((item) => item.tabId === viewerId)) return unresolved(viewerId, project);
  if (!project || project.status !== 'ready' || !project.projectId || !sequence) {
    return unresolved(viewerId, project, 'No ready project sequence.');
  }

  const wired = link.sourceTabId !== null;
  if (wired && !links.some((item) => item.tabId === link.sourceTabId && item.toolId === GVID_TOOLS.timeline)) {
    return unresolved(viewerId, project, 'Linked timeline tab is unavailable.');
  }
  const params = link.params;
  const requestedProject = wired ? project.projectId : params.projectId ?? project.projectId;
  if (requestedProject !== project.projectId) {
    return unresolved(viewerId, project, 'Linked project is not active.');
  }
  const sequenceId = wired ? inheritedSequenceId : params.sequenceId ?? sequence.id;
  if (typeof sequenceId !== 'string' || sequenceId !== sequence.id || sequence.graphId !== project.graphId) {
    return unresolved(viewerId, project, 'Sequence is not in the accepted project.');
  }
  const rawFrame = wired ? inheritedFrame : params.timelineFrame === undefined ? 0 : params.timelineFrame;
  if (typeof rawFrame !== 'number' || !Number.isSafeInteger(rawFrame) || rawFrame < 0 || rawFrame >= sequence.durationFrames) {
    return unresolved(viewerId, project, 'Timeline frame is outside the sequence.');
  }
  return {
    viewerId, projectId: project.projectId, sessionId: project.sessionId,
    sequenceId, timelineFrame: rawFrame, mode: wired ? 'wired' : 'standalone',
  };
}

export class SequenceLinkTabTap extends BaseTap {
  constructor(private readonly tabId: string) {
    super({ provides: [GVID_SEQUENCE_LINK], homeParamGrips: [DESKTOP_TAB_LINKS] });
  }

  produce(opts?: { destContext?: GripContext }): void {
    const links = (this.paramDrips.get(DESKTOP_TAB_LINKS)?.get() as DesktopTabLinkInfo[] | undefined) ?? [];
    const record = links.find((item) => item.tabId === this.tabId);
    const link: TabLinkView = {
      tabId: this.tabId, sourceTabId: record?.sourceTabId ?? null, params: record?.params ?? {},
    };
    this.publish(new Map([[GVID_SEQUENCE_LINK, link]]), opts?.destContext);
  }

  produceOnParams(): void { this.produce(); }
  produceOnDestParams(): void {}
}

export class SequenceDestinationTabTap extends BaseTap {
  constructor(private readonly tabId: string) {
    super({
      provides: [GVID_SEQUENCE_DESTINATION],
      homeParamGrips: [GVID_SEQUENCE_LINK, DESKTOP_TAB_LINKS, GVID_PROJECT_VIEW,
        GVID_SEQUENCE_VIEW, GVID_DEST_SEQUENCE_ID, GVID_DEST_TIMELINE_FRAME],
    });
  }

  produce(opts?: { destContext?: GripContext }): void {
    const value = resolveSequenceDestination(
      this.tabId,
      this.paramDrips.get(GVID_SEQUENCE_LINK)?.get(),
      this.paramDrips.get(DESKTOP_TAB_LINKS)?.get() ?? [],
      this.paramDrips.get(GVID_PROJECT_VIEW)?.get(),
      this.paramDrips.get(GVID_SEQUENCE_VIEW)?.get(),
      this.paramDrips.get(GVID_DEST_SEQUENCE_ID)?.get(),
      this.paramDrips.get(GVID_DEST_TIMELINE_FRAME)?.get(),
    );
    this.publish(new Map([[GVID_SEQUENCE_DESTINATION, value]]), opts?.destContext);
  }

  produceOnParams(): void { this.produce(); }
  produceOnDestParams(): void {}
}

interface RequestSnapshot {
  key: Omit<SequenceFrameKey, 'requestId' | 'cancelGroupId'>;
  clip: SequenceClip | null;
  asset: AssetRecord | null;
  signature: string;
}

function requestSnapshot(
  destination: SequenceDestination | undefined,
  project: ProjectView | undefined,
  graph: GraphView | undefined,
  sequence: SequenceView | undefined,
  binding: BindingView | undefined,
  assets: readonly AssetRecord[] | undefined,
): RequestSnapshot | null {
  if (!destination || destination.mode === 'unresolved' || !project || !graph || !sequence || !binding ||
    project.status !== 'ready' || !destination.projectId || destination.timelineFrame === null ||
    !destination.sequenceId || destination.projectId !== project.projectId ||
    destination.sessionId !== project.sessionId || graph.graphId !== project.graphId ||
    sequence.graphId !== graph.graphId || sequence.id !== destination.sequenceId ||
    graph.revision !== project.revision || sequence.revision !== graph.revision ||
    graph.sequence.id !== sequence.id || binding.bindingSetId !== project.bindingSetId ||
    binding.revision !== project.bindingRevision ||
    destination.timelineFrame < 0 || destination.timelineFrame >= sequence.durationFrames) return null;

  const frame = destination.timelineFrame;
  const clip = topmostClipAt(sequence, frame);
  const asset = clip ? assets?.find((item) => item.id === clip.assetId) ?? null : null;
  const key = {
    viewerId: destination.viewerId, sessionId: project.sessionId, projectId: project.projectId,
    graphId: graph.graphId, sequenceId: sequence.id, revision: graph.revision,
    bindingSetId: binding.bindingSetId, bindingRevision: binding.revision, timelineFrame: frame,
  };
  const signature = JSON.stringify([key, clip?.id, asset && [
    asset.id, asset.version, asset.fingerprint, asset.displayName, asset.status,
  ]]);
  return { key, clip, asset, signature };
}

export function topmostClipAt(sequence: SequenceView, frame: number): SequenceClip | null {
  for (let index = sequence.tracks.length - 1; index >= 0; index--) {
    const clip = sequence.tracks[index].clips.find((item) => item.timelineIn <= frame && frame < item.timelineOut);
    if (clip) return clip;
  }
  return null;
}

function sameKey(a: SequenceFrameKey, b: SequenceFrameKey): boolean {
  return a.requestId === b.requestId && a.cancelGroupId === b.cancelGroupId &&
    a.viewerId === b.viewerId && a.sessionId === b.sessionId && a.projectId === b.projectId &&
    a.graphId === b.graphId && a.sequenceId === b.sequenceId && a.revision === b.revision &&
    a.bindingSetId === b.bindingSetId && a.bindingRevision === b.bindingRevision &&
    a.timelineFrame === b.timelineFrame;
}

let nextRequest = 0;
let nextGroup = 0;

export class SequencePreviewProviderTap extends BaseTap {
  private readonly cancelGroupId: string;
  private active: { signature: string; key: SequenceFrameKey; provider: FrameProvider; abort: AbortController } | null = null;
  private held: { leaseId: string; provider: FrameProvider } | null = null;
  private result: FrameResult<SequenceFrameKey> | null = null;
  private detached = false;

  constructor(private readonly tabId: string) {
    super({
      provides: [GVID_SEQUENCE_PREVIEW_RESULT],
      homeParamGrips: [GVID_SEQUENCE_DESTINATION, GVID_PROJECT_VIEW, GVID_GRAPH_VIEW,
        GVID_SEQUENCE_VIEW, GVID_BINDING_VIEW, GVID_ASSET_CATALOG, GVID_FRAME_PROVIDER],
    });
    this.cancelGroupId = `${tabId}:sequence:${++nextGroup}`;
  }

  private snapshot(): RequestSnapshot | null {
    return requestSnapshot(
      this.paramDrips.get(GVID_SEQUENCE_DESTINATION)?.get(),
      this.paramDrips.get(GVID_PROJECT_VIEW)?.get(),
      this.paramDrips.get(GVID_GRAPH_VIEW)?.get(),
      this.paramDrips.get(GVID_SEQUENCE_VIEW)?.get(),
      this.paramDrips.get(GVID_BINDING_VIEW)?.get(),
      this.paramDrips.get(GVID_ASSET_CATALOG)?.get(),
    );
  }

  private releaseHeld(): void {
    if (this.held) {
      this.held.provider.release(this.held.leaseId);
      this.held = null;
    }
  }

  private clear(): void {
    this.active?.abort.abort();
    this.active = null;
    this.releaseHeld();
    this.result = null;
    this.publish(new Map([[GVID_SEQUENCE_PREVIEW_RESULT, null]]));
  }

  produce(opts?: { destContext?: GripContext }): void {
    if (this.detached) return;
    const snapshot = this.snapshot();
    const provider = this.paramDrips.get(GVID_FRAME_PROVIDER)?.get() as FrameProvider | undefined;
    if (!snapshot || !provider || snapshot.key.viewerId !== this.tabId) {
      if (this.active || this.result) this.clear();
      else this.publish(new Map([[GVID_SEQUENCE_PREVIEW_RESULT, null]]), opts?.destContext);
      return;
    }
    if (this.active?.signature === snapshot.signature && this.active.provider === provider) {
      this.publish(new Map([[GVID_SEQUENCE_PREVIEW_RESULT, this.result]]), opts?.destContext);
      return;
    }

    this.clear();
    const key: SequenceFrameKey = {
      ...snapshot.key, requestId: `${this.cancelGroupId}:${++nextRequest}`,
      cancelGroupId: this.cancelGroupId,
    };
    const abort = new AbortController();
    this.active = { signature: snapshot.signature, key, provider, abort };
    this.result = { key, state: 'pending', fidelity: 'mock' };
    this.publish(new Map([[GVID_SEQUENCE_PREVIEW_RESULT, this.result]]));
    let work: Promise<FrameResult<SequenceFrameKey>>;
    try {
      work = provider.sequence(key, snapshot.clip, snapshot.asset, abort.signal);
    } catch (error) {
      work = Promise.reject(error);
    }
    void work.then(
      (result) => this.finish(result, key, snapshot.signature, provider),
      (error: unknown) => this.finish({
        key, state: 'failed', fidelity: 'mock', diagnostic: {
          code: 'sequence-preview-failed', message: error instanceof Error ? error.message : String(error),
        },
      }, key, snapshot.signature, provider),
    );
  }

  private finish(
    result: FrameResult<SequenceFrameKey>, key: SequenceFrameKey,
    signature: string, provider: FrameProvider,
  ): void {
    const fresh = this.snapshot();
    if (this.detached || !this.active || this.active.provider !== provider ||
      this.active.abort.signal.aborted || !sameKey(this.active.key, key) ||
      !sameKey(result.key, key) || fresh?.signature !== signature ||
      this.paramDrips.get(GVID_FRAME_PROVIDER)?.get() !== provider) {
      if (result.resource) provider.release(result.resource.leaseId);
      return;
    }
    if (result.state !== 'ready' && result.resource) {
      provider.release(result.resource.leaseId);
      result = { ...result, resource: undefined };
    }
    if (result.state === 'ready' && !result.resource) {
      result = { key, state: 'failed', fidelity: result.fidelity,
        diagnostic: { code: 'missing-resource', message: 'Preview returned no frame resource.' } };
    }
    this.releaseHeld();
    if (result.resource) this.held = { leaseId: result.resource.leaseId, provider };
    this.result = result;
    this.publish(new Map([[GVID_SEQUENCE_PREVIEW_RESULT, result]]));
  }

  produceOnParams(): void { this.produce(); }
  produceOnDestParams(): void {}

  onDetach(): void {
    this.detached = true;
    this.active?.abort.abort();
    this.active = null;
    this.releaseHeld();
    this.result = null;
    super.onDetach();
  }
}

export function sequencePresentation(
  destination: SequenceDestination | undefined,
  project: ProjectView | undefined,
  graph: GraphView | undefined,
  binding: BindingView | undefined,
  status: ChangeStatus | undefined,
  result: FrameResult<SequenceFrameKey> | null | undefined,
): FramePresentation<SequenceFrameKey> {
  if (!destination || destination.mode === 'unresolved') {
    return { state: 'empty', requestedFrame: null, reason: destination?.reason ?? 'No sequence selected.' };
  }
  const requestedFrame = destination.timelineFrame;
  if (!project || !graph || !binding || project.status !== 'ready' ||
    !result || !destination.projectId || requestedFrame === null) {
    return { state: 'pending', requestedFrame, reason: 'Waiting for accepted preview.' };
  }
  const key = result.key;
  if (key.viewerId !== destination.viewerId || key.sessionId !== destination.sessionId ||
    key.sessionId !== project.sessionId || key.projectId !== destination.projectId ||
    key.projectId !== project.projectId || key.graphId !== graph.graphId ||
    graph.graphId !== project.graphId ||
    key.sequenceId !== destination.sequenceId || key.revision !== graph.revision ||
    key.revision !== project.revision || key.bindingSetId !== binding.bindingSetId ||
    binding.bindingSetId !== project.bindingSetId || binding.revision !== project.bindingRevision ||
    key.bindingRevision !== binding.revision || key.timelineFrame !== requestedFrame) {
    return { state: 'pending', requestedFrame, reason: 'Waiting for the accepted revision.' };
  }
  if (result.state === 'failed') {
    return { state: 'failed', requestedFrame, key, fidelity: result.fidelity,
      reason: result.diagnostic?.message ?? 'Preview failed.' };
  }
  if (result.state === 'pending') return { state: 'pending', requestedFrame, key };
  if (status?.state !== 'live') {
    return { state: 'stale', requestedFrame, key, resource: result.resource,
      fidelity: result.fidelity, composition: result.composition,
      reason: status?.reason ?? 'Accepted graph status is unavailable.' };
  }
  if (result.state === 'gap') {
    return { state: 'gap', requestedFrame, key, fidelity: result.fidelity,
      composition: result.composition, reason: 'Gap at playhead.' };
  }
  return { state: 'current', requestedFrame, key, resource: result.resource,
    fidelity: result.fidelity, composition: result.composition };
}

export class SequencePresentationTap extends BaseTap {
  constructor() {
    super({
      provides: [GVID_SEQUENCE_PRESENTATION],
      homeParamGrips: [GVID_SEQUENCE_DESTINATION, GVID_PROJECT_VIEW, GVID_GRAPH_VIEW,
        GVID_BINDING_VIEW, GVID_CHANGE_STATUS, GVID_SEQUENCE_PREVIEW_RESULT],
    });
  }

  produce(opts?: { destContext?: GripContext }): void {
    const value = sequencePresentation(
      this.paramDrips.get(GVID_SEQUENCE_DESTINATION)?.get(),
      this.paramDrips.get(GVID_PROJECT_VIEW)?.get(),
      this.paramDrips.get(GVID_GRAPH_VIEW)?.get(),
      this.paramDrips.get(GVID_BINDING_VIEW)?.get(),
      this.paramDrips.get(GVID_CHANGE_STATUS)?.get(),
      this.paramDrips.get(GVID_SEQUENCE_PREVIEW_RESULT)?.get(),
    );
    this.publish(new Map([[GVID_SEQUENCE_PRESENTATION, value]]), opts?.destContext);
  }

  produceOnParams(): void { this.produce(); }
  produceOnDestParams(): void {}
}

export function sequenceTabTaps(tabId: string): Tap[] {
  return [
    createAtomValueTap(GVID_DEST_VIEWER_ID, { initial: tabId }),
    new SequenceLinkTabTap(tabId),
    new SequenceDestinationTabTap(tabId),
    new SequencePreviewProviderTap(tabId),
    new SequencePresentationTap(),
  ];
}
