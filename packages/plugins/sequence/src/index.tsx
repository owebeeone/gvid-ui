import { addEntry, DESKTOP_PIN_TAB } from '@grythjs/plugin-api';
import { useGrip } from '@owebeeone/grip-react';
import {
  GVID_BINDING_VIEW, GVID_GRAPH_VIEW, GVID_PREVIEW_PLUGIN, GVID_PROJECT_VIEW,
  GVID_SEQUENCE_DESTINATION, GVID_SEQUENCE_PRESENTATION, GVID_TOOLS,
  type FrameResource,
} from '@gvidjs/contracts';
import { sequenceTabTaps } from './taps';
import './sequence.css';

function FrameSurface({ resource, state, reason }: {
  resource?: FrameResource;
  state: string;
  reason?: string;
}) {
  if (resource?.kind === 'mock-png') {
    return <img className="gvid-sequence-image" src={resource.objectUrl} alt="Sequence preview frame" />;
  }
  if (resource?.kind === 'decoded-frame') {
    return <canvas
      key={resource.leaseId}
      className="gvid-sequence-image"
      ref={(canvas) => {
        if (!canvas) return;
        const frame = resource.frame;
        canvas.width = 'displayWidth' in frame ? frame.displayWidth : frame.width;
        canvas.height = 'displayHeight' in frame ? frame.displayHeight : frame.height;
        canvas.getContext('2d')?.drawImage(frame, 0, 0);
      }}
      aria-label="Sequence preview frame"
      role="img"
    />;
  }
  if (resource?.kind === 'media-resource') {
    return <div className="gvid-sequence-message">Preview resource {resource.descriptorId}</div>;
  }
  return <div className="gvid-sequence-message">{state === 'gap' ? 'Gap' : reason ?? state}</div>;
}

export function SequenceViewer({ tabId }: { tabId: string }) {
  const destination = useGrip(GVID_SEQUENCE_DESTINATION);
  const presentation = useGrip(GVID_SEQUENCE_PRESENTATION);
  const project = useGrip(GVID_PROJECT_VIEW);
  const graph = useGrip(GVID_GRAPH_VIEW);
  const binding = useGrip(GVID_BINDING_VIEW);
  const pin = useGrip(DESKTOP_PIN_TAB);
  const state = presentation?.state ?? 'pending';
  const frame = presentation?.requestedFrame ?? destination?.timelineFrame;
  const canPin = destination?.mode === 'wired' && destination.projectId !== null &&
    destination.sequenceId !== null && destination.timelineFrame !== null;

  return <section className="gvid-sequence-viewer" aria-label="Sequence viewer">
    <div className="gvid-sequence-toolbar">
      <span className="gvid-sequence-title">Sequence</span>
      <span className="gvid-sequence-mode">{destination?.mode ?? 'unresolved'}</span>
      <span className="gvid-sequence-spacer" />
      {canPin && <button type="button" onClick={() => pin?.(tabId, {
        projectId: destination.projectId,
        sequenceId: destination.sequenceId,
        timelineFrame: destination.timelineFrame,
      })}>Pin frame</button>}
    </div>
    <div className={`gvid-sequence-surface gvid-sequence-surface-${state}`}>
      <FrameSurface resource={presentation?.resource} state={state} reason={presentation?.reason} />
      {state === 'stale' && <span className="gvid-sequence-overlay">Stale preview</span>}
    </div>
    <div className="gvid-sequence-status" role="status">
      <strong>{state}</strong>
      <span>Frame {frame ?? '--'}</span>
      <span>{presentation?.fidelity ?? '--'} fidelity</span>
      {presentation?.composition === 'mock-topmost-track' && <span>Mock topmost track</span>}
      {presentation?.reason && state !== 'gap' && <span title={presentation.reason}>{presentation.reason}</span>}
    </div>
    <div className="gvid-sequence-identity">
      <span title="Project">Project {destination?.projectId ?? '--'}</span>
      <span title="Sequence">Sequence {destination?.sequenceId ?? '--'}</span>
      <span title="Accepted graph revision">Revision {graph?.revision ?? project?.revision ?? '--'}</span>
      <span title="Accepted binding set">Binding {binding?.bindingSetId ?? project?.bindingSetId ?? '--'}
        {binding && ` / ${binding.revision}`}</span>
    </div>
  </section>;
}

addEntry(GVID_PREVIEW_PLUGIN, {
  tools: {
    [GVID_TOOLS.sequence]: {
      label: 'Sequence viewer',
      defaultSize: { w: 640, h: 520 },
      role: 'sequence-preview',
      windowComponent: SequenceViewer,
      tabTaps: sequenceTabTaps,
    },
  },
});
