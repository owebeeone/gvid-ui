import { DESKTOP_TAB_LINKS } from '@grythjs/desktop';
import { defineGrip } from '@grythjs/plugin-api';
import { BaseTap, type Grip, type GripContext, type GripContextLike } from '@owebeeone/grip-react';
import {
  GVID_ACTIVE_INSERT_TARGET, GVID_ASSET_CATALOG, GVID_BINDING_VIEW,
  GVID_CHANGE_STATUS, GVID_DEST_ASSET_ID, GVID_DEST_SOURCE_FRAME,
  GVID_DEST_VIEWER_ID, GVID_EDIT_COMMAND, GVID_FRAME_PROVIDER,
  GVID_PROJECT_VIEW, GVID_SEQUENCE_VIEW, GVID_SOURCE_DESTINATION,
  GVID_SOURCE_FRAME_RESULT, GVID_SOURCE_LINK, GVID_SOURCE_MARKS,
  GVID_SOURCE_MARKS_CONTROL, GVID_SOURCE_PRESENTATION, GVID_SOURCE_TRANSPORT,
  GVID_SOURCE_TRANSPORT_CONTROL, GVID_TOOLS,
  type AssetRecord, type FrameMarks, type FramePresentation, type FrameProvider,
  type FrameResource, type FrameResult, type InsertSourceSpan, type InsertTarget,
  type MarksControl, type ProjectView, type Rational, type SourceDestination,
  type SourceFrameKey, type TabLinkView, type TransportControl, type TransportView,
} from '@gvidjs/contracts';

export interface SourceInsertState {
  disabledReason?: string;
  busy: boolean;
  message?: string;
}

export interface SourceInsertControl {
  addSelection(): Promise<void>;
}

export const SOURCE_INSERT_STATE = defineGrip<SourceInsertState>('Gvid.Source.InsertState');
export const SOURCE_INSERT_CONTROL = defineGrip<SourceInsertControl>('Gvid.Source.InsertControl');

const INPUTS = [
  DESKTOP_TAB_LINKS, GVID_PROJECT_VIEW, GVID_ASSET_CATALOG, GVID_DEST_ASSET_ID,
  GVID_BINDING_VIEW, GVID_FRAME_PROVIDER, GVID_ACTIVE_INSERT_TARGET,
  GVID_EDIT_COMMAND, GVID_SEQUENCE_VIEW, GVID_CHANGE_STATUS,
] as const;

const OUTPUTS = [
  GVID_SOURCE_LINK, GVID_SOURCE_DESTINATION, GVID_DEST_VIEWER_ID,
  GVID_DEST_SOURCE_FRAME, GVID_SOURCE_TRANSPORT, GVID_SOURCE_TRANSPORT_CONTROL,
  GVID_SOURCE_MARKS, GVID_SOURCE_MARKS_CONTROL, GVID_SOURCE_FRAME_RESULT,
  GVID_SOURCE_PRESENTATION, SOURCE_INSERT_STATE, SOURCE_INSERT_CONTROL,
] as const;

function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function normalized(num: number, den: number): Rational | null {
  if (!integer(num) || !integer(den) || den <= 0 || num < 0) return null;
  let a = num;
  let b = den;
  while (b !== 0) [a, b] = [b, a % b];
  return { num: num / a, den: den / a };
}

function sourcePts(frame: number, rate: Rational): Rational | null {
  if (!integer(rate.num) || !integer(rate.den) || rate.num <= 0 || rate.den <= 0) return null;
  return normalized(frame * rate.den, rate.num);
}

function validAsset(asset: AssetRecord | undefined): boolean {
  return !!asset && asset.status === 'ready' && integer(asset.frameCount) && asset.frameCount > 0 &&
    integer(asset.frameRate.num) && asset.frameRate.num > 0 &&
    integer(asset.frameRate.den) && asset.frameRate.den > 0 &&
    !!asset.version && !!asset.fingerprint && !!asset.streamId;
}

function markView(inFrame: number | null, outFrame: number | null, count: number): FrameMarks {
  if (inFrame === null && outFrame === null) return { inFrame, outFrame, validity: 'unset' };
  if (inFrame === null || outFrame === null) return { inFrame, outFrame, validity: 'pending' };
  if (!integer(inFrame) || !integer(outFrame) || inFrame < 0 || inFrame >= outFrame || outFrame > count) {
    return { inFrame, outFrame, validity: 'invalid', reason: 'In must be before exclusive Out within the source.' };
  }
  return { inFrame, outFrame, validity: 'valid' };
}

function sameKey(a: SourceFrameKey, b: SourceFrameKey): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class SourceTabTap extends BaseTap implements TransportControl, MarksControl, SourceInsertControl {
  private readonly tabId: string;
  private readonly openingParams: Readonly<Record<string, unknown>>;
  private link: TabLinkView;
  private destination: SourceDestination;
  private asset: AssetRecord | undefined;
  private project: ProjectView | undefined;
  private frame: number | null = null;
  private inFrame: number | null = null;
  private outFrame: number | null = null;
  private playing = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private scope = '';
  private bindingStamp = '';
  private seedStamp = '';
  private provider: FrameProvider | undefined;
  private requestedProvider: FrameProvider | undefined;
  private requestCore = '';
  private requestCounter = 0;
  private groupCounter = 0;
  private active: { key: SourceFrameKey; abort: AbortController } | undefined;
  private result: FrameResult<SourceFrameKey> | null = null;
  private presentation: FramePresentation<SourceFrameKey> = { state: 'empty', requestedFrame: null };
  private displayed: { key: SourceFrameKey; resource: FrameResource; provider: FrameProvider; fidelity: 'mock' | 'proxy' | 'exact' } | undefined;
  private busy = false;
  private commandGeneration = 0;
  private message: string | undefined;
  private detached = false;

  constructor(tabId: string, params?: Record<string, unknown>) {
    super({ provides: OUTPUTS, homeParamGrips: INPUTS });
    this.tabId = tabId;
    this.openingParams = params ?? {};
    this.link = { tabId, sourceTabId: null, params: this.openingParams };
    this.destination = this.unresolved('Viewer tab is unavailable.');
  }

  private read<T>(grip: Grip<T>): T | undefined {
    return this.paramDrips.get(grip)?.get() as T | undefined;
  }

  onAttach(home: GripContext | GripContextLike): void {
    super.onAttach(home);
    const params = this.getParamsContext();
    if (params) {
      for (const grip of INPUTS) params.getGrok().resolver.addConsumer(params, grip);
    }
    this.sync();
  }

  onDetach(): void {
    this.detached = true;
    this.stopClock();
    this.cancelRequest();
    this.releaseDisplayed();
    super.onDetach();
  }

  private unresolved(reason: string): SourceDestination {
    return {
      viewerId: this.tabId, projectId: this.project?.projectId ?? null,
      sessionId: this.project?.sessionId ?? '', assetId: null, assetVersion: null,
      fingerprint: null, sourceFrame: null, mode: 'unresolved', reason,
    };
  }

  private resolve(): { destination: SourceDestination; asset?: AssetRecord; seed: string } {
    const links = this.read(DESKTOP_TAB_LINKS) ?? [];
    const record = links.find((entry) => entry.tabId === this.tabId && entry.toolId === GVID_TOOLS.source);
    this.link = {
      tabId: this.tabId,
      sourceTabId: record?.sourceTabId ?? null,
      params: record?.params ?? this.openingParams,
    };
    if (!record) return { destination: this.unresolved('Viewer tab is unavailable.'), seed: '' };
    const project = this.read(GVID_PROJECT_VIEW);
    this.project = project;
    if (!project || project.status !== 'ready' || !project.projectId) {
      return { destination: this.unresolved('Open a project to view source frames.'), seed: '' };
    }
    const params = this.link.params;
    let assetId: string | null = null;
    let mode: 'wired' | 'standalone' = 'standalone';
    let seed = '';
    if (this.link.sourceTabId) {
      mode = 'wired';
      const parent = links.find((entry) => entry.tabId === this.link.sourceTabId);
      if (!parent || parent.toolId !== GVID_TOOLS.assets) {
        return { destination: this.unresolved('Linked media library tab is unavailable.'), seed: '' };
      }
      assetId = this.read(GVID_DEST_ASSET_ID) ?? null;
    } else {
      if (params.projectId !== project.projectId) {
        return { destination: this.unresolved('Source link belongs to another project.'), seed: '' };
      }
      if (typeof params.assetId === 'string') assetId = params.assetId;
      if (params.frame !== undefined) {
        if (!integer(params.frame) || params.frame < 0) {
          return { destination: this.unresolved('Source link frame is invalid.'), seed: '' };
        }
        seed = `${project.sessionId}:${assetId}:${params.frame}`;
      } else {
        seed = `${project.sessionId}:${assetId}:default`;
      }
    }
    if (!assetId) return { destination: this.unresolved('Choose an asset in the media library.'), seed };
    const asset = this.read(GVID_ASSET_CATALOG)?.find((entry) => entry.id === assetId);
    if (!asset) return { destination: this.unresolved('Selected asset is not registered.'), seed };
    if (!validAsset(asset)) {
      return { destination: this.unresolved(asset.reason ?? `Asset is ${asset.status}; source index is unavailable.`), asset, seed };
    }
    if (mode === 'standalone' && params.frame !== undefined &&
      (params.frame as number) >= asset.frameCount) {
      return { destination: this.unresolved('Source link frame is outside this asset.'), asset, seed };
    }
    return {
      destination: {
        viewerId: this.tabId, projectId: project.projectId, sessionId: project.sessionId,
        assetId, assetVersion: asset.version, fingerprint: asset.fingerprint,
        sourceFrame: this.frame, mode,
      },
      asset, seed,
    };
  }

  private identity(destination: SourceDestination, asset?: AssetRecord): string {
    if (destination.mode === 'unresolved' || !asset) return `unresolved:${destination.reason}`;
    return JSON.stringify([
      destination.mode, this.link.sourceTabId,
      destination.projectId, destination.sessionId, destination.assetId,
      asset.version, asset.fingerprint, asset.streamId, asset.frameCount,
      asset.frameRate.num, asset.frameRate.den, asset.status,
    ]);
  }

  private sync(): void {
    if (this.detached) return;
    const previousScope = this.scope;
    const { destination, asset, seed } = this.resolve();
    const nextScope = this.identity(destination, asset);
    const scopeChanged = nextScope !== previousScope;
    this.asset = asset;
    this.provider = this.read(GVID_FRAME_PROVIDER);
    if (scopeChanged) {
      this.scope = nextScope;
      this.groupCounter++;
      this.stopClock();
      this.cancelRequest();
      this.releaseDisplayed();
      this.result = null;
      this.presentation = { state: 'empty', requestedFrame: null };
      this.requestCore = '';
      this.requestedProvider = undefined;
      this.frame = null;
      this.inFrame = null;
      this.outFrame = null;
      this.busy = false;
      this.message = undefined;
      this.commandGeneration++;
      this.seedStamp = '';
    }
    const binding = this.read(GVID_BINDING_VIEW);
    const nextBinding = binding ? `${binding.bindingSetId}:${binding.revision}` : '';
    if (this.bindingStamp && nextBinding !== this.bindingStamp) {
      this.inFrame = null;
      this.outFrame = null;
      this.stopClock();
    }
    this.bindingStamp = nextBinding;
    if (destination.mode !== 'unresolved' && asset) {
      if (this.frame === null) this.frame = 0;
      if (seed && seed !== this.seedStamp) {
        this.seedStamp = seed;
        this.frame = this.link.params.frame as number | undefined ?? 0;
        this.stopClock();
      }
      if (this.frame >= asset.frameCount) this.frame = 0;
      destination.sourceFrame = this.frame;
    }
    this.destination = destination;
    this.ensureRequest();
    this.produce();
  }

  private stopClock(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    this.playing = false;
  }

  private cancelRequest(): void {
    this.active?.abort.abort();
    this.active = undefined;
  }

  private releaseDisplayed(): void {
    if (this.displayed) this.displayed.provider.release(this.displayed.resource.leaseId);
    this.displayed = undefined;
  }

  private ensureRequest(force = false): void {
    const d = this.destination;
    const asset = this.asset;
    const project = this.project;
    if (d.mode === 'unresolved' || !asset || !project || this.frame === null) {
      this.requestCore = '';
      this.cancelRequest();
      this.presentation = { state: 'empty', requestedFrame: null, reason: d.reason };
      return;
    }
    const pts = sourcePts(this.frame, asset.frameRate);
    if (!pts || !this.provider) {
      this.cancelRequest();
      this.releaseDisplayed();
      this.result = null;
      this.presentation = {
        state: 'failed', requestedFrame: this.frame,
        reason: !pts ? 'Exact source PTS is unavailable.' : 'Frame provider is unavailable.',
      };
      return;
    }
    const core = JSON.stringify([
      this.scope, this.frame, pts.num, pts.den,
    ]);
    if (!force && core === this.requestCore && this.provider === this.requestedProvider) return;
    this.cancelRequest();
    this.requestCore = core;
    this.requestedProvider = this.provider;
    const key: SourceFrameKey = {
      requestId: `${this.tabId}:r${++this.requestCounter}`,
      cancelGroupId: `${this.tabId}:g${this.groupCounter}`,
      viewerId: this.tabId, sessionId: project.sessionId, projectId: project.projectId!,
      assetId: asset.id, assetVersion: asset.version, fingerprint: asset.fingerprint,
      streamId: asset.streamId, sourceFrame: this.frame, sourcePts: pts,
    };
    const abort = new AbortController();
    this.active = { key, abort };
    this.result = { key, state: 'pending', fidelity: 'mock' };
    this.presentation = this.displayed
      ? { state: 'stale', requestedFrame: this.frame, key: this.displayed.key,
        resource: this.displayed.resource, fidelity: this.displayed.fidelity,
        reason: 'Waiting for the requested frame.' }
      : { state: 'pending', requestedFrame: this.frame, key };
    const provider = this.provider;
    let pending: Promise<FrameResult<SourceFrameKey>>;
    try {
      pending = provider.source(key, asset, abort.signal);
    } catch (error) {
      pending = Promise.reject(error);
    }
    void pending.then(
      (result) => this.receive(key, provider, result),
      (error: unknown) => this.receive(key, provider, {
        key, state: 'failed', fidelity: 'mock',
        diagnostic: { code: 'source-request', message: errorMessage(error) },
      }),
    );
  }

  private receive(key: SourceFrameKey, provider: FrameProvider, result: FrameResult<SourceFrameKey>): void {
    const current = this.active?.key;
    if (this.detached || !current || !sameKey(current, key) ||
      this.active?.abort.signal.aborted ||
      this.provider !== provider || this.destination.mode === 'unresolved' ||
      this.destination.projectId !== key.projectId || this.destination.sessionId !== key.sessionId ||
      this.destination.assetId !== key.assetId || this.asset?.version !== key.assetVersion ||
      this.asset.fingerprint !== key.fingerprint || this.asset.streamId !== key.streamId ||
      this.frame !== key.sourceFrame) {
      if (result.resource) provider.release(result.resource.leaseId);
      return;
    }
    if (!sameKey(result.key, key)) {
      if (result.resource) provider.release(result.resource.leaseId);
      this.active = undefined;
      this.releaseDisplayed();
      this.result = { key, state: 'failed', fidelity: result.fidelity,
        diagnostic: { code: 'key-mismatch', message: 'Frame provider returned a different source key.' } };
      this.presentation = { state: 'failed', requestedFrame: key.sourceFrame, key,
        reason: 'Frame provider returned a different source key.' };
      this.produce();
      return;
    }
    this.active = undefined;
    this.result = result;
    this.releaseDisplayed();
    if (result.state === 'ready' && result.resource) {
      this.displayed = { key, resource: result.resource, provider, fidelity: result.fidelity };
      this.presentation = {
        state: 'current', requestedFrame: key.sourceFrame, key,
        resource: result.resource, fidelity: result.fidelity,
      };
    } else if (result.state === 'pending') {
      if (result.resource) provider.release(result.resource.leaseId);
      this.presentation = { state: 'pending', requestedFrame: key.sourceFrame, key,
        fidelity: result.fidelity, reason: result.diagnostic?.message };
    } else {
      if (result.resource) provider.release(result.resource.leaseId);
      this.presentation = {
        state: result.state === 'gap' ? 'gap' : 'failed',
        requestedFrame: key.sourceFrame, key,
        fidelity: result.fidelity,
        reason: result.diagnostic?.message ?? (result.state === 'gap' ? 'No source frame at this position.' : 'Source frame could not be loaded.'),
      };
    }
    this.produce();
  }

  private marks(): FrameMarks {
    return markView(this.inFrame, this.outFrame, this.asset?.frameCount ?? 0);
  }

  private transport(): TransportView {
    const asset = this.asset;
    return {
      frame: this.frame, frameCount: asset?.frameCount ?? 0, playing: this.playing,
      rate: asset?.frameRate ?? { num: 0, den: 1 },
      disabledReason: this.destination.mode === 'unresolved' ? this.destination.reason :
        this.marks().validity === 'invalid' ? this.marks().reason : undefined,
    };
  }

  private addReason(): string | undefined {
    if (this.busy) return 'An insert is already pending.';
    if (this.destination.mode === 'unresolved' || !this.asset || !this.project) {
      return this.destination.reason ?? 'Choose a ready source.';
    }
    const marks = this.marks();
    if (marks.validity !== 'valid') return marks.reason ?? 'Set both In and Out marks.';
    const project = this.project;
    if (project.status !== 'ready' || !project.projectId) return 'Project is not ready.';
    if (this.read(GVID_CHANGE_STATUS)?.state !== 'live') return 'Editing is unavailable while the project is stale.';
    const binding = this.read(GVID_BINDING_VIEW);
    if (!binding || binding.bindingSetId !== project.bindingSetId || binding.revision !== project.bindingRevision) {
      return 'Source bindings are changing.';
    }
    const target = this.read(GVID_ACTIVE_INSERT_TARGET);
    if (!target) return 'Choose an insertion track and frame in the timeline.';
    const links = this.read(DESKTOP_TAB_LINKS) ?? [];
    if (!links.some((link) => link.tabId === target.ownerTabId)) return 'Insertion target tab is closed.';
    if (target.projectId !== project.projectId || target.graphId !== project.graphId) {
      return 'Insertion target belongs to another project or graph.';
    }
    const sequence = this.read(GVID_SEQUENCE_VIEW);
    if (!sequence || sequence.id !== target.sequenceId || sequence.graphId !== target.graphId ||
      sequence.revision !== project.revision) return 'Insertion target is out of date.';
    if (!integer(target.frame) || target.frame < 0 || target.frame > sequence.durationFrames) {
      return 'Insertion frame is outside the sequence.';
    }
    const track = sequence.tracks.find((row) => row.id === target.trackId);
    if (!track || track.kind !== 'video') return 'Choose a video track.';
    if (track.locked) return 'Insertion track is locked.';
    if (!this.read(GVID_EDIT_COMMAND)) return 'Editor command is unavailable.';
    return undefined;
  }

  async addSelection(): Promise<void> {
    this.sync();
    if (this.addReason()) return;
    const project = this.project!;
    const asset = this.asset!;
    const target = this.read(GVID_ACTIVE_INSERT_TARGET) as InsertTarget;
    const command = this.read(GVID_EDIT_COMMAND)!;
    const intent: InsertSourceSpan = {
      projectId: project.projectId!, sessionId: project.sessionId,
      expectedRevision: project.revision, bindingSetId: project.bindingSetId,
      assetId: asset.id, assetVersion: asset.version,
      sourceIn: this.inFrame!, sourceOut: this.outFrame!, target,
    };
    const generation = ++this.commandGeneration;
    this.busy = true;
    this.message = undefined;
    this.produce();
    try {
      const result = await command.insert(intent);
      if (generation === this.commandGeneration && !this.detached) {
        this.message = result.message;
      }
    } catch (error) {
      if (generation === this.commandGeneration && !this.detached) this.message = errorMessage(error);
    } finally {
      if (generation === this.commandGeneration && !this.detached) {
        this.busy = false;
        this.produce();
      }
    }
  }

  private seekInternal(frame: number, force = false): void {
    if (this.destination.mode === 'unresolved' || !this.asset || !integer(frame) ||
      frame < 0 || frame >= this.asset.frameCount) return;
    if (this.frame === frame && !force) return;
    if (this.playing && this.marks().validity === 'valid' &&
      (frame < this.inFrame! || frame >= this.outFrame!)) this.stopClock();
    this.frame = frame;
    this.destination = { ...this.destination, sourceFrame: frame };
    this.ensureRequest(force);
    this.produce();
  }

  seek(frame: number): void { this.seekInternal(frame, true); }

  step(delta: number): void {
    if (!integer(delta) || this.frame === null || !this.asset) return;
    this.pause();
    this.seekInternal(Math.min(this.asset.frameCount - 1, Math.max(0, this.frame + delta)));
  }

  play(): void {
    if (this.playing || this.destination.mode === 'unresolved' || !this.asset ||
      this.frame === null || this.marks().validity === 'invalid') return;
    const marks = this.marks();
    if (marks.validity === 'valid' && marks.inFrame !== null && marks.outFrame !== null &&
      (this.frame < marks.inFrame || this.frame >= marks.outFrame)) this.seekInternal(marks.inFrame);
    const period = 1000 * this.asset.frameRate.den / this.asset.frameRate.num;
    if (!Number.isFinite(period) || period <= 0) return;
    this.playing = true;
    this.timer = setInterval(() => {
      if (!this.asset || this.frame === null || this.destination.mode === 'unresolved') {
        this.pause();
        return;
      }
      const limit = this.marks().validity === 'valid' ? this.outFrame! : this.asset.frameCount;
      if (this.frame + 1 >= limit) {
        this.pause();
        return;
      }
      this.seekInternal(this.frame + 1);
    }, period);
    this.produce();
  }

  pause(): void {
    if (!this.playing) return;
    this.stopClock();
    this.produce();
  }

  setIn(): void {
    if (this.frame === null || this.destination.mode === 'unresolved') return;
    this.inFrame = this.frame;
    this.stopClock();
    this.produce();
  }

  setOut(): void {
    if (this.frame === null || this.destination.mode === 'unresolved') return;
    this.outFrame = this.frame + 1;
    this.stopClock();
    this.produce();
  }

  clear(): void {
    this.inFrame = null;
    this.outFrame = null;
    this.stopClock();
    this.produce();
  }

  produce(opts?: { destContext?: GripContext }): void {
    const insertState: SourceInsertState = {
      disabledReason: this.addReason(), busy: this.busy, message: this.message,
    };
    this.publish(new Map<Grip<unknown>, unknown>([
      [GVID_SOURCE_LINK, this.link],
      [GVID_SOURCE_DESTINATION, this.destination],
      [GVID_DEST_VIEWER_ID, this.tabId],
      [GVID_DEST_SOURCE_FRAME, this.frame],
      [GVID_SOURCE_TRANSPORT, this.transport()],
      [GVID_SOURCE_TRANSPORT_CONTROL, this],
      [GVID_SOURCE_MARKS, this.marks()],
      [GVID_SOURCE_MARKS_CONTROL, this],
      [GVID_SOURCE_FRAME_RESULT, this.result],
      [GVID_SOURCE_PRESENTATION, this.presentation],
      [SOURCE_INSERT_STATE, insertState],
      [SOURCE_INSERT_CONTROL, this],
    ]), opts?.destContext);
  }

  produceOnParams(): void { this.sync(); }
  produceOnDestParams(): void {}
}
