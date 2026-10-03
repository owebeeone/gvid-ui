import { addEntry, DESKTOP_PIN_TAB } from '@grythjs/plugin-api';
import { useGrip } from '@owebeeone/grip-react';
import {
  GVID_ACTIVE_INSERT_TARGET, GVID_ASSET_CATALOG, GVID_SOURCE_DESTINATION,
  GVID_CHANGE_STATUS, GVID_EDIT_COMMAND, GVID_HISTORY_CONTROL, GVID_HISTORY_VIEW, GVID_PROJECT_VIEW,
  GVID_SOURCE_DRAG_MIME, GVID_SOURCE_DRAG_TAP,
  GVID_SOURCE_FRAME_RESULT, GVID_SOURCE_LINK, GVID_SOURCE_MARKS, GVID_SOURCE_MARKS_CONTROL,
  GVID_SOURCE_MARKER_CATALOG,
  GVID_SOURCE_PLUGIN, GVID_SOURCE_PRESENTATION, GVID_SOURCE_TRANSPORT,
  GVID_SOURCE_TRANSPORT_CONTROL, GVID_TIMELINE_DROP_PREVIEW_TAP, GVID_TOOLS,
  type ClipMarker, type ClipMarkerColor, type SourceMarkerScope,
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
  const change = useGrip(GVID_CHANGE_STATUS);
  const edit = useGrip(GVID_EDIT_COMMAND);
  const markerCatalog = useGrip(GVID_SOURCE_MARKER_CATALOG) ?? [];
  const dragTap = useGrip(GVID_SOURCE_DRAG_TAP);
  const dropPreviewTap = useGrip(GVID_TIMELINE_DROP_PREVIEW_TAP);
  const history = useGrip(GVID_HISTORY_VIEW);
  const historyControl = useGrip(GVID_HISTORY_CONTROL);
  const catalog = useGrip(GVID_ASSET_CATALOG) ?? [];
  const asset = catalog.find((item) => item.id === destination?.assetId);
  const dragSpan = sourceSpanFromMarks(marks, asset?.frameCount ?? 0);
  const markedSpan = marks && marks.validity !== 'unset' ? dragSpan : null;
  const frameCount = asset?.frameCount ?? 0;
  const sourceMarkers = markerCatalog.find((set) => set.assetId === asset?.id &&
    set.assetVersion === asset.version && set.fingerprint === asset.fingerprint)?.markers ?? [];
  const markerScope = (): SourceMarkerScope | null => project?.status === 'ready' && project.projectId &&
    change?.state === 'live' && asset?.status === 'ready' && destination?.mode !== 'unresolved' &&
    destination?.sessionId === project.sessionId && destination.assetId === asset.id &&
    destination.assetVersion === asset.version && destination.fingerprint === asset.fingerprint ? {
      projectId: project.projectId, sessionId: project.sessionId, expectedRevision: project.revision,
      assetId: asset.id, assetVersion: asset.version, fingerprint: asset.fingerprint,
    } : null;
  const currentFrame = transport?.frame;
  const currentMarker = sourceMarkers.find((marker) => marker.sourceFrame === currentFrame);
  const canMark = !!edit && !!markerScope() && currentFrame !== null && currentFrame !== undefined &&
    currentFrame >= 0 && currentFrame < frameCount && !currentMarker;
  const addMarker = () => {
    const scope = markerScope();
    if (scope && canMark && currentFrame !== null && currentFrame !== undefined) {
      void edit?.addSourceMarker({ ...scope, frame: currentFrame });
    }
  };
  const openMarkerEditor = (marker: ClipMarker, from: HTMLElement) => {
    if (!markerScope() || !edit) return;
    const dialog = from.closest('.gvid-source')?.querySelector<HTMLDialogElement>('.gvid-source-marker-editor');
    const label = dialog?.querySelector<HTMLInputElement>('input[name="label"]');
    const color = dialog?.querySelector<HTMLInputElement>(`input[name="color"][value="${marker.color}"]`);
    if (!dialog || !label || !color) return;
    dialog.dataset.markerId = marker.id;
    label.value = marker.label;
    color.checked = true;
    if (!dialog.open) dialog.showModal();
    label.focus();
    label.select();
  };
  const canDrag = !!dragTap && !!dragSpan && !!asset && !!destination?.projectId &&
    destination.sessionId === project?.sessionId && project.status === 'ready';
  const png = presentation?.resource?.kind === 'mock-png' ? presentation.resource.objectUrl : undefined;
  const canNavigate = destination?.mode !== 'unresolved' && transport?.frame !== null &&
    transport?.frame !== undefined;
  const addHint = insert?.disabledReason ?? (target ?
    `Add to track ${target.trackId} at frame ${target.frame}` : 'Add selection');

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
          if (key === 'm' && canMark && !(event.target instanceof Element &&
            event.target.closest('button, a, [contenteditable]'))) {
            event.preventDefault();
            if (!event.repeat) addMarker();
          }
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
        <div className="gvid-source-toolbar">
          <div className="gvid-source-primary">
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
            <button type="button" title="Set In" disabled={!canNavigate} onClick={() => markControls?.setIn()}>In</button>
            <button type="button" title="Set Out" disabled={!canNavigate} onClick={() => markControls?.setOut()}>Out</button>
            <button type="button" title="Clear source marks" disabled={!marks || marks.validity === 'unset'}
              onClick={() => markControls?.clear()}>Clear</button>
            <button type="button" title={currentMarker ? 'Edit marker at source frame' : 'Add marker at source frame'}
              disabled={currentMarker ? !edit || !markerScope() : !canMark}
              onClick={(event) => currentMarker ? openMarkerEditor(currentMarker, event.currentTarget) : addMarker()}>
              {currentMarker ? 'Edit marker' : '+ Marker'}
            </button>
          </div>
          <div className="gvid-source-actions">
            {link?.sourceTabId && <button type="button" title="Pin this source and frame"
              disabled={!pin || destination?.mode !== 'wired' || transport?.frame === null}
              onClick={() => pin?.(link.tabId, {
                projectId: destination?.projectId, assetId: destination?.assetId, frame: transport?.frame,
              })}>Pin</button>}
            <span className="gvid-source-add-slot" title={addHint}>
              <button type="button" className="gvid-source-add" aria-label="Add selection"
                disabled={!insert || !!insert.disabledReason || !insertControl}
                onClick={() => { void insertControl?.addSelection(); }}>Add</button>
            </span>
          </div>
        </div>
        <dialog className="gvid-source-marker-editor" aria-label="Edit source marker">
          <form onSubmit={(event) => {
            event.preventDefault();
            const dialog = event.currentTarget.closest('dialog');
            const marker = sourceMarkers.find((item) => item.id === dialog?.dataset.markerId);
            const scope = markerScope();
            const values = new FormData(event.currentTarget);
            const color = values.get('color');
            if (marker && scope && edit &&
              (['red', 'green', 'blue', 'yellow'] as const).includes(color as ClipMarkerColor)) {
              void edit.updateSourceMarker({ ...scope, markerId: marker.id,
                label: String(values.get('label') ?? ''), color: color as ClipMarkerColor });
            }
            dialog?.close();
          }}>
            <strong>Source marker</strong>
            <label>Label<input type="text" name="label" maxLength={80} /></label>
            <fieldset><legend>Color</legend>
              {(['red', 'green', 'blue', 'yellow'] as const).map((color) => <label key={color} title={color}>
                <input type="radio" name="color" value={color} aria-label={color} defaultChecked={color === 'red'} />
                <span className={`gvid-source-marker-swatch ${color}`} />
              </label>)}
            </fieldset>
            <div className="gvid-source-marker-actions">
              <button type="submit">Save</button>
              <button type="button" onClick={(event) => event.currentTarget.closest('dialog')?.close()}>Cancel</button>
            </div>
          </form>
        </dialog>
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
          {sourceMarkers.map((marker) => <button key={marker.id} type="button"
            className={`gvid-source-clip-marker ${marker.color}`}
            style={{ left: `${(marker.sourceFrame + 0.5) / frameCount * 100}%` }}
            title={`${marker.label || `Unlabeled marker at source frame ${marker.sourceFrame}`} - double-click to edit`}
            aria-label={`${marker.label || 'Unlabeled marker'} at source frame ${marker.sourceFrame}`}
            onClick={() => controls?.seek(marker.sourceFrame)}
            onDoubleClick={(event) => {
              event.preventDefault();
              openMarkerEditor(marker, event.currentTarget);
            }} />)}
        </div>
        {marks && marks.validity !== 'unset' && <span className="gvid-source-sr-only" role="status">
          {marks.validity === 'valid' ? 'Range selected' : marks.validity === 'invalid' ? 'Invalid range' :
            marks.inFrame !== null ? 'Set Out' : 'Set In'}
        </span>}
        {transport?.disabledReason && <p className="gvid-source-reason">{transport.disabledReason}</p>}
        {insert?.message && <p className="gvid-source-feedback" role="status">{insert.message}</p>}
      </div>
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
