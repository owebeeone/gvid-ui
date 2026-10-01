import { BaseTap, type Grip, type GripContext, type Grok } from '@owebeeone/grip-react';
import { DESKTOP_TAB_LINKS, type TabLinkInfo } from '@grythjs/plugin-api';
import {
  GVID_ACTIVE_INSERT_TARGET, GVID_ACTIVE_INSERT_TARGET_CONTROL, GVID_ASSET_CATALOG,
  GVID_BINDING_VIEW, GVID_CHANGE_STATUS, GVID_DEST_PROJECT_ID, GVID_EDIT_COMMAND,
  GVID_EDIT_RESULT, GVID_GRAPH_VIEW, GVID_HISTORY_CONTROL, GVID_HISTORY_VIEW,
  GVID_PROJECT_CONTROL, GVID_PROJECT_VIEW, GVID_SEQUENCE_VIEW,
  type AssetRecord, type BindingView, type ChangeStatus, type EditorControl,
  type EditorResult, type GraphView, type HistoryControl, type HistoryView,
  type InsertSourceSpan, type InsertTarget, type InsertTargetControl, type ProjectControl,
  type ProjectView, type SequenceClip, type SequenceView,
} from '@gvidjs/contracts';

const RATE = Object.freeze({ num: 24, den: 1 });
const EMPTY_SEQUENCE: SequenceView = Object.freeze({
  id: '', graphId: '', revision: 0, frameRate: RATE, durationFrames: 0, tracks: Object.freeze([]),
});

interface JournalEntry { before: SequenceView; after: SequenceView; label: string }
interface State {
  project: ProjectView;
  graph: GraphView;
  assets: readonly AssetRecord[];
  binding: BindingView;
  change: ChangeStatus;
  target: InsertTarget | null;
  result: EditorResult | null;
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
    assets, binding, change: Object.freeze({ state: 'live' }), target: null, result: null,
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
    change: Object.freeze({ state: 'closed' }), target: null, result: null,
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
  if (!isFrame(seq.durationFrames) || seq.frameRate.num !== 24 || seq.frameRate.den !== 1 || seq.tracks.length !== 1) return false;
  const ids = new Set<string>();
  for (const track of seq.tracks) {
    if (track.kind !== 'video') return false;
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
  if (!track || track.locked || track.kind !== 'video' || seq.tracks.length !== 1 ||
      !isFrame(frame) || frame > seq.durationFrames ||
      !Number.isSafeInteger(seq.durationFrames + duration)) return null;
  const clips: SequenceClip[] = [];
  for (const clip of track.clips) {
    if (clip.timelineOut <= frame) clips.push(clip);
    else if (clip.timelineIn >= frame) clips.push(Object.freeze({
      ...clip, timelineIn: clip.timelineIn + duration, timelineOut: clip.timelineOut + duration,
    }));
    else {
      const leftDuration = frame - clip.timelineIn;
      clips.push(Object.freeze({ ...clip, sourceOut: clip.sourceIn + leftDuration, timelineOut: frame }));
      clips.push(Object.freeze({
        ...clip, id: splitId, sourceIn: clip.sourceIn + leftDuration,
        timelineIn: frame + duration, timelineOut: clip.timelineOut + duration,
      }));
    }
  }
  clips.push(Object.freeze({
    id: insertedId, assetId: source.id, sourceIn, sourceOut,
    timelineIn: frame, timelineOut: frame + duration,
  }));
  clips.sort((a, b) => a.timelineIn - b.timelineIn);
  const next: SequenceView = Object.freeze({
    ...seq, durationFrames: seq.durationFrames + duration,
    tracks: Object.freeze([Object.freeze({ ...track, clips: Object.freeze(clips) })]),
  });
  return next;
}

// One root producer publishes every accepted projection together before an edit promise settles.
class MockEditorRootTap extends BaseTap {
  private state: State = initialState('mock-a');
  private commandSerial = 0;
  private clipSerial = 0;
  private knownLinks: readonly TabLinkInfo[] | null = null;
  private readonly projectControl: ProjectControl = {
    open: (id) => this.open(id), close: () => this.close(),
  };
  private readonly targetControl: InsertTargetControl = {
    set: (target) => this.setTarget(target), clear: (owner) => this.clearTarget(owner),
  };
  private readonly editorControl: EditorControl = { insert: (intent) => this.insert(intent) };
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
    const links = this.currentLinks();
    if (this.state.target && links &&
        !links.some((link) => link.tabId === this.state.target?.ownerTabId)) {
      this.clearTarget(this.state.target.ownerTabId);
    }
  }

  produceOnDestParams(): void {}

  private currentLinks(): readonly TabLinkInfo[] | null {
    const links = this.paramDrips.get(DESKTOP_TAB_LINKS)?.get() as TabLinkInfo[] | undefined;
    if (links && (links.length > 0 || this.knownLinks !== null)) this.knownLinks = links;
    return this.knownLinks;
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

  private open(id: string): void {
    if (id !== 'mock-a' && id !== 'mock-b') throw new RangeError(`Unknown mock project: ${id}`);
    this.clipSerial = 0;
    this.commit(initialState(id));
  }
  private close(): void { this.clipSerial = 0; this.commit(closedState()); }

  private validTarget(target: InsertTarget): boolean {
    const { project, graph } = this.state;
    const track = graph.sequence.tracks.find((item) => item.id === target.trackId);
    const links = this.currentLinks();
    return project.status === 'ready' && this.state.change.state === 'live' &&
      target.projectId === project.projectId && target.graphId === graph.graphId &&
      target.sequenceId === graph.sequence.id && Boolean(target.ownerTabId) &&
      Boolean(track && !track.locked && track.kind === 'video') &&
      (links === null || links.some((link) => link.tabId === target.ownerTabId)) &&
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

  private makeResult(status: EditorResult['status'], message: string, revision = this.state.graph.revision): EditorResult {
    this.commandSerial += 1;
    return Object.freeze({ status, revision, message, commandId: `mock-command-${this.commandSerial}` });
  }
  private reject(message: string): Promise<EditorResult> {
    const result = this.makeResult('rejected', message);
    this.commit({ ...this.state, result });
    return Promise.resolve(result);
  }
  private accept(seq: SequenceView, journal: readonly JournalEntry[], cursor: number, message: string): Promise<EditorResult> {
    const revision = this.state.graph.revision + 1;
    const accepted = Object.freeze({ ...seq, revision });
    const result = this.makeResult('accepted-session-only', message, revision);
    const project = Object.freeze({ ...this.state.project, revision });
    const graph = Object.freeze({ graphId: this.state.graph.graphId, revision, sequence: accepted });
    const target = this.state.target && this.state.target.frame <= accepted.durationFrames ? this.state.target : null;
    this.commit({ ...this.state, project, graph, target, result, journal, cursor });
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
    const entry: JournalEntry = Object.freeze({ before: graph.sequence, after: next, label: 'Insert source span' });
    const journal = Object.freeze([...this.state.journal.slice(0, this.state.cursor), entry]);
    return this.accept(next, journal, journal.length,
      `Inserted ${intent.sourceOut - intent.sourceIn} frames at ${target.frame}; session only.`);
  }

  private moveHistory(direction: 'undo' | 'redo'): Promise<EditorResult> {
    const { journal, cursor, project } = this.state;
    if (project.status !== 'ready' || this.state.change.state !== 'live') return this.reject('Project is closed or stale.');
    if (direction === 'undo' && cursor === 0) return this.reject('Nothing to undo.');
    if (direction === 'redo' && cursor === journal.length) return this.reject('Nothing to redo.');
    const entry = journal[direction === 'undo' ? cursor - 1 : cursor];
    const next = direction === 'undo' ? entry.before : entry.after;
    if (!validateSequence(next, this.state.assets)) return this.reject('History state is invalid.');
    return this.accept(next, journal, cursor + (direction === 'undo' ? -1 : 1),
      `${direction === 'undo' ? 'Undid' : 'Redid'} ${entry.label.toLowerCase()}; session only.`);
  }
}

export function registerMockTaps(grok: Grok): void {
  grok.registerTap(new MockEditorRootTap());
  grok.query(DESKTOP_TAB_LINKS, grok.mainContext);
}
