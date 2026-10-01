import { addEntry } from '@grythjs/plugin-api';
import { useGrip } from '@owebeeone/grip-react';
import {
  GVID_ACTIVE_INSERT_TARGET, GVID_ACTIVE_INSERT_TARGET_CONTROL, GVID_ASSET_CATALOG,
  GVID_CHANGE_STATUS, GVID_DEST_SEQUENCE_ID, GVID_DEST_SEQUENCE_ID_TAP, GVID_EDIT_RESULT, GVID_GRAPH_VIEW,
  GVID_HISTORY_CONTROL, GVID_HISTORY_VIEW, GVID_PROJECT_VIEW, GVID_SEQUENCE_VIEW,
  GVID_TIMELINE_MARKS, GVID_TIMELINE_MARKS_CONTROL, GVID_TIMELINE_PLUGIN,
  GVID_TIMELINE_SELECTION, GVID_TIMELINE_SELECTION_TAP, GVID_TIMELINE_TRANSPORT,
  GVID_TIMELINE_TRANSPORT_CONTROL, GVID_TIMELINE_VIEWPORT, GVID_TIMELINE_VIEWPORT_TAP,
  GVID_TOOLS, type SequenceTrack,
} from '@gvidjs/contracts';
import { TimelineTabTap } from './timeline';
import './timeline.css';

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
  const editResult = useGrip(GVID_EDIT_RESULT);

  const availableSequence = !!project?.projectId && project.status === 'ready' &&
    change?.state === 'live' && graph?.graphId === sequence?.graphId &&
    graph?.revision === sequence?.revision && project.revision === graph?.revision;
  const accepted = availableSequence && sequenceId === sequence?.id;
  const duration = accepted ? sequence?.durationFrames ?? 0 : 0;
  const tracks = accepted ? sequence?.tracks ?? [] : [];
  const currentFrame = transport?.frame ?? null;
  const pixelsPerFrame = viewport?.pixelsPerFrame ?? 8;
  const startFrame = viewport?.startFrame ?? 0;
  const span = Math.max(duration + 24, 96);
  const width = span * pixelsPerFrame;
  const ticks = Array.from({ length: Math.ceil(span / (pixelsPerFrame >= 12 ? 12 : 24)) + 1 },
    (_, index) => index * (pixelsPerFrame >= 12 ? 12 : 24));
  const selectedTrack = tracks.find((track) => track.id === selection?.trackId) ?? tracks[0];
  const target = accepted && activeTarget?.ownerTabId === tabId && activeTarget.projectId === project?.projectId &&
    activeTarget.graphId === graph?.graphId && activeTarget.sequenceId === sequenceId ? activeTarget : null;

  const seekFromPointer = (clientX: number, left: number) => {
    const frame = Math.floor(startFrame + (clientX - left) / pixelsPerFrame);
    if (duration > 0) transportControl?.seek(Math.max(0, Math.min(duration - 1, frame)));
  };
  const chooseTarget = (track: SequenceTrack | undefined, frame: number) => {
    if (!track || track.locked || !targetControl || !accepted || !project?.projectId || !graph || !sequenceId ||
        !Number.isInteger(frame) || frame < 0 || frame > duration) return;
    targetControl.set({ projectId: project.projectId, graphId: graph.graphId, sequenceId,
      trackId: track.id, frame, ownerTabId: tabId });
  };
  const changeZoom = (next: number) => viewportTap?.set({
    startFrame, pixelsPerFrame: next, verticalScroll: viewport?.verticalScroll ?? 0,
  });

  return (
    <section className="gvid-timeline" aria-label="Timeline">
      <header className="gvid-timeline-header">
        <strong>Timeline</strong>
        <select aria-label="Sequence" value={sequenceId ?? ''} disabled={!sequenceTap || !availableSequence || !sequence}
          onChange={(event) => sequenceTap?.set(event.target.value || null)}>
          <option value="">No sequence</option>
          {sequence && <option value={sequence.id}>{sequence.id}</option>}
        </select>
        <span>{project?.projectId ?? 'No project'} | {duration} frames | r{graph?.revision ?? '-'}</span>
        {project?.sessionOnly && <span className="gvid-timeline-session">Session only</span>}
      </header>

      <div className="gvid-timeline-toolbar">
        <div className="gvid-timeline-group" aria-label="History">
          <button type="button" title={history?.undoLabel ?? 'Undo'} disabled={!accepted || !historyControl || !history?.canUndo || history.revision !== graph?.revision}
            onClick={() => void historyControl?.undo()}>Undo</button>
          <button type="button" title={history?.redoLabel ?? 'Redo'} disabled={!accepted || !historyControl || !history?.canRedo || history.revision !== graph?.revision}
            onClick={() => void historyControl?.redo()}>Redo</button>
        </div>
        <div className="gvid-timeline-group" aria-label="Playback marks">
          <button type="button" disabled={currentFrame === null || !marksControl} onClick={() => marksControl?.setIn()}>Set In</button>
          <button type="button" disabled={currentFrame === null || !marksControl} onClick={() => marksControl?.setOut()}>Set Out</button>
          <button type="button" disabled={!marksControl || marks?.validity === 'unset'} onClick={() => marksControl?.clear()}>Clear</button>
          <span className={'gvid-timeline-marks ' + (marks?.validity ?? 'unset')} role="status" title={marks?.reason}>
            In {marks?.inFrame ?? '-'} / Out {marks?.outFrame ?? '-'} | {marks?.validity ?? 'unset'}
          </span>
        </div>
        <div className="gvid-timeline-group gvid-timeline-transport" aria-label="Transport">
          <button type="button" title="Previous frame" disabled={currentFrame === null || !transportControl} onClick={() => transportControl?.step(-1)}>&#9664;|</button>
          <button type="button" className="primary" disabled={!transportControl || currentFrame === null || !!transport?.disabledReason}
            onClick={() => transport?.playing ? transportControl?.pause() : transportControl?.play()}>{transport?.playing ? 'Pause' : 'Play'}</button>
          <button type="button" title="Next frame" disabled={currentFrame === null || !transportControl} onClick={() => transportControl?.step(1)}>|&#9654;</button>
          <output className="gvid-timeline-clock" aria-label="Current timecode">
            {timecode(currentFrame, transport?.rate.num ?? 24, transport?.rate.den ?? 1)} <small>f{currentFrame ?? '-'}</small>
          </output>
        </div>
        <div className="gvid-timeline-group gvid-timeline-zoom" aria-label="Timeline zoom">
          <span>Zoom</span>
          <button type="button" title="Zoom out" disabled={!viewportTap || pixelsPerFrame <= 2} onClick={() => changeZoom(pixelsPerFrame / 2)}>-</button>
          <input type="range" min="2" max="32" step="2" aria-label="Zoom" value={pixelsPerFrame}
            disabled={!viewportTap} onChange={(event) => changeZoom(Number(event.target.value))} />
          <button type="button" title="Zoom in" disabled={!viewportTap || pixelsPerFrame >= 32} onClick={() => changeZoom(pixelsPerFrame * 2)}>+</button>
        </div>
      </div>

      <div className="gvid-timeline-stage">
        <div className="gvid-timeline-track-label gvid-timeline-ruler-label">TRACKS</div>
        <div className="gvid-timeline-window gvid-timeline-ruler" role="slider" aria-label="Timeline playhead"
          aria-valuemin={0} aria-valuemax={Math.max(0, duration - 1)} aria-valuenow={currentFrame ?? 0} tabIndex={duration ? 0 : -1}
          onKeyDown={(event) => { if (event.key === 'ArrowLeft') transportControl?.step(-1); if (event.key === 'ArrowRight') transportControl?.step(1); }}
          onClick={(event) => seekFromPointer(event.clientX, event.currentTarget.getBoundingClientRect().left)}>
          <div className="gvid-timeline-canvas" style={{ width, transform: `translateX(${-startFrame * pixelsPerFrame}px)` }}>
            {ticks.map((frame) => <span key={frame} className="gvid-timeline-tick" style={{ left: frame * pixelsPerFrame }}>{frame}</span>)}
            {marks?.inFrame !== null && marks?.inFrame !== undefined && <span className="gvid-timeline-mark-line" style={{ left: marks.inFrame * pixelsPerFrame }} />}
            {marks?.outFrame !== null && marks?.outFrame !== undefined && <span className="gvid-timeline-mark-line" style={{ left: marks.outFrame * pixelsPerFrame }} />}
            {currentFrame !== null && <span className="gvid-timeline-playhead" style={{ left: currentFrame * pixelsPerFrame }} />}
          </div>
        </div>
        <div className="gvid-timeline-tracks">
          {tracks.map((track) => <div key={track.id} className="gvid-timeline-row">
            <button type="button" className={'gvid-timeline-track-label ' + (selection?.trackId === track.id ? 'selected' : '')}
              onClick={() => selectionTap?.set({ trackId: track.id, clipId: null })}>
              <strong>{track.label}</strong><small>{track.locked ? 'Locked' : 'Video'}</small>
            </button>
            <div className="gvid-timeline-window gvid-timeline-lane"
              onClick={(event) => { selectionTap?.set({ trackId: track.id, clipId: null }); seekFromPointer(event.clientX, event.currentTarget.getBoundingClientRect().left); }}
              onWheel={(event) => { if (viewportTap && viewport) { event.preventDefault(); viewportTap.set({ ...viewport, startFrame: startFrame + Math.sign(event.deltaY) * 12 }); } }}>
              <div className="gvid-timeline-canvas" style={{ width, transform: `translateX(${-startFrame * pixelsPerFrame}px)` }}>
                {track.clips.map((clip) => {
                  const asset = catalog.find((item) => item.id === clip.assetId);
                  return <button key={clip.id} type="button"
                    className={'gvid-timeline-clip ' + (selection?.clipId === clip.id ? 'selected' : '')}
                    style={{ left: clip.timelineIn * pixelsPerFrame, width: Math.max(1, (clip.timelineOut - clip.timelineIn) * pixelsPerFrame) }}
                    title={`${asset?.displayName ?? clip.assetId} source [${clip.sourceIn},${clip.sourceOut}) timeline [${clip.timelineIn},${clip.timelineOut})`}
                    onClick={(event) => { event.stopPropagation(); selectionTap?.set({ trackId: track.id, clipId: clip.id }); transportControl?.seek(clip.timelineIn); }}>
                    <strong>{asset?.displayName ?? clip.assetId}</strong>
                    <small>source [{clip.sourceIn},{clip.sourceOut}) | [{clip.timelineIn},{clip.timelineOut})</small>
                  </button>;
                })}
                {target?.trackId === track.id && <span className="gvid-timeline-target-line" style={{ left: target.frame * pixelsPerFrame }} />}
                {currentFrame !== null && <span className="gvid-timeline-playhead" style={{ left: currentFrame * pixelsPerFrame }} />}
              </div>
            </div>
          </div>)}
          {!tracks.length && <p className="gvid-timeline-empty">{transport?.disabledReason ?? change?.reason ?? 'No accepted sequence.'}</p>}
        </div>
      </div>

      <div className="gvid-timeline-bottom">
        <div className="gvid-timeline-group">
          <span>Insertion: {target ? `${tracks.find((track) => track.id === target.trackId)?.label ?? target.trackId} at frame ${target.frame}` : 'none'}</span>
          <button type="button" disabled={!selectedTrack || selectedTrack.locked || currentFrame === null || !targetControl}
            onClick={() => chooseTarget(selectedTrack, currentFrame!)}>Target at playhead</button>
          <button type="button" disabled={!selectedTrack || selectedTrack.locked || !targetControl || !accepted}
            onClick={() => chooseTarget(selectedTrack, duration)}>Target at end</button>
          <button type="button" disabled={!target || !targetControl} onClick={() => targetControl?.clear(tabId)}>Clear target</button>
        </div>
        <label className="gvid-timeline-scroll">Scroll
          <input type="range" min="0" max={Math.max(0, duration - 1)} step="1" value={startFrame}
            disabled={!viewportTap || duration <= 1} onChange={(event) => viewportTap?.set({
              startFrame: Number(event.target.value), pixelsPerFrame, verticalScroll: viewport?.verticalScroll ?? 0,
            })} />
        </label>
      </div>
      <div className="gvid-timeline-feedback" role="status">
        {editResult ? `${editResult.status}: ${editResult.message} | r${editResult.revision}` : transport?.disabledReason ?? ''}
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
