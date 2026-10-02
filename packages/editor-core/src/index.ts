import { BaseTap, type Grip, type GripContext, type Grok } from '@owebeeone/grip-react';
import { DESKTOP_TAB_LINKS, type TabLinkInfo } from '@grythjs/plugin-api';
import {
  GVID_ACTIVE_INSERT_TARGET, GVID_ACTIVE_INSERT_TARGET_CONTROL, GVID_ASSET_CATALOG,
  GVID_BINDING_VIEW, GVID_CHANGE_STATUS, GVID_DEST_PROJECT_ID, GVID_EDIT_COMMAND,
  GVID_EDIT_RESULT, GVID_GRAPH_VIEW, GVID_HISTORY_CONTROL, GVID_HISTORY_VIEW,
  GVID_PROJECT_CONTROL, GVID_PROJECT_VIEW, GVID_SEQUENCE_VIEW, GVID_TOOLS,
  type AssetRecord, type BindingView, type ChangeStatus, type EditorControl,
  type ChangeFootprint, type EditorResult, type GraphView, type HistoryControl, type HistoryView,
  type DeleteTimelineClip, type DeleteTrack, type InsertSourceSpan, type InsertTarget, type InsertTargetControl,
  type MoveTimelineClip, type PasteTimelineClip, type PlaceSourceSpan, type ProjectControl, type ProjectTransitionResult, type ProjectView,
  type SelectedTimelineClip, type SplitTimelineClip,
  type SequenceClip, type SequenceTrack, type SequenceView, type TimelineEditScope,
  type TrimTimelineClip,
} from '@gvidjs/contracts';

const RATE = Object.freeze({ num: 24, den: 1 });
const EMPTY_SEQUENCE: SequenceView = Object.freeze({
  id: '', graphId: '', revision: 0, frameRate: RATE, durationFrames: 0, tracks: Object.freeze([]),
});

interface JournalEntry { before: SequenceView; after: SequenceView; fromFrame: number; label: string }
interface ClipClipboard {
  projectId: string;
  sessionId: string;
  assetId: string;
  assetVersion: string;
  sourceIn: number;
  sourceOut: number;
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
  journal: readonly JournalEntry[];
  cursor: number;
}

let sessionSerial = 0;
function newSession(): string {
  sessionSerial += 1;
  return `mock-session-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}-${sessionSerial}`;
}

function makeAsset(projectId: string, id: string, displayName: string, frameCount: number): AssetRecord {
  return Object.freeze({
    id, displayName, version: 'v1', fingerprint: `${projectId}/${id}/v1`,
    streamId: `${id}/video-0`, frameCount, width: 640, height: 360,
    frameRate: RATE, status: 'ready',
  });
}

function makeSequence(projectId: string): SequenceView {
  const graphId = `${projectId}/main`;
  const second = projectId === 'mock-a' ? 'workshop' : 'studio-b';
  const clips: readonly SequenceClip[] = Object.freeze([
    Object.freeze({ id: 'clip-a', assetId: 'lighthouse', sourceIn: 12, sourceOut: 60, timelineIn: 0, timelineOut: 48 }),
    Object.freeze({ id: 'clip-b', assetId: second, sourceIn: 5, sourceOut: 53, timelineIn: 48, timelineOut: 96 }),
  ]);
  return Object.freeze({
    id: 'main', graphId, revision: 1, frameRate: RATE, durationFrames: 96,
    tracks: Object.freeze([Object.freeze({ id: 'v1', label: 'V1', kind: 'video', locked: false, clips })]),
  });
}

function initialState(projectId: 'mock-a' | 'mock-b'): State {
  const seq = makeSequence(projectId);
  const assets = Object.freeze(projectId === 'mock-a'
    ? [makeAsset(projectId, 'lighthouse', 'Lighthouse', 120), makeAsset(projectId, 'workshop', 'Workshop', 90)]
    : [makeAsset(projectId, 'lighthouse', 'Lighthouse B', 120), makeAsset(projectId, 'studio-b', 'Studio B', 90)]);
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
    journal: Object.freeze([]), cursor: 0,
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
    journal: Object.freeze([]), cursor: 0,
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
function sameTarget(a: InsertTarget, b: InsertTarget): boolean {
  return a.projectId === b.projectId && a.graphId === b.graphId &&
    a.sequenceId === b.sequenceId && a.trackId === b.trackId &&
    a.frame === b.frame && a.ownerTabId === b.ownerTabId;
}

function validateSequence(seq: SequenceView, assets: readonly AssetRecord[]): boolean {
  if (!isFrame(seq.durationFrames) || seq.frameRate.num !== 24 || seq.frameRate.den !== 1 || seq.tracks.length < 1) return false;
  const ids = new Set<string>();
  const trackIds = new Set<string>();
  for (const track of seq.tracks) {
    if (!track.id || trackIds.has(track.id) || !track.label || track.kind !== 'video') return false;
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
      ids.add(clip.id);
      previousEnd = clip.timelineOut;
    }
  }
  return true;
}

function rippleInsert(
  seq: SequenceView, trackId: string, frame: number, source: AssetRecord,
  sourceIn: number, sourceOut: number, insertedId: string, splitId: string,
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
        clips.push(Object.freeze({ ...clip, sourceOut: clip.sourceIn + leftDuration, timelineOut: frame }));
        clips.push(Object.freeze({
          ...clip, id: `${splitId}-${row.id}`, sourceIn: clip.sourceIn + leftDuration,
          timelineIn: frame + duration, timelineOut: clip.timelineOut + duration,
        }));
      }
    }
    if (row.id === trackId) clips.push(Object.freeze({
      id: insertedId, assetId: source.id, sourceIn, sourceOut,
      timelineIn: frame, timelineOut: frame + duration,
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
  sourceIn: number, sourceOut: number, clipId: string): SequenceView | null {
  const track = seq.tracks.find((item) => item.id === trackId);
  const end = frame + sourceOut - sourceIn;
  if (!track || track.locked || !isFrame(frame) || !Number.isSafeInteger(end)) return null;
  const clip: SequenceClip = Object.freeze({ id: clipId, assetId: source.id, sourceIn, sourceOut,
    timelineIn: frame, timelineOut: end });
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
  if (!sourceTrack || !targetTrack || !clip || sourceTrack.locked || targetTrack.locked || !isFrame(frame)) return null;
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
  if (!track || track.locked || !clip || !isFrame(intent.frame)) return null;
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
          sourceOut: clip.sourceIn + start - clip.timelineIn, timelineOut: start }));
        if (clip.timelineOut > end) clips.push(Object.freeze({ ...clip,
          id: left ? `${splitId}-${track.id}-${clip.id}` : clip.id,
          sourceIn: clip.sourceOut - (clip.timelineOut - end),
          timelineIn: start, timelineOut: clip.timelineOut - duration }));
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
    copyClip: (intent) => this.copyClip(intent), cutClip: (intent) => this.cutClip(intent),
    pasteClip: (intent) => this.pasteClip(intent),
    deleteClip: (intent) => this.deleteClip(intent), splitClip: (intent) => this.splitClip(intent),
    moveClip: (intent) => this.moveClip(intent), trimClip: (intent) => this.trimClip(intent),
  };
  private readonly historyControl: HistoryControl = {
    undo: () => this.moveHistory('undo'), redo: () => this.moveHistory('redo'),
  };

  constructor() {
    super({ provides: [
      GVID_DEST_PROJECT_ID, GVID_PROJECT_VIEW, GVID_PROJECT_CONTROL,
      GVID_GRAPH_VIEW, GVID_SEQUENCE_VIEW, GVID_CHANGE_STATUS,
      GVID_ASSET_CATALOG, GVID_BINDING_VIEW,
      GVID_ACTIVE_INSERT_TARGET, GVID_ACTIVE_INSERT_TARGET_CONTROL,
      GVID_EDIT_COMMAND, GVID_EDIT_RESULT, GVID_HISTORY_VIEW, GVID_HISTORY_CONTROL,
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
    this.commit(initialState(id));
    return { status: 'opened', message: `Opened ${id}; session only.` };
  }
  private close(discardSessionEdits: boolean): ProjectTransitionResult {
    if (this.state.journal.length > 0 && !discardSessionEdits) {
      return { status: 'confirmation-required', message: 'Closing the project will discard session-only edits.' };
    }
    this.clipSerial = 0;
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
    fromFrame: number, message: string, clipboard = this.state.clipboard): Promise<EditorResult> {
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
    this.commit({ ...this.state, project, graph, target, result, journal, cursor, clipboard });
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
      intent.sourceIn, intent.sourceOut, `insert-${serial}`, `split-${serial}`);
    if (!next || !validateSequence(next, assets)) return this.reject('Insert would create an invalid or locked track.');
    this.clipSerial = serial;
    const entry: JournalEntry = Object.freeze({ before: graph.sequence, after: next,
      fromFrame: target.frame, label: 'Insert source span' });
    const journal = Object.freeze([...this.state.journal.slice(0, this.state.cursor), entry]);
    return this.accept(next, journal, journal.length, target.frame,
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
    const next = Object.freeze({ ...seq, tracks: Object.freeze([...seq.tracks, Object.freeze({
      id, label: id.toUpperCase(), kind: 'video' as const, locked: false, clips: Object.freeze([]),
    })]) });
    if (!validateSequence(next, this.state.assets)) return this.reject('Track could not be added.');
    const entry: JournalEntry = Object.freeze({ before: seq, after: next, fromFrame: 0, label: 'Add track' });
    const journal = Object.freeze([...this.state.journal.slice(0, this.state.cursor), entry]);
    return this.accept(next, journal, journal.length, 0, `Added ${id.toUpperCase()}; session only.`);
  }

  private deleteTrack(intent: DeleteTrack): Promise<EditorResult> {
    if (!this.validEditScope(intent)) return this.reject('Project, session, or graph revision is stale.');
    const seq = this.state.graph.sequence;
    const track = seq.tracks.find((item) => item.id === intent.trackId);
    if (!track || seq.tracks.length <= 1) return this.reject('At least one track must remain.');
    const next = Object.freeze({ ...seq, tracks: Object.freeze(seq.tracks.filter((item) => item.id !== track.id)) });
    if (!validateSequence(next, this.state.assets)) return this.reject('Track could not be deleted.');
    const entry: JournalEntry = Object.freeze({ before: seq, after: next, fromFrame: 0, label: 'Delete track' });
    const journal = Object.freeze([...this.state.journal.slice(0, this.state.cursor), entry]);
    return this.accept(next, journal, journal.length, 0, `Deleted ${track.label} and its clips; session only.`);
  }

  private selectedClip(intent: SelectedTimelineClip): { track: SequenceTrack; clip: SequenceClip; clipboard: ClipClipboard } | null {
    const track = this.state.graph.sequence.tracks.find((item) => item.id === intent.trackId);
    const clip = track?.clips.find((item) => item.id === intent.clipId);
    const asset = this.state.assets.find((item) => item.id === clip?.assetId && item.status === 'ready');
    if (!track || !clip || !asset || !this.state.binding.byAssetId[asset.id]) return null;
    return { track, clip, clipboard: Object.freeze({
      projectId: this.state.project.projectId!, sessionId: this.state.project.sessionId,
      assetId: asset.id, assetVersion: asset.version, sourceIn: clip.sourceIn, sourceOut: clip.sourceOut,
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
    if (!selected || selected.track.locked) return this.reject('Selected clip cannot be cut.');
    const seq = this.state.graph.sequence;
    const next = liftClip(seq, selected.track.id, selected.clip.id);
    if (!validateSequence(next, this.state.assets)) return this.reject('Clip could not be cut.');
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
    const next = placeSpan(graph.sequence, intent.target.trackId, frame, source,
      clipboard.sourceIn, clipboard.sourceOut, `paste-${serial}`);
    if (!next || !validateSequence(next, assets)) return this.reject('Clip cannot be pasted onto that track.');
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
    const track = seq.tracks.find((item) => item.id === intent.trackId);
    const clip = track?.clips.find((item) => item.id === intent.clipId);
    if (!track || track.locked || !clip) return this.reject('Selected clip cannot be deleted.');
    const serial = this.clipSerial + 1;
    const next = intent.ripple ? rippleDeleteSpan(seq, clip.timelineIn, clip.timelineOut, `ripple-${serial}`) :
      liftClip(seq, track.id, clip.id);
    if (!next || !validateSequence(next, this.state.assets)) {
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
    const track = seq.tracks.find((item) => item.id === intent.trackId);
    const clip = track?.clips.find((item) => item.timelineIn < intent.frame && intent.frame < item.timelineOut);
    if (!track || track.locked || !clip || !isFrame(intent.frame)) {
      return this.reject('No unlocked clip crosses the playhead on this track.');
    }
    const serial = this.clipSerial + 1;
    const offset = intent.frame - clip.timelineIn;
    const left = Object.freeze({ ...clip, sourceOut: clip.sourceIn + offset, timelineOut: intent.frame });
    const right = Object.freeze({ ...clip, id: `split-${serial}`,
      sourceIn: clip.sourceIn + offset, timelineIn: intent.frame });
    const next = Object.freeze({ ...seq, tracks: Object.freeze(seq.tracks.map((row) => row.id === track.id ?
      Object.freeze({ ...row, clips: Object.freeze(row.clips.flatMap((item) =>
        item.id === clip.id ? [left, right] : [item])) }) : row)) });
    if (!validateSequence(next, this.state.assets)) return this.reject('Clip could not be split.');
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
    const next = placeSpan(graph.sequence, intent.target.trackId, frame, source,
      intent.sourceIn, intent.sourceOut, `place-${serial}`);
    if (!next || !validateSequence(next, assets)) return this.reject('Drop would create an invalid or locked track.');
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
    const original = graph.sequence.tracks.find((track) => track.id === intent.sourceTrackId)
      ?.clips.find((clip) => clip.id === intent.clipId);
    if (!original) return this.reject('Clip is no longer on its source track.');
    const next = moveClip(graph.sequence, intent.sourceTrackId, intent.clipId,
      intent.target.trackId, intent.target.frame);
    if (!next || !validateSequence(next, assets)) return this.reject('Clip cannot be moved onto that track.');
    if (intent.sourceTrackId === intent.target.trackId && original.timelineIn === intent.target.frame) {
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
    const original = seq.tracks.find((track) => track.id === intent.trackId)
      ?.clips.find((clip) => clip.id === intent.clipId);
    if (!original || (intent.edge !== 'in' && intent.edge !== 'out')) return this.reject('Clip trim target is invalid.');
    const oldFrame = intent.edge === 'in' ? original.timelineIn : original.timelineOut;
    if (oldFrame === intent.frame) return this.reject('Clip edge is already at that frame.');
    const next = trimClip(seq, intent);
    if (!next || !validateSequence(next, this.state.assets)) {
      return this.reject('Clip trim exceeds the source or adjacent clip.');
    }
    const fromFrame = Math.min(oldFrame, intent.frame);
    const entry: JournalEntry = Object.freeze({ before: seq, after: next, fromFrame, label: 'Trim clip' });
    const journal = Object.freeze([...this.state.journal.slice(0, this.state.cursor), entry]);
    return this.accept(next, journal, journal.length, fromFrame,
      `Trimmed clip ${intent.edge} to ${intent.frame}; session only.`);
  }

  private moveHistory(direction: 'undo' | 'redo'): Promise<EditorResult> {
    const { journal, cursor, project } = this.state;
    if (project.status !== 'ready' || this.state.change.state !== 'live') return this.reject('Project is closed or stale.');
    if (direction === 'undo' && cursor === 0) return this.reject('Nothing to undo.');
    if (direction === 'redo' && cursor === journal.length) return this.reject('Nothing to redo.');
    const entry = journal[direction === 'undo' ? cursor - 1 : cursor];
    const next = direction === 'undo' ? entry.before : entry.after;
    if (!validateSequence(next, this.state.assets)) return this.reject('History state is invalid.');
    return this.accept(next, journal, cursor + (direction === 'undo' ? -1 : 1), entry.fromFrame,
      `${direction === 'undo' ? 'Undid' : 'Redid'} ${entry.label.toLowerCase()}; session only.`);
  }
}

export function registerMockTaps(grok: Grok): void {
  grok.registerTap(new MockEditorRootTap());
  grok.query(DESKTOP_TAB_LINKS, grok.mainContext);
}
