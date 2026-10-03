import { addEntry, DESKTOP_PIN_TAB } from '@grythjs/plugin-api';
import { useGrip } from '@owebeeone/grip-react';
import type { CSSProperties } from 'react';
import {
  GVID_BINDING_VIEW, GVID_GRAPH_VIEW, GVID_PREVIEW_PLUGIN, GVID_PROJECT_VIEW,
  GVID_SEQUENCE_AUDIO_CONTROL, GVID_SEQUENCE_AUDIO_VIEW,
  GVID_SEQUENCE_DESTINATION, GVID_SEQUENCE_PRESENTATION, GVID_SEQUENCE_VIEW, GVID_TOOLS,
  NEUTRAL_EFFECTS, evaluateClipEffects, sameEffects,
  type FrameResource,
} from '@gvidjs/contracts';
import { sequenceTabTaps, topmostClipAt } from './taps';
import './sequence.css';

function FrameSurface({ resource, state, reason, effectsStyle }: {
  resource?: FrameResource;
  state: string;
  reason?: string;
  effectsStyle?: CSSProperties;
}) {
  if (resource?.kind === 'mock-png') {
    return <img className="gvid-sequence-image" src={resource.objectUrl} alt="Sequence preview frame"
      style={effectsStyle} />;
  }
  if (resource?.kind === 'decoded-frame') {
    return <canvas
      key={resource.leaseId}
      className="gvid-sequence-image"
      style={effectsStyle}
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
  const audio = useGrip(GVID_SEQUENCE_AUDIO_VIEW);
  const audioControl = useGrip(GVID_SEQUENCE_AUDIO_CONTROL);
  const project = useGrip(GVID_PROJECT_VIEW);
  const graph = useGrip(GVID_GRAPH_VIEW);
  const sequence = useGrip(GVID_SEQUENCE_VIEW);
  const binding = useGrip(GVID_BINDING_VIEW);
  const pin = useGrip(DESKTOP_PIN_TAB);
  const state = presentation?.state ?? 'pending';
  const frame = presentation?.requestedFrame ?? destination?.timelineFrame;
  const clip = state === 'current' && frame !== null && frame !== undefined && sequence &&
    sequence.revision === graph?.revision ? topmostClipAt(sequence, frame) : null;
  const effects = clip && frame !== null && frame !== undefined ?
    evaluateClipEffects(clip, frame) : NEUTRAL_EFFECTS;
  const filterId = `gvid-effect-filter-${tabId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const effectsStyle: CSSProperties = {
    opacity: effects.alpha,
    transform: `translate(${effects.moveX / 640 * 100}%, ${effects.moveY / 360 * 100}%) ` +
      `rotate(${effects.rotateDeg}deg) scale(${effects.scaleX}, ${effects.scaleY})`,
    transformOrigin: 'center center',
    filter: `url(#${filterId})`,
  };
  const canPin = destination?.mode === 'wired' && destination.projectId !== null &&
    destination.sequenceId !== null && destination.timelineFrame !== null;

  return <section className="gvid-sequence-viewer" aria-label="Sequence viewer">
    <svg aria-hidden="true" width="0" height="0" className="gvid-sequence-filter">
      <filter id={filterId} colorInterpolationFilters="sRGB">
        <feColorMatrix type="matrix" values={`${effects.gradeR} 0 0 0 0  0 ${effects.gradeG} 0 0 0  0 0 ${effects.gradeB} 0 0  0 0 0 1 0`} />
      </filter>
    </svg>
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
      <FrameSurface resource={presentation?.resource} state={state} reason={presentation?.reason}
        effectsStyle={effectsStyle} />
      {state === 'stale' && <span className="gvid-sequence-overlay">Stale preview</span>}
    </div>
    <div className="gvid-sequence-status" role="status">
      <strong>{state}</strong>
      <span>Frame {frame ?? '--'}</span>
      <span>{presentation?.fidelity ?? '--'} fidelity</span>
      {presentation?.composition === 'mock-topmost-track' && <span>Mock topmost track</span>}
      {clip && !sameEffects(effects, NEUTRAL_EFFECTS) && <span>Mock effects approximation</span>}
      {audio?.state === 'playing' && <span>Audio {audio.activeTrackIds.join(', ')}</span>}
      {audio?.state === 'blocked' && <button type="button" onClick={() => audioControl?.enable()}>Enable audio</button>}
      {audio?.state === 'unavailable' && <span>Audio unavailable</span>}
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
