import { addEntry, DESKTOP_PIN_TAB } from '@grythjs/plugin-api';
import { useGrip } from '@owebeeone/grip-react';
import {
  GVID_ACTIVE_INSERT_TARGET, GVID_ASSET_CATALOG, GVID_SOURCE_DESTINATION,
  GVID_SOURCE_FRAME_RESULT, GVID_SOURCE_LINK, GVID_SOURCE_MARKS, GVID_SOURCE_MARKS_CONTROL,
  GVID_SOURCE_PLUGIN, GVID_SOURCE_PRESENTATION, GVID_SOURCE_TRANSPORT,
  GVID_SOURCE_TRANSPORT_CONTROL, GVID_TOOLS,
} from '@gvidjs/contracts';
import { SOURCE_INSERT_CONTROL, SOURCE_INSERT_STATE, SourceTabTap } from './sourceTap';
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
  const catalog = useGrip(GVID_ASSET_CATALOG) ?? [];
  const asset = catalog.find((item) => item.id === destination?.assetId);
  const png = presentation?.resource?.kind === 'mock-png' ? presentation.resource.objectUrl : undefined;
  const canNavigate = destination?.mode !== 'unresolved' && transport?.frame !== null &&
    transport?.frame !== undefined;

  return (
    <section className="gvid-source" aria-label="Source viewer">
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

      <div className="gvid-source-surface" aria-live="polite">
        {png ? <img src={png} alt={`${asset?.displayName ?? 'Source'} frame ${presentation?.key?.sourceFrame ?? 0}`} /> :
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
            <span> / {transport?.frameCount ?? 0}</span></span>
        </div>
        <input aria-label="Source frame" type="range" min={0} max={Math.max(0, (transport?.frameCount ?? 1) - 1)}
          value={transport?.frame ?? 0} disabled={!canNavigate}
          onChange={(event) => controls?.seek(Number(event.currentTarget.value))} />
        <div className="gvid-source-marks">
          <button type="button" disabled={!canNavigate} onClick={() => markControls?.setIn()}>Set In</button>
          <button type="button" disabled={!canNavigate} onClick={() => markControls?.setOut()}>Set Out</button>
          <button type="button" disabled={!marks || marks.validity === 'unset'} onClick={() => markControls?.clear()}>Clear</button>
          <span>In {marks?.inFrame ?? '--'} · Out {marks?.outFrame ?? '--'} exclusive</span>
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
