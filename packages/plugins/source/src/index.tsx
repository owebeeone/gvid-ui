import { addEntry, DESKTOP_PIN_TAB } from '@grythjs/plugin-api';
import { useGrip } from '@owebeeone/grip-react';
import {
  GVID_ACTIVE_INSERT_TARGET, GVID_ASSET_CATALOG, GVID_SOURCE_DESTINATION,
  GVID_HISTORY_CONTROL, GVID_HISTORY_VIEW, GVID_PROJECT_VIEW,
  GVID_SOURCE_DRAG_MIME, GVID_SOURCE_DRAG_TAP,
  GVID_SOURCE_FRAME_RESULT, GVID_SOURCE_LINK, GVID_SOURCE_MARKS, GVID_SOURCE_MARKS_CONTROL,
  GVID_SOURCE_PLUGIN, GVID_SOURCE_PRESENTATION, GVID_SOURCE_TRANSPORT,
  GVID_SOURCE_TRANSPORT_CONTROL, GVID_TIMELINE_DROP_PREVIEW_TAP, GVID_TOOLS,
} from '@gvidjs/contracts';
import { SOURCE_INSERT_CONTROL, SOURCE_INSERT_STATE, SourceTabTap, sourceSpanFromMarks } from './sourceTap';
import './source.css';

export { SOURCE_INSERT_CONTROL, SOURCE_INSERT_STATE, SourceTabTap } from './sourceTap';

export function SourceViewer() {
  const link = useGrip(GVID_SOURCE_LINK);
  const destination = useGrip(GVID_SOURCE_DESTINATION);
  const pin = useGrip(DESKTOP_PIN_TAB);
  const transport = useGrip(GVID_SOURCE_TRANSPORT);
  const controls = useGrip(GVID_SOURCE_TRANSPORT_CONTROL);
  const marks = useGrip(GVID_SOURCE_MARKS);
  const markControls = useGrip(GVID_SOURCE_MARKS_CONTROL);
  const result = useGrip(GVID_SOURCE_FRAME_RESULT);
  const presentation = useGrip(GVID_SOURCE_PRESENTATION);
  const insert = useGrip(SOURCE_INSERT_STATE);
  const insertControl = useGrip(SOURCE_INSERT_CONTROL);
  const target = useGrip(GVID_ACTIVE_INSERT_TARGET);
  const project = useGrip(GVID_PROJECT_VIEW);
  const dragTap = useGrip(GVID_SOURCE_DRAG_TAP);
  const dropPreviewTap = useGrip(GVID_TIMELINE_DROP_PREVIEW_TAP);
  const history = useGrip(GVID_HISTORY_VIEW);
  const historyControl = useGrip(GVID_HISTORY_CONTROL);
  const catalog = useGrip(GVID_ASSET_CATALOG) ?? [];
  const asset = catalog.find((item) => item.id === destination?.assetId);
  const dragSpan = sourceSpanFromMarks(marks, asset?.frameCount ?? 0);
  const markedSpan = marks && marks.validity !== 'unset' ? dragSpan : null;
  const frameCount = asset?.frameCount ?? 0;
  const canDrag = !!dragTap && !!dragSpan && !!asset && !!destination?.projectId &&
    destination.sessionId === project?.sessionId && project.status === 'ready';
  const png = presentation?.resource?.kind === 'mock-png' ? presentation.resource.objectUrl : undefined;
  const canNavigate = destination?.mode !== 'unresolved' && transport?.frame !== null &&
    transport?.frame !== undefined;

  return (
    <section className="gvid-source" aria-label="Source viewer" tabIndex={0}
      onClickCapture={(event) => {
        if (event.target instanceof Element && !event.target.closest('button, input, select, textarea, [contenteditable]')) {
          event.currentTarget.focus({ preventScroll: true });
        }
      }}
      onKeyDown={(event) => {
        if (event.target instanceof HTMLElement &&
          (event.target.isContentEditable || event.target.closest('textarea, select, input:not([type="range"])'))) return;
        const key = event.key.toLowerCase();
        if ((event.ctrlKey || event.metaKey) && key === 'z') {
          const redo = event.shiftKey;
          if ((redo ? history?.canRedo : history?.canUndo) && historyControl) {
            event.preventDefault();
            void (redo ? historyControl.redo() : historyControl.undo());
          }
        } else if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && canNavigate) {
          if (key === ' ' && controls && !transport?.disabledReason &&
            !(event.target instanceof Element && event.target.closest('button, input, select, textarea, a, [contenteditable]'))) {
            event.preventDefault();
            if (!event.repeat) {
              if (transport?.playing) controls.pause();
              else controls.play();
            }
          }
          if ((key === 'j' || key === 'k' || key === 'l') && controls &&
            (key === 'k' || !transport?.disabledReason) &&
            !(event.target instanceof Element && event.target.closest('button, input, select, textarea, a, [contenteditable]'))) {
            event.preventDefault();
            if (!event.repeat) controls.shuttle(key === 'j' ? -1 : key === 'l' ? 1 : 0);
          }
          if (key.startsWith('arrow') && controls) {
            const delta = key === 'arrowleft' ? -1 : key === 'arrowright' ? 1 :
              key === 'arrowup' ? 10 : key === 'arrowdown' ? -10 : 0;
            if (delta) { event.preventDefault(); controls.step(delta); }
          }
          if (key === 'i') { event.preventDefault(); markControls?.setIn(); }
          if (key === 'o') { event.preventDefault(); markControls?.setOut(); }
        }
      }}>
      <header className="gvid-source-head">
        <div className="gvid-source-identity">
          <strong>{asset?.displayName ?? 'Source viewer'}</strong>
          <span>{asset ? `${asset.version} · ${asset.width}x${asset.height}` : destination?.reason ?? 'No source selected'}</span>
        </div>
        <div className="gvid-source-head-actions">
          <span className="gvid-source-mode">{destination?.mode === 'wired' ? 'Following library' :
            destination?.mode === 'standalone' ? 'Standalone' : 'Unresolved'}</span>
          {link?.sourceTabId && <button type="button" title="Pin this source and frame" disabled={!pin || destination?.mode !== 'wired' || transport?.frame === null}
            onClick={() => pin?.(link.tabId, {
              projectId: destination?.projectId, assetId: destination?.assetId, frame: transport?.frame,
            })}>Pin</button>}
        </div>
      </header>

      <div className="gvid-source-surface" aria-live="polite" draggable={canDrag}
        title={canDrag ? 'Drag source span to timeline' : undefined}
        onDragStart={(event) => {
          if (!canDrag || !dragSpan || !asset || !destination?.projectId) { event.preventDefault(); return; }
          dropPreviewTap?.set(null);
          dragTap.set({ projectId: destination.projectId, sessionId: destination.sessionId,
            assetId: asset.id, assetVersion: asset.version, viewerId: destination.viewerId, ...dragSpan });
          event.dataTransfer.effectAllowed = 'copy';
          event.dataTransfer.setData(GVID_SOURCE_DRAG_MIME, destination.viewerId);
        }}
        onDragEnd={() => { dragTap?.set(null); dropPreviewTap?.set(null); }}>
        {png ? <img src={png} draggable={canDrag} alt={`${asset?.displayName ?? 'Source'} frame ${presentation?.key?.sourceFrame ?? 0}`} /> :
          <span>{presentation?.reason ?? destination?.reason ?? 'No frame'}</span>}
        <div className="gvid-source-status">
          <span>{presentation?.state ?? 'empty'}</span>
          {presentation?.fidelity && <span>{presentation.fidelity}</span>}
          {result?.diagnostic && <span title={result.diagnostic.code}>{result.diagnostic.message}</span>}
        </div>
      </div>

      <div className="gvid-source-controls">
        <div className="gvid-source-transport">
          <button type="button" title="Step back one source frame" aria-label="Step back" disabled={!canNavigate || transport?.frame === 0}
            onClick={() => controls?.step(-1)}>←</button>
          <button type="button" title={transport?.playing ? 'Pause source' : 'Play source'}
            disabled={!canNavigate || !!transport?.disabledReason}
            onClick={() => transport?.playing ? controls?.pause() : controls?.play()}>
            {transport?.playing ? 'Pause' : 'Play'}
          </button>
          <button type="button" title="Step forward one source frame" aria-label="Step forward"
            disabled={!canNavigate || transport!.frame! >= transport!.frameCount - 1}
            onClick={() => controls?.step(1)}>→</button>
          <span className="gvid-source-counter">{transport?.frame === null || transport?.frame === undefined ? '--' : transport.frame + 1}
            <span> / {transport?.frameCount ?? 0}</span>
            {!!transport?.shuttleRate && <span> {transport.shuttleRate}x</span>}</span>
        </div>
        <div className="gvid-source-scrubber" aria-label="Source clip range">
          <div className="gvid-source-scrubber-track">
            {markedSpan && <span className="gvid-source-range-selected" style={{
              left: `${markedSpan.sourceIn / frameCount * 100}%`,
              width: `${(markedSpan.sourceOut - markedSpan.sourceIn) / frameCount * 100}%`,
            }} />}
            {marks?.inFrame !== null && marks?.inFrame !== undefined && frameCount > 0 &&
              <span className="gvid-source-range-edge" style={{ left: `${marks.inFrame / frameCount * 100}%` }} />}
            {marks?.outFrame !== null && marks?.outFrame !== undefined && frameCount > 0 &&
              <span className="gvid-source-range-edge" style={{ left: `${marks.outFrame / frameCount * 100}%` }} />}
          </div>
          <input aria-label="Source frame" type="range" min={0} max={Math.max(0, (transport?.frameCount ?? 1) - 1)}
            value={transport?.frame ?? 0} disabled={!canNavigate}
            onChange={(event) => controls?.seek(Number(event.currentTarget.value))} />
        </div>
        <div className="gvid-source-marks">
          <button type="button" disabled={!canNavigate} onClick={() => markControls?.setIn()}>Set In</button>
          <button type="button" disabled={!canNavigate} onClick={() => markControls?.setOut()}>Set Out</button>
          <button type="button" disabled={!marks || marks.validity === 'unset'} onClick={() => markControls?.clear()}>Clear</button>
          {marks && marks.validity !== 'unset' && <span role="status">{marks.validity === 'valid' ? 'Range selected' :
            marks?.validity === 'invalid' ? 'Invalid range' : marks?.inFrame !== null ? 'Set Out' : 'Set In'}</span>}
        </div>
        {transport?.disabledReason && <p className="gvid-source-reason">{transport.disabledReason}</p>}
      </div>

      <footer className="gvid-source-insert">
        <div>
          <strong>Insert selection</strong>
          <span>{target ? `Track ${target.trackId} at frame ${target.frame}` : 'No timeline target'}</span>
          {insert?.disabledReason && <small>{insert.disabledReason}</small>}
          {insert?.message && <small role="status">{insert.message}</small>}
        </div>
        <button type="button" disabled={!insert || !!insert.disabledReason || !insertControl}
          onClick={() => { void insertControl?.addSelection(); }}>Add</button>
      </footer>
    </section>
  );
}

addEntry(GVID_SOURCE_PLUGIN, {
  tools: {
    [GVID_TOOLS.source]: {
      label: 'Source viewer',
      defaultSize: { w: 640, h: 520 },
      role: 'source',
      windowComponent: SourceViewer,
      tabTaps: (tabId, params) => [new SourceTabTap(tabId, params)],
    },
  },
});
