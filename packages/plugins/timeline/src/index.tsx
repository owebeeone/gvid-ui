import { addEntry, DESKTOP_OPEN_WIRED } from '@grythjs/plugin-api';
import { useGrip } from '@owebeeone/grip-react';
import {
  GVID_ACTIVE_INSERT_TARGET, GVID_ACTIVE_INSERT_TARGET_CONTROL, GVID_ASSET_CATALOG,
  GVID_BINDING_VIEW, GVID_CHANGE_STATUS, GVID_DEST_SEQUENCE_ID, GVID_DEST_SEQUENCE_ID_TAP,
  GVID_EDIT_COMMAND, GVID_EDIT_RESULT, GVID_GRAPH_VIEW, GVID_HISTORY_CONTROL, GVID_HISTORY_VIEW,
  GVID_PROJECT_VIEW, GVID_SEQUENCE_VIEW, GVID_SOURCE_DRAG_MIME, GVID_SOURCE_DRAG_TAP,
  GVID_TIMELINE_CLIP_DRAG_MIME, GVID_TIMELINE_CLIP_DRAG_TAP,
  GVID_TIMELINE_DROP_PREVIEW, GVID_TIMELINE_DROP_PREVIEW_TAP,
  GVID_TIMELINE_TRIM_DRAFT, GVID_TIMELINE_TRIM_DRAFT_TAP,
  GVID_TIMELINE_MARKS, GVID_TIMELINE_MARKS_CONTROL, GVID_TIMELINE_PLUGIN,
  GVID_TIMELINE_SELECTION, GVID_TIMELINE_SELECTION_TAP, GVID_TIMELINE_TRANSPORT,
  GVID_TIMELINE_TRANSPORT_CONTROL, GVID_TIMELINE_VIEWPORT, GVID_TIMELINE_VIEWPORT_TAP,
  GVID_TOOLS, type SequenceTrack, type TimelineDropPreview,
} from '@gvidjs/contracts';
import { clipBoundaryFrame, frameFromTimelineX, orderedTimelineTracks, projectDropPreview,
  snapTimelineFrame, TimelineTabTap } from './timeline';
import './timeline.css';

interface RulerGesture {
  pointerId: number;
  grabOffsetPx: number;
  ended: boolean;
}

const rulerGestures = new WeakMap<HTMLElement, RulerGesture>();

function timecode(frame: number | null, numerator: number, denominator: number): string {
  if (frame === null || numerator <= 0 || denominator <= 0) return '--:--:--:--';
  const fps = numerator / denominator;
  const seconds = Math.floor(frame / fps);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60,
    Math.floor(frame - seconds * fps)].map((part) => String(part).padStart(2, '0')).join(':');
}

export function Timeline({ tabId }: { tabId: string }) {
  const project = useGrip(GVID_PROJECT_VIEW);
  const graph = useGrip(GVID_GRAPH_VIEW);
  const change = useGrip(GVID_CHANGE_STATUS);
  const sequence = useGrip(GVID_SEQUENCE_VIEW);
  const sequenceId = useGrip(GVID_DEST_SEQUENCE_ID);
  const sequenceTap = useGrip(GVID_DEST_SEQUENCE_ID_TAP);
  const catalog = useGrip(GVID_ASSET_CATALOG) ?? [];
  const transport = useGrip(GVID_TIMELINE_TRANSPORT);
  const transportControl = useGrip(GVID_TIMELINE_TRANSPORT_CONTROL);
  const marks = useGrip(GVID_TIMELINE_MARKS);
  const marksControl = useGrip(GVID_TIMELINE_MARKS_CONTROL);
  const selection = useGrip(GVID_TIMELINE_SELECTION);
  const selectionTap = useGrip(GVID_TIMELINE_SELECTION_TAP);
  const viewport = useGrip(GVID_TIMELINE_VIEWPORT);
  const viewportTap = useGrip(GVID_TIMELINE_VIEWPORT_TAP);
  const activeTarget = useGrip(GVID_ACTIVE_INSERT_TARGET);
  const targetControl = useGrip(GVID_ACTIVE_INSERT_TARGET_CONTROL);
  const history = useGrip(GVID_HISTORY_VIEW);
  const historyControl = useGrip(GVID_HISTORY_CONTROL);
  const edit = useGrip(GVID_EDIT_COMMAND);
  const binding = useGrip(GVID_BINDING_VIEW);
  const dragTap = useGrip(GVID_SOURCE_DRAG_TAP);
  const clipDragTap = useGrip(GVID_TIMELINE_CLIP_DRAG_TAP);
  const dropPreview = useGrip(GVID_TIMELINE_DROP_PREVIEW);
  const dropPreviewTap = useGrip(GVID_TIMELINE_DROP_PREVIEW_TAP);
  const trimDraft = useGrip(GVID_TIMELINE_TRIM_DRAFT);
  const trimDraftTap = useGrip(GVID_TIMELINE_TRIM_DRAFT_TAP);
  const editResult = useGrip(GVID_EDIT_RESULT);
  const openWired = useGrip(DESKTOP_OPEN_WIRED);

  const availableSequence = !!project?.projectId && project.status === 'ready' &&
    change?.state === 'live' && graph?.graphId === sequence?.graphId &&
    graph?.revision === sequence?.revision && project.revision === graph?.revision;
  const accepted = availableSequence && sequenceId === sequence?.id;
  const duration = accepted ? sequence?.durationFrames ?? 0 : 0;
  const tracks = accepted && sequence ? orderedTimelineTracks(sequence) : [];
  const preview = accepted && dropPreview?.ownerTabId === tabId &&
    dropPreview.projectId === project?.projectId && dropPreview.sessionId === project?.sessionId &&
    dropPreview.sequenceId === sequenceId &&
    dropPreview.expectedRevision === graph?.revision ? dropPreview : null;
  const currentFrame = transport?.frame ?? null;
  const pixelsPerFrame = viewport?.pixelsPerFrame ?? 8;
  const startFrame = viewport?.startFrame ?? 0;
  const snapEnabled = viewport?.snapEnabled ?? true;
  const snapAnchors = [currentFrame, marks?.inFrame, marks?.outFrame]
    .filter((frame): frame is number => frame !== null && frame !== undefined);
  const previewEnd = preview ? preview.frame + preview.sourceOut - preview.sourceIn : 0;
  const span = Math.max(duration + 24, previewEnd + 24, 96);
  const width = span * pixelsPerFrame;
  const ticks = Array.from({ length: Math.ceil(span / (pixelsPerFrame >= 12 ? 12 : 24)) + 1 },
    (_, index) => index * (pixelsPerFrame >= 12 ? 12 : 24));
  const selectedTrack = tracks.find((track) => track.id === selection?.trackId) ?? tracks[0];
  const selectedClip = selection?.trackId && selection.clipId ?
    sequence?.tracks.find((track) => track.id === selection.trackId)
      ?.clips.find((clip) => clip.id === selection.clipId) : null;
  const target = accepted && activeTarget?.ownerTabId === tabId && activeTarget.projectId === project?.projectId &&
    activeTarget.graphId === graph?.graphId && activeTarget.sequenceId === sequenceId ? activeTarget : null;
  const rangeStart = marks && marks.validity !== 'unset' && marks.validity !== 'invalid' ? marks.inFrame ?? 0 : null;
  const rangeEnd = marks?.outFrame ?? duration;

  const frameAtPointer = (clientX: number, window: HTMLElement) => {
    const canvas = window.querySelector<HTMLElement>('.gvid-timeline-canvas');
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    return frameFromTimelineX(clientX, rect.left, 0, rect.width / span);
  };
  const seekFromPointer = (clientX: number, window: HTMLElement) => {
    const frame = frameAtPointer(clientX, window);
    if (duration > 0) transportControl?.seek(Math.max(0, Math.min(duration - 1, frame)));
  };
  const seekWithinRuler = (clientX: number, ruler: HTMLElement) => {
    const rect = ruler.getBoundingClientRect();
    seekFromPointer(Math.max(rect.left, Math.min(rect.right - 1, clientX)), ruler);
  };
  const editScope = () => project?.projectId && sequenceId ? {
    projectId: project.projectId, sessionId: project.sessionId,
    expectedRevision: project.revision, sequenceId,
  } : null;
  const previewFor = (track: SequenceTrack, clientX: number, window: HTMLElement,
    kind: 'source' | 'clip'): TimelineDropPreview | null => {
    const scope = editScope();
    if (!accepted || !sequence || !edit || !scope || !graph || track.locked) return null;
    const pointerFrame = frameAtPointer(clientX, window);
    if (kind === 'source') {
      const dragging = dragTap?.get();
      const asset = catalog.find((item) => item.id === dragging?.assetId);
      if (!dragging || !asset || !binding?.byAssetId[asset.id] ||
        dragging.projectId !== scope.projectId || dragging.sessionId !== scope.sessionId) return null;
      const frame = snapEnabled ? snapTimelineFrame(sequence, pointerFrame, {
        pixelsPerFrame, spanFrames: dragging.sourceOut - dragging.sourceIn, anchors: snapAnchors,
      }) : pointerFrame;
      const projection = projectDropPreview(sequence, track.id, frame,
        { kind: 'source', span: dragging, asset });
      return projection && { ...projection, ...scope, ownerTabId: tabId };
    }
    const moving = clipDragTap?.get();
    if (!moving || moving.projectId !== scope.projectId || moving.sessionId !== scope.sessionId ||
      moving.sequenceId !== scope.sequenceId || moving.expectedRevision !== scope.expectedRevision) return null;
    const movingClip = sequence.tracks.find((row) => row.id === moving.sourceTrackId)
      ?.clips.find((clip) => clip.id === moving.clipId);
    const rawStart = Math.max(0, pointerFrame - moving.grabOffsetFrames);
    const start = snapEnabled && movingClip ? snapTimelineFrame(sequence, rawStart, {
      pixelsPerFrame, spanFrames: movingClip.timelineOut - movingClip.timelineIn,
      anchors: snapAnchors, excludeClipId: movingClip.linkedClipId ?? movingClip.id,
    }) : rawStart;
    const projection = projectDropPreview(sequence, track.id, start + moving.grabOffsetFrames,
      { kind: 'clip', moving });
    return projection && { ...projection, ...scope, ownerTabId: tabId };
  };
  const commitDrop = (projection: TimelineDropPreview | null) => {
    const scope = editScope();
    if (!projection || !scope || !graph || !edit) return;
    const target = { projectId: scope.projectId, graphId: graph.graphId, sequenceId: scope.sequenceId,
      trackId: projection.targetTrackId, frame: projection.frame, ownerTabId: tabId };
    if (projection.kind === 'source') {
      const dragging = dragTap?.get();
      if (dragging && binding) void edit.place({ ...scope, bindingSetId: binding.bindingSetId,
        assetId: dragging.assetId, assetVersion: dragging.assetVersion,
        sourceIn: dragging.sourceIn, sourceOut: dragging.sourceOut, target });
    } else if (projection.sourceTrackId && projection.clipId) {
      void edit.moveClip({ ...scope, sourceTrackId: projection.sourceTrackId,
        clipId: projection.clipId, target });
    }
  };
  const clearDropPreview = () => {
    if (dropPreviewTap?.get()?.ownerTabId === tabId) dropPreviewTap.set(null);
  };
  const showDropPreview = (next: TimelineDropPreview | null) => {
    if (!next) { clearDropPreview(); return; }
    const current = dropPreviewTap?.get();
    if (current && current.ownerTabId === next.ownerTabId && current.projectId === next.projectId &&
      current.sessionId === next.sessionId && current.sequenceId === next.sequenceId &&
      current.expectedRevision === next.expectedRevision &&
      current.kind === next.kind && current.assetId === next.assetId && current.sourceIn === next.sourceIn &&
      current.sourceOut === next.sourceOut && current.clipId === next.clipId &&
      current.targetTrackId === next.targetTrackId && current.resolvedTrackId === next.resolvedTrackId &&
      current.createsTrack === next.createsTrack && current.frame === next.frame) return;
    dropPreviewTap?.set(next);
  };
  const chooseTarget = (track: SequenceTrack | undefined, frame: number) => {
    const videoTrack = sequence?.tracks.find((item) => item.id === track?.id.replace(/^a(\d+)$/, 'v$1'));
    if (!videoTrack || videoTrack.locked || track?.locked || !targetControl || !accepted || !project?.projectId || !graph || !sequenceId ||
        !Number.isInteger(frame) || frame < 0 || frame > duration) return;
    targetControl.set({ projectId: project.projectId, graphId: graph.graphId, sequenceId,
      trackId: videoTrack.id, frame, ownerTabId: tabId });
  };
  const changeZoom = (next: number) => viewportTap?.set({
    startFrame, pixelsPerFrame: next, verticalScroll: viewport?.verticalScroll ?? 0, snapEnabled,
  });
  const dropGhost = preview && <span className="gvid-timeline-drop-ghost"
    style={{ left: preview.frame * pixelsPerFrame,
      width: (preview.sourceOut - preview.sourceIn) * pixelsPerFrame }}
    title={`${catalog.find((item) => item.id === preview.assetId)?.displayName ?? preview.assetId} at frame ${preview.frame}`}>
    <strong>{catalog.find((item) => item.id === preview.assetId)?.displayName ?? preview.assetId}</strong>
    <small>f{preview.frame}</small>
  </span>;

  return (
    <section className="gvid-timeline" aria-label="Timeline" tabIndex={0}
      onClickCapture={(event) => {
        if (event.target instanceof Element && !event.target.closest('button, input, select, textarea, [contenteditable]')) {
          event.currentTarget.focus({ preventScroll: true });
        }
      }}
      onKeyDown={(event) => {
        if (event.target instanceof HTMLElement &&
          (event.target.isContentEditable || event.target.closest('textarea, select, input:not([type="range"])'))) return;
        const key = event.key.toLowerCase();
        const panelShortcutTarget = !(event.target instanceof Element &&
          event.target.closest('button:not(.gvid-timeline-clip-body), input, select, textarea, a, [contenteditable]'));
        if ((event.ctrlKey || event.metaKey) && key === 'z') {
          const redo = event.shiftKey;
          if ((redo ? history?.canRedo : history?.canUndo) && historyControl) {
            event.preventDefault();
            void (redo ? historyControl.redo() : historyControl.undo());
          }
        } else if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && accepted && edit &&
          panelShortcutTarget &&
          (key === 'x' || key === 'c' || key === 'v')) {
          const scope = editScope();
          if (scope && (key === 'v' ? selectedTrack && currentFrame !== null :
            selectedClip && selection?.trackId)) {
            event.preventDefault();
            if (event.repeat) return;
            if (key === 'v' && selectedTrack && currentFrame !== null && graph) {
              event.currentTarget.focus({ preventScroll: true });
              void edit.pasteClip({ ...scope, target: { projectId: scope.projectId,
                graphId: graph.graphId, sequenceId: scope.sequenceId,
                trackId: selectedTrack.id.replace(/^a(\d+)$/, 'v$1'),
                frame: currentFrame, ownerTabId: tabId } });
            } else if (selection?.trackId && selection.clipId) {
              if (key === 'x') event.currentTarget.focus({ preventScroll: true });
              const intent = { ...scope, trackId: selection.trackId, clipId: selection.clipId };
              void (key === 'x' ? edit.cutClip(intent) : edit.copyClip(intent));
            }
          }
        } else if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey &&
          key === 'k' && panelShortcutTarget && accepted && edit && selectedTrack && currentFrame !== null) {
          const scope = editScope();
          if (scope) {
            event.preventDefault();
            if (!event.repeat) void edit.splitClip({ ...scope, trackId: selectedTrack.id, frame: currentFrame });
          }
        } else if (!event.ctrlKey && !event.metaKey && !event.altKey && currentFrame !== null) {
          if (key === 'delete' && panelShortcutTarget && accepted && edit && selectedClip && selection?.trackId) {
            const scope = editScope();
            if (scope) {
              event.preventDefault();
              if (!event.repeat) {
                event.currentTarget.focus({ preventScroll: true });
                void edit.deleteClip({ ...scope, trackId: selection.trackId,
                  clipId: selectedClip.id, ripple: event.shiftKey });
              }
            }
          }
          if (event.shiftKey) return;
          if (key === ' ' && transportControl && !transport?.disabledReason && panelShortcutTarget) {
            event.preventDefault();
            if (!event.repeat) {
              if (transport?.playing) transportControl.pause();
              else transportControl.play();
            }
          }
          if ((key === 'j' || key === 'k' || key === 'l') && transportControl &&
            (key === 'k' || !transport?.disabledReason) && panelShortcutTarget) {
            event.preventDefault();
            if (!event.repeat) transportControl.shuttle(key === 'j' ? -1 : key === 'l' ? 1 : 0);
          }
          if (key === 's' && panelShortcutTarget && viewportTap) {
            event.preventDefault();
            if (!event.repeat) viewportTap.set({ startFrame, pixelsPerFrame,
              verticalScroll: viewport?.verticalScroll ?? 0, snapEnabled: !snapEnabled });
          }
          if ((key === '=' || key === '-') && panelShortcutTarget && viewportTap) {
            event.preventDefault();
            if (!event.repeat) changeZoom(key === '=' ? pixelsPerFrame * 2 : pixelsPerFrame / 2);
          }
          if (key.startsWith('arrow') && transportControl &&
              !(event.target instanceof Element && event.target.closest('input[type="range"]'))) {
            const next = key === 'arrowleft' ? currentFrame - 1 :
              key === 'arrowright' ? currentFrame + 1 :
              (key === 'arrowup' || key === 'arrowdown') && accepted && sequence
                ? clipBoundaryFrame(sequence, currentFrame, key === 'arrowup' ? 'up' : 'down') : currentFrame;
            if (next !== currentFrame) transportControl.step(next - currentFrame);
            event.preventDefault();
          }
          if (key === 'i') { event.preventDefault(); marksControl?.setIn(); }
          if (key === 'o') { event.preventDefault(); marksControl?.setOut(); }
        }
      }}>
      <aside className="gvid-timeline-controls" aria-label="Timeline controls">
        <div className="gvid-timeline-control-head">
          <strong>Timeline</strong><small>{project?.projectId ?? 'No project'} · r{graph?.revision ?? '-'}</small>
        </div>
        <label className="gvid-timeline-control-field">Sequence
          <select aria-label="Sequence" value={sequenceId ?? ''} disabled={!sequenceTap || !availableSequence || !sequence}
            onChange={(event) => sequenceTap?.set(event.target.value || null)}>
            <option value="">No sequence</option>
            {sequence && <option value={sequence.id}>{sequence.id}</option>}
          </select>
        </label>
        <div className="gvid-timeline-group">
          <button type="button" title="Open linked sequence viewer" disabled={!accepted || !openWired}
            onClick={() => openWired?.(tabId, { toolId: GVID_TOOLS.sequence })}>Open viewer</button>
        </div>
        <div className="gvid-timeline-control-section" aria-label="Transport">
          <div className="gvid-timeline-control-title">Transport</div>
          <div className="gvid-timeline-group gvid-timeline-transport">
            <button type="button" title="Previous frame" disabled={currentFrame === null || !transportControl} onClick={() => transportControl?.step(-1)}>&#9664;|</button>
            <button type="button" className="primary" disabled={!transportControl || currentFrame === null || !!transport?.disabledReason}
              onClick={() => transport?.playing ? transportControl?.pause() : transportControl?.play()}>{transport?.playing ? 'Pause' : 'Play'}</button>
            <button type="button" title="Next frame" disabled={currentFrame === null || !transportControl} onClick={() => transportControl?.step(1)}>|&#9654;</button>
          </div>
          <output className="gvid-timeline-clock" aria-label="Current timecode">
            {timecode(currentFrame, transport?.rate.num ?? 24, transport?.rate.den ?? 1)} <small>f{currentFrame ?? '-'}</small>
            {!!transport?.shuttleRate && <small> {transport.shuttleRate}x</small>}
          </output>
        </div>
        <div className="gvid-timeline-control-section" aria-label="Playback marks">
          <div className="gvid-timeline-control-title">Playback range</div>
          <div className="gvid-timeline-group">
            <button type="button" disabled={currentFrame === null || !marksControl} onClick={() => marksControl?.setIn()}>Set In</button>
            <button type="button" title="Set Out after current frame" disabled={currentFrame === null || !marksControl} onClick={() => marksControl?.setOut()}>Set Out</button>
            <button type="button" disabled={!marksControl || marks?.validity === 'unset'} onClick={() => marksControl?.clear()}>Clear</button>
          </div>
          {marks && marks.validity !== 'unset' && <span className={'gvid-timeline-marks ' + marks.validity} role="status" title={marks.reason}>
            {marks?.validity === 'valid' ? 'Range selected' : marks?.validity === 'invalid' ? 'Invalid range' :
              marks?.inFrame !== null ? 'Set Out' : 'Set In'}
          </span>}
        </div>
        <div className="gvid-timeline-control-section" aria-label="Tracks">
          <div className="gvid-timeline-control-title">Tracks</div>
          <div className="gvid-timeline-group">
            <button type="button" disabled={!accepted || !edit} onClick={() => {
              const scope = editScope();
              if (scope) void edit?.addTrack(scope);
            }}>+ Track</button>
            <span>{tracks.length / 2} V / {tracks.length / 2} A</span>
          </div>
        </div>
        <div className="gvid-timeline-control-section" aria-label="History">
          <div className="gvid-timeline-control-title">Edit</div>
          <div className="gvid-timeline-group">
            <button type="button" title={history?.undoLabel ?? 'Undo'} disabled={!accepted || !historyControl || !history?.canUndo || history.revision !== graph?.revision}
              onClick={() => void historyControl?.undo()}>Undo</button>
            <button type="button" title={history?.redoLabel ?? 'Redo'} disabled={!accepted || !historyControl || !history?.canRedo || history.revision !== graph?.revision}
              onClick={() => void historyControl?.redo()}>Redo</button>
          </div>
        </div>
        <div className="gvid-timeline-control-section" aria-label="Insertion target">
          <div className="gvid-timeline-control-title">Insertion target</div>
          <div className="gvid-timeline-group">
            <button type="button" disabled={!selectedTrack || selectedTrack.locked || currentFrame === null || !targetControl}
              onClick={() => chooseTarget(selectedTrack, currentFrame!)}>At playhead</button>
            <button type="button" disabled={!selectedTrack || selectedTrack.locked || !targetControl || !accepted}
              onClick={() => chooseTarget(selectedTrack, duration)}>At end</button>
            <button type="button" disabled={!target || !targetControl} onClick={() => targetControl?.clear(tabId)}>Clear</button>
          </div>
          {target && <small>{tracks.find((track) => track.id === target.trackId)?.label ?? target.trackId} · frame {target.frame}</small>}
        </div>
        <div className="gvid-timeline-control-section" aria-label="Timeline view">
          <div className="gvid-timeline-control-title">View</div>
          <div className="gvid-timeline-group gvid-timeline-zoom">
            <button type="button" title="Zoom out" disabled={!viewportTap || pixelsPerFrame <= 2} onClick={() => changeZoom(pixelsPerFrame / 2)}>-</button>
            <input type="range" min="2" max="32" step="2" aria-label="Zoom" value={pixelsPerFrame}
              disabled={!viewportTap} onChange={(event) => changeZoom(Number(event.target.value))} />
            <button type="button" title="Zoom in" disabled={!viewportTap || pixelsPerFrame >= 32} onClick={() => changeZoom(pixelsPerFrame * 2)}>+</button>
          </div>
          <label className="gvid-timeline-snap"><input type="checkbox" checked={snapEnabled}
            disabled={!viewportTap} onChange={(event) => viewportTap?.set({ startFrame, pixelsPerFrame,
              verticalScroll: viewport?.verticalScroll ?? 0, snapEnabled: event.currentTarget.checked })} />Snap</label>
          <input type="range" min="0" max={Math.max(0, duration - 1)} step="1" value={startFrame}
            aria-label="Timeline scroll" disabled={!viewportTap || duration <= 1} onChange={(event) => viewportTap?.set({
              startFrame: Number(event.target.value), pixelsPerFrame,
              verticalScroll: viewport?.verticalScroll ?? 0, snapEnabled,
            })} />
        </div>
        <div className="gvid-timeline-feedback" role="status">
          {editResult ? editResult.message : transport?.disabledReason ?? ''}
        </div>
      </aside>

      <div className="gvid-timeline-workspace">
        <div className="gvid-timeline-stage">
        <div className="gvid-timeline-track-label gvid-timeline-ruler-label">{duration}f</div>
        <div className="gvid-timeline-window gvid-timeline-ruler" role="slider" aria-label="Timeline playhead"
          aria-valuemin={0} aria-valuemax={Math.max(0, duration - 1)} aria-valuenow={currentFrame ?? 0} tabIndex={duration ? 0 : -1}
          onPointerDown={(event) => {
            if (event.button !== 0 || !transportControl || duration === 0) return;
            const ruler = event.currentTarget;
            const handle = event.target instanceof Element ? event.target.closest('.gvid-timeline-playhead') : null;
            const grabOffsetPx = handle ? event.clientX - handle.getBoundingClientRect().left : 0;
            event.preventDefault();
            ruler.closest<HTMLElement>('.gvid-timeline')?.focus({ preventScroll: true });
            ruler.setPointerCapture(event.pointerId);
            rulerGestures.set(ruler, { pointerId: event.pointerId, grabOffsetPx, ended: false });
            if (!handle) seekWithinRuler(event.clientX, ruler);
          }}
          onPointerMove={(event) => {
            const gesture = rulerGestures.get(event.currentTarget);
            if (gesture?.pointerId !== event.pointerId || gesture.ended) return;
            event.preventDefault();
            seekWithinRuler(event.clientX - gesture.grabOffsetPx, event.currentTarget);
          }}
          onPointerUp={(event) => {
            const ruler = event.currentTarget;
            const gesture = rulerGestures.get(ruler);
            if (gesture?.pointerId !== event.pointerId || gesture.ended) return;
            seekWithinRuler(event.clientX - gesture.grabOffsetPx, ruler);
            gesture.ended = true;
            if (ruler.hasPointerCapture(event.pointerId)) ruler.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={(event) => {
            if (rulerGestures.get(event.currentTarget)?.pointerId === event.pointerId) {
              rulerGestures.delete(event.currentTarget);
            }
          }}
          onLostPointerCapture={(event) => {
            const gesture = rulerGestures.get(event.currentTarget);
            if (gesture?.pointerId === event.pointerId && !gesture.ended) rulerGestures.delete(event.currentTarget);
          }}
          onClick={(event) => {
            const gesture = rulerGestures.get(event.currentTarget);
            if (gesture?.ended && event.detail > 0) {
              rulerGestures.delete(event.currentTarget);
              return;
            }
            seekFromPointer(event.clientX, event.currentTarget);
          }}>
          <div className="gvid-timeline-canvas" style={{ width, transform: `translateX(${-startFrame * pixelsPerFrame}px)` }}>
            {ticks.map((frame) => <span key={frame} className="gvid-timeline-tick" style={{ left: frame * pixelsPerFrame }}>{frame}</span>)}
            {rangeStart !== null && <span className="gvid-timeline-range" style={{
              left: rangeStart * pixelsPerFrame, width: (rangeEnd - rangeStart) * pixelsPerFrame,
            }} />}
            {marks?.inFrame !== null && marks?.inFrame !== undefined && <span className="gvid-timeline-mark-line" style={{ left: marks.inFrame * pixelsPerFrame }} />}
            {marks?.outFrame !== null && marks?.outFrame !== undefined && <span className="gvid-timeline-mark-line" style={{ left: marks.outFrame * pixelsPerFrame }} />}
            {currentFrame !== null && <span className="gvid-timeline-playhead" style={{ left: currentFrame * pixelsPerFrame }}
              title="Drag playhead" />}
          </div>
        </div>
        <div className="gvid-timeline-tracks" style={{ gridTemplateRows: `repeat(${Math.max(1, tracks.length)}, minmax(28px, 1fr))` }}
          onDragOver={(event) => {
            if (!(event.target instanceof Element) || !event.target.closest('.gvid-timeline-lane')) clearDropPreview();
          }}
          onDragLeave={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            if (event.clientX < rect.left || event.clientX >= rect.right ||
              event.clientY < rect.top || event.clientY >= rect.bottom ||
              (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget))) {
              clearDropPreview();
            }
          }}>
          {tracks.map((track) => <div key={track.id} className={'gvid-timeline-row gvid-timeline-row-' + track.kind +
            (track.kind === 'video' && track.hidden ? ' gvid-timeline-row-hidden' : '') +
            (track.kind === 'audio' && track.muted ? ' gvid-timeline-row-muted' : '')}>
            <div className={'gvid-timeline-track-label ' + (selection?.trackId === track.id ? 'selected' : '')}>
              <button type="button" className="gvid-timeline-track-select"
                title={track.locked ? `${track.label} locked` : track.label}
                onClick={() => selectionTap?.set({ trackId: track.id, clipId: null })}>
                <strong>{track.label}</strong>
              </button>
              <button type="button" className="gvid-timeline-track-toggle"
                aria-label={`${track.kind === 'video' ? 'Hide' : 'Mute'} ${track.label}`}
                aria-pressed={track.kind === 'video' ? Boolean(track.hidden) : Boolean(track.muted)}
                title={track.kind === 'video' ? `${track.hidden ? 'Show' : 'Hide'} ${track.label} in sequence viewer` :
                  `${track.muted ? 'Unmute' : 'Mute'} ${track.label} in sequence viewer`}
                disabled={!accepted || !edit}
                onClick={() => {
                  const scope = editScope();
                  if (!scope || !edit) return;
                  if (track.kind === 'video') void edit.setVideoHidden({ ...scope,
                    trackId: track.id, hidden: !track.hidden });
                  else void edit.setAudioMuted({ ...scope, trackId: track.id, muted: !track.muted });
                }}>{track.kind === 'video' ? 'Hide' : 'Mute'}</button>
              <button type="button" className="gvid-timeline-track-delete" title={`Delete ${track.label}`}
                aria-label={`Delete ${track.label} and its paired track`} disabled={!accepted || !edit || tracks.length <= 2}
                onClick={(event) => {
                  event.currentTarget.closest<HTMLElement>('.gvid-timeline')?.focus({ preventScroll: true });
                  const scope = editScope();
                  if (scope) void edit?.deleteTrack({ ...scope, trackId: track.id });
                }}>×</button>
            </div>
            <div className="gvid-timeline-window gvid-timeline-lane"
              onClick={(event) => { selectionTap?.set({ trackId: track.id, clipId: null }); seekFromPointer(event.clientX, event.currentTarget); }}
              onDragOver={(event) => {
                const kind = event.dataTransfer.types.includes(GVID_TIMELINE_CLIP_DRAG_MIME) ? 'clip' :
                  event.dataTransfer.types.includes(GVID_SOURCE_DRAG_MIME) ? 'source' : null;
                const next = kind ? previewFor(track, event.clientX, event.currentTarget, kind) : null;
                if (!next) { clearDropPreview(); return; }
                event.preventDefault();
                event.dataTransfer.dropEffect = kind === 'clip' ? 'move' : 'copy';
                showDropPreview(next);
              }}
              onDrop={(event) => {
                const kind = event.dataTransfer.types.includes(GVID_TIMELINE_CLIP_DRAG_MIME) ? 'clip' :
                  event.dataTransfer.types.includes(GVID_SOURCE_DRAG_MIME) ? 'source' : null;
                if (!kind) return;
                event.preventDefault();
                commitDrop(previewFor(track, event.clientX, event.currentTarget, kind));
                clearDropPreview();
                dragTap?.set(null);
                clipDragTap?.set(null);
              }}
              onWheel={(event) => { if (viewportTap && viewport) { event.preventDefault(); viewportTap.set({ ...viewport, startFrame: startFrame + Math.sign(event.deltaY) * 12 }); } }}>
              <div className="gvid-timeline-canvas" style={{ width, transform: `translateX(${-startFrame * pixelsPerFrame}px)` }}>
                {rangeStart !== null && <span className="gvid-timeline-range" style={{
                  left: rangeStart * pixelsPerFrame, width: (rangeEnd - rangeStart) * pixelsPerFrame,
                }} />}
                {track.clips.map((clip) => {
                  const asset = catalog.find((item) => item.id === clip.assetId);
                  const linkedTrack = sequence?.tracks.find((item) => item.id ===
                    track.id.replace(track.kind === 'video' ? /^v/ : /^a/,
                      track.kind === 'video' ? 'a' : 'v'));
                  const editLocked = track.locked || Boolean(clip.linkedClipId && linkedTrack?.locked);
                  const index = track.clips.indexOf(clip);
                  const previous = track.clips[index - 1];
                  const next = track.clips[index + 1];
                  const inMin = Math.max(0, clip.timelineIn - clip.sourceIn, previous?.timelineOut ?? 0);
                  const inMax = clip.timelineOut - 1;
                  const outMin = clip.timelineIn + 1;
                  const outMax = Math.min(
                    clip.timelineOut + Math.max(0, (asset?.frameCount ?? clip.sourceOut) - clip.sourceOut),
                    next?.timelineIn ?? Number.MAX_SAFE_INTEGER,
                  );
                  const draft = trimDraft?.trackId === track.id && trimDraft.clipId === clip.id &&
                    trimDraft.expectedRevision === project?.revision ? trimDraft : null;
                  const visualIn = draft?.edge === 'in' ? draft.frame : clip.timelineIn;
                  const visualOut = draft?.edge === 'out' ? draft.frame : clip.timelineOut;
                  const trimFrameAtPointer = (clientX: number, lane: HTMLElement, edge: 'in' | 'out') => {
                    const min = edge === 'in' ? inMin : outMin;
                    const max = edge === 'in' ? inMax : outMax;
                    const bounded = Math.max(min, Math.min(max, frameAtPointer(clientX, lane)));
                    return snapEnabled && sequence ? snapTimelineFrame(sequence, bounded, {
                      pixelsPerFrame, anchors: snapAnchors,
                      excludeClipId: track.kind === 'audio' ? clip.linkedClipId : clip.id,
                      minFrame: min, maxFrame: max,
                    }) : bounded;
                  };
                  const trimHandle = (edge: 'in' | 'out') => <button type="button" key={edge}
                    className={`gvid-timeline-trim gvid-timeline-trim-${edge}`}
                    title={`Trim ${edge === 'in' ? 'start' : 'end'} of ${asset?.displayName ?? clip.assetId}`}
                    aria-label={`Trim ${edge === 'in' ? 'start' : 'end'} of ${asset?.displayName ?? clip.assetId}`}
                    aria-keyshortcuts="Shift+ArrowLeft Shift+ArrowRight"
                    disabled={!accepted || editLocked || !asset || asset.status !== 'ready' || !trimDraftTap || !edit}
                    onClick={(event) => event.stopPropagation()}
                    onPointerDown={(event) => {
                      const scope = editScope();
                      if (!scope || !trimDraftTap) return;
                      event.preventDefault();
                      event.stopPropagation();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      trimDraftTap.set({ ...scope, trackId: track.id, clipId: clip.id, edge,
                        frame: edge === 'in' ? clip.timelineIn : clip.timelineOut, pointerId: event.pointerId });
                    }}
                    onPointerMove={(event) => {
                      const current = trimDraftTap?.get();
                      if (!current || current.pointerId !== event.pointerId || current.clipId !== clip.id ||
                        current.trackId !== track.id || current.edge !== edge) return;
                      const lane = event.currentTarget.closest<HTMLElement>('.gvid-timeline-lane');
                      if (!lane) return;
                      const frame = trimFrameAtPointer(event.clientX, lane, edge);
                      if (frame !== current.frame) trimDraftTap?.set({ ...current, frame });
                    }}
                    onPointerUp={(event) => {
                      event.stopPropagation();
                      const current = trimDraftTap?.get();
                      if (!current || current.pointerId !== event.pointerId || current.clipId !== clip.id ||
                        current.trackId !== track.id || current.edge !== edge) return;
                      const lane = event.currentTarget.closest<HTMLElement>('.gvid-timeline-lane');
                      const frame = lane ? trimFrameAtPointer(event.clientX, lane, edge) : current.frame;
                      trimDraftTap?.set(null);
                      if (frame !== (edge === 'in' ? clip.timelineIn : clip.timelineOut)) {
                        void edit?.trimClip({ ...current, frame });
                      }
                    }}
                    onPointerCancel={(event) => {
                      if (trimDraftTap?.get()?.pointerId === event.pointerId) trimDraftTap.set(null);
                    }}
                    onLostPointerCapture={(event) => {
                      if (trimDraftTap?.get()?.pointerId === event.pointerId) trimDraftTap.set(null);
                    }}
                    onKeyDown={(event) => {
                      if (!event.shiftKey || event.ctrlKey || event.metaKey || event.altKey ||
                        (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
                      event.preventDefault();
                      event.stopPropagation();
                      const scope = editScope();
                      const original = edge === 'in' ? clip.timelineIn : clip.timelineOut;
                      const frame = Math.max(edge === 'in' ? inMin : outMin,
                        Math.min(edge === 'in' ? inMax : outMax,
                          original + (event.key === 'ArrowLeft' ? -1 : 1)));
                      if (scope && frame !== original) {
                        void edit?.trimClip({ ...scope, trackId: track.id, clipId: clip.id, edge, frame });
                      }
                    }}
                    />;
                  return <div key={clip.id}
                    className={'gvid-timeline-clip ' + (selection?.clipId === clip.id ||
                      selection?.clipId === clip.linkedClipId ? 'selected' : '') +
                      (preview?.clipId === clip.id || preview?.clipId === clip.linkedClipId ? ' moving' : '')}
                    style={{ left: visualIn * pixelsPerFrame, width: Math.max(1, (visualOut - visualIn) * pixelsPerFrame) }}
                    title={`${asset?.displayName ?? clip.assetId} source [${clip.sourceIn},${clip.sourceOut}) timeline [${visualIn},${visualOut})`}>
                    {trimHandle('in')}
                    <button type="button" className="gvid-timeline-clip-body"
                    draggable={accepted && !editLocked && !!clipDragTap && !draft}
                    onDragStart={(event) => {
                      const scope = editScope();
                      if (!scope || !clipDragTap) { event.preventDefault(); return; }
                      clearDropPreview();
                      const grabOffsetFrames = Math.max(0, Math.min(clip.timelineOut - clip.timelineIn - 1,
                        Math.floor((event.clientX - event.currentTarget.parentElement!.getBoundingClientRect().left) /
                          (event.currentTarget.parentElement!.getBoundingClientRect().width /
                            (clip.timelineOut - clip.timelineIn)))));
                      clipDragTap.set({ ...scope, sourceTrackId: track.id, clipId: clip.id, grabOffsetFrames });
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData(GVID_TIMELINE_CLIP_DRAG_MIME, clip.id);
                    }}
                    onDragEnd={() => { clipDragTap?.set(null); clearDropPreview(); }}
                    onClick={(event) => {
                      event.stopPropagation();
                      selectionTap?.set({ trackId: track.id, clipId: clip.id });
                      const lane = event.currentTarget.closest<HTMLElement>('.gvid-timeline-lane');
                      if (lane) seekFromPointer(event.clientX, lane);
                    }}>
                    <strong>{asset?.displayName ?? clip.assetId}</strong>
                    </button>
                    {trimHandle('out')}
                  </div>;
                })}
                {(preview?.resolvedTrackId === track.id || preview?.hasAudio &&
                  track.id === preview.resolvedTrackId.replace(/^v(\d+)$/, 'a$1')) && dropGhost}
                {target?.trackId === track.id && <span className="gvid-timeline-target-line" style={{ left: target.frame * pixelsPerFrame }} />}
                {currentFrame !== null && <span className="gvid-timeline-playhead" style={{ left: currentFrame * pixelsPerFrame }} />}
              </div>
            </div>
          </div>)}
          {preview?.createsTrack && <div className="gvid-timeline-new-track-preview"
            style={{ height: `${100 / (tracks.length + 2)}%` }}>
            <div className="gvid-timeline-track-label"><strong>{preview.resolvedTrackId.toUpperCase()}</strong></div>
            <div className="gvid-timeline-window">
              <div className="gvid-timeline-canvas" style={{ width, transform: `translateX(${-startFrame * pixelsPerFrame}px)` }}>
                {dropGhost}
              </div>
            </div>
          </div>}
          {preview?.createsTrack && <div className="gvid-timeline-new-track-preview gvid-timeline-new-audio-preview"
            style={{ height: `${100 / (tracks.length + 2)}%` }}>
            <div className="gvid-timeline-track-label"><strong>{preview.resolvedTrackId.replace(/^v(\d+)$/, 'A$1')}</strong></div>
            <div className="gvid-timeline-window">
              <div className="gvid-timeline-canvas" style={{ width, transform: `translateX(${-startFrame * pixelsPerFrame}px)` }}>
                {preview.hasAudio && dropGhost}
              </div>
            </div>
          </div>}
          {!tracks.length && <p className="gvid-timeline-empty">{transport?.disabledReason ?? change?.reason ?? 'No accepted sequence.'}</p>}
        </div>
      </div>

      </div>
    </section>
  );
}

addEntry(GVID_TIMELINE_PLUGIN, {
  tools: {
    [GVID_TOOLS.timeline]: {
      label: 'Timeline',
      defaultSize: { w: 1100, h: 360 },
      role: 'timeline',
      tabTaps: (tabId, params) => [new TimelineTabTap(tabId, typeof params?.sequenceId === 'string' ? params.sequenceId : null)],
      windowComponent: Timeline,
    },
  },
});
