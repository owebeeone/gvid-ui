import { addEntry } from '@grythjs/plugin-api';
import { createAtomValueTap, useGrip } from '@owebeeone/grip-react';
import {
  GVID_DEST_SEQUENCE_ID, GVID_EDIT_COMMAND, GVID_EDIT_RESULT, GVID_EFFECT_PROFILES,
  GVID_EFFECTS_COLOUR_MODE, GVID_EFFECTS_COLOUR_MODE_TAP, GVID_EFFECTS_DRAFT, GVID_EFFECTS_DRAFT_TAP,
  GVID_EFFECTS_FOCUS, GVID_EFFECTS_FOCUS_TAP, GVID_EFFECTS_PIN, GVID_EFFECTS_PIN_TAP,
  GVID_EFFECTS_PLUGIN, GVID_EFFECTS_PROFILE_CHOICE, GVID_EFFECTS_PROFILE_CHOICE_TAP,
  GVID_EFFECTS_PROFILE_NAME, GVID_EFFECTS_PROFILE_NAME_TAP,
  GVID_EFFECTS_SCALE_LINK, GVID_EFFECTS_SCALE_LINK_TAP, GVID_GRAPH_VIEW,
  GVID_PROJECT_VIEW, GVID_SEQUENCE_VIEW, GVID_TIMELINE_SELECTION, GVID_TIMELINE_TRANSPORT,
  GVID_TOOLS, NEUTRAL_EFFECTS, effectsAsCmyka, effectsFromCmyka, evaluateClipEffects,
  sameEffects, validEffects, type ClipEffectsState, type SequenceClip, type SequenceTrack, type SequenceView,
} from '@gvidjs/contracts';
import './effects.css';

function NumericControl({ label, value, min, max, numericMin = min, numericMax = max,
  step, unit, onChange, onCommit, onCancel }: {
  label: string; value: number; min: number; max: number; step: number; unit?: string;
  numericMin?: number; numericMax?: number;
  onChange: (value: number) => void; onCommit: () => void; onCancel: () => void;
}) {
  const update = (next: number, lower: number, upper: number) => {
    if (Number.isFinite(next)) onChange(Math.max(lower, Math.min(upper, next)));
  };
  return <label className="gvid-effect-control">
    <span>{label}</span>
    <input type="range" min={min} max={max} step={step} value={Math.max(min, Math.min(max, value))}
      aria-label={`${label} slider`} onChange={(event) => update(event.currentTarget.valueAsNumber, min, max)}
      onPointerUp={onCommit} onKeyUp={onCommit} onBlur={onCommit} />
    <span className="gvid-effect-value">
      <input type="number" min={numericMin} max={numericMax} step={step} value={Number(value.toFixed(2))}
        aria-label={`${label} value`} onChange={(event) => update(event.currentTarget.valueAsNumber, numericMin, numericMax)} onBlur={onCommit}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') onCommit();
          if (event.key === 'Escape') onCancel();
        }} />
      {unit && <small>{unit}</small>}
    </span>
  </label>;
}

function videoClipFor(sequence: SequenceView | undefined,
  trackId: string | null, clipId: string | null): { track: SequenceTrack; clip: SequenceClip } | null {
  const selectedTrack = sequence?.tracks.find((track) => track.id === trackId);
  const selectedClip = selectedTrack?.clips.find((clip) => clip.id === clipId);
  const videoTrack = sequence?.tracks.find((track) => track.id ===
    (selectedTrack?.kind === 'audio' ? trackId?.replace(/^a(\d+)$/, 'v$1') : trackId));
  const videoClip = videoTrack?.clips.find((clip) => clip.id ===
    (selectedTrack?.kind === 'audio' ? selectedClip?.linkedClipId : clipId));
  return videoTrack && videoClip ? { track: videoTrack, clip: videoClip } : null;
}

export function EffectsEditor() {
  const project = useGrip(GVID_PROJECT_VIEW);
  const graph = useGrip(GVID_GRAPH_VIEW);
  const sequence = useGrip(GVID_SEQUENCE_VIEW);
  const sequenceId = useGrip(GVID_DEST_SEQUENCE_ID);
  const selection = useGrip(GVID_TIMELINE_SELECTION);
  const transport = useGrip(GVID_TIMELINE_TRANSPORT);
  const focus = useGrip(GVID_EFFECTS_FOCUS);
  const focusTap = useGrip(GVID_EFFECTS_FOCUS_TAP);
  const pin = useGrip(GVID_EFFECTS_PIN);
  const pinTap = useGrip(GVID_EFFECTS_PIN_TAP);
  const draft = useGrip(GVID_EFFECTS_DRAFT);
  const draftTap = useGrip(GVID_EFFECTS_DRAFT_TAP);
  const colourMode = useGrip(GVID_EFFECTS_COLOUR_MODE) ?? 'rgba';
  const colourModeTap = useGrip(GVID_EFFECTS_COLOUR_MODE_TAP);
  const scaleLinked = useGrip(GVID_EFFECTS_SCALE_LINK) ?? true;
  const scaleLinkTap = useGrip(GVID_EFFECTS_SCALE_LINK_TAP);
  const profileName = useGrip(GVID_EFFECTS_PROFILE_NAME) ?? '';
  const profileNameTap = useGrip(GVID_EFFECTS_PROFILE_NAME_TAP);
  const profileChoice = useGrip(GVID_EFFECTS_PROFILE_CHOICE) ?? '';
  const profileChoiceTap = useGrip(GVID_EFFECTS_PROFILE_CHOICE_TAP);
  const profiles = useGrip(GVID_EFFECT_PROFILES) ?? [];
  const edit = useGrip(GVID_EDIT_COMMAND);
  const result = useGrip(GVID_EDIT_RESULT);

  const accepted = !!project?.projectId && project.status === 'ready' &&
    graph?.revision === project.revision && sequence?.revision === graph.revision &&
    sequence?.id === graph.sequence.id;
  const pinValid = accepted && pin?.projectId === project?.projectId &&
    pin.sessionId === project.sessionId && pin.sequenceId === sequence?.id;
  const pinnedTrackId = sequence?.tracks.find((track) => track.kind === 'video' &&
    track.clips.some((clip) => clip.id === pin?.clipId))?.id ?? null;
  const selected = pin ? pinValid ? videoClipFor(sequence, pinnedTrackId, pin.clipId) : null :
    accepted && sequenceId === sequence?.id ?
      videoClipFor(sequence, selection?.trackId ?? null, selection?.clipId ?? null) : null;
  const track = selected?.track;
  const clip = selected?.clip;
  const selectedKeyframeId = pin ? pin.keyframeId :
    focus?.clipId === selection?.clipId ? focus?.keyframeId ?? null : null;
  const keyframe = clip?.keyframes?.find((item) => item.id === selectedKeyframeId &&
    item.sourceFrame >= clip.sourceIn && item.sourceFrame < clip.sourceOut);
  const keyframeFrame = clip && keyframe ? clip.timelineIn + keyframe.sourceFrame - clip.sourceIn : null;
  const acceptedEffects = keyframe && clip ? keyframe.effects ?? evaluateClipEffects(clip, keyframeFrame!) :
    clip?.effects ?? NEUTRAL_EFFECTS;
  const activeDraft = draft && clip && project && draft.projectId === project.projectId &&
    draft.sessionId === project.sessionId && draft.sequenceId === sequence?.id &&
    draft.clipId === clip.id && draft.keyframeId === (keyframe?.id ?? null) &&
    draft.revision === graph?.revision ? draft : null;
  const effects = activeDraft?.effects ?? acceptedEffects;
  const playheadEffects = clip && transport?.frame !== null && transport?.frame !== undefined &&
    transport.frame >= clip.timelineIn && transport.frame < clip.timelineOut ?
    evaluateClipEffects(clip, transport.frame) : null;
  const cmyka = effectsAsCmyka(effects);
  const currentProfile = profiles.find((item) => item.id === profileChoice) ?? profiles[0];
  const duration = clip ? clip.timelineOut - clip.timelineIn : 0;
  const profileFits = !!currentProfile && currentProfile.keyframes.every((item) => item.offset < duration);
  const canEdit = !!clip && !!track && accepted && !!edit && !!draftTap && !track.locked &&
    !(clip.linkedClipId && sequence?.tracks.find((item) => item.id === track.id.replace(/^v/, 'a'))?.locked);

  const chooseKeyframe = (keyframeId: string | null) => {
    draftTap?.set(null);
    if (!clip || !project) return;
    if (pin) pinTap?.set({ ...pin, keyframeId });
    else if (selection?.clipId) focusTap?.set({ clipId: selection.clipId, keyframeId });
  };
  const change = (next: ClipEffectsState) => {
    if (!canEdit || !clip || !project?.projectId || !sequence || !graph || !validEffects(next)) return;
    draftTap?.set({ projectId: project.projectId, sessionId: project.sessionId,
      sequenceId: sequence.id, clipId: clip.id, keyframeId: keyframe?.id ?? null,
      revision: graph.revision, effects: next });
  };
  const submit = (next: ClipEffectsState) => {
    if (!canEdit || !clip || !track || !project?.projectId || !sequence || !graph ||
      !validEffects(next) || sameEffects(next, acceptedEffects)) return;
    void edit?.setClipEffects({ projectId: project.projectId, sessionId: project.sessionId,
      sequenceId: sequence.id, expectedRevision: graph.revision, trackId: track.id,
      clipId: clip.id, keyframeId: keyframe?.id ?? null, effects: next });
  };
  const commit = () => {
    const current = draftTap?.get();
    if (!current) return;
    draftTap?.set(null);
    if (!project || !sequence || !clip || !graph ||
      current.projectId !== project.projectId || current.sessionId !== project.sessionId ||
      current.sequenceId !== sequence.id || current.clipId !== clip.id ||
      current.keyframeId !== (keyframe?.id ?? null) || current.revision !== graph.revision) return;
    submit(current.effects);
  };
  const reset = (patch: Partial<ClipEffectsState>) => {
    draftTap?.set(null);
    submit({ ...acceptedEffects, ...patch });
  };
  const update = (patch: Partial<ClipEffectsState>) => {
    const current = draftTap?.get();
    const source = current && activeDraft ? current.effects : effects;
    change({ ...source, ...patch });
  };
  const control = (label: string, value: number, min: number, max: number, step: number,
    apply: (value: number) => void, unit = '%', numericMin = min, numericMax = max) =>
    <NumericControl key={label} label={label} value={value}
      min={min} max={max} numericMin={numericMin} numericMax={numericMax}
      step={step} unit={unit} onChange={apply} onCommit={commit}
      onCancel={() => draftTap?.set(null)} />;
  const scope = () => project?.projectId && sequence && track && clip ? {
    projectId: project.projectId, sessionId: project.sessionId,
    expectedRevision: project.revision, sequenceId: sequence.id,
    trackId: track.id, clipId: clip.id,
  } : null;

  return <section className="gvid-effects" aria-label="Effects editor">
    <header className="gvid-effects-head">
      <div><strong>Effects</strong><span>{clip ? `${track?.label} / ${clip.assetId}` : 'No clip selected'}</span></div>
      <button type="button" disabled={!clip && !pin} title={pin ? 'Follow timeline selection' : 'Pin this clip'}
        onClick={() => {
          draftTap?.set(null);
          if (pin) pinTap?.set(null);
          else if (clip && project?.projectId && sequence) pinTap?.set({ projectId: project.projectId,
            sessionId: project.sessionId, sequenceId: sequence.id, clipId: clip.id,
            keyframeId: keyframe?.id ?? null });
        }}>{pin ? 'Follow' : 'Pin'}</button>
    </header>
    <div className="gvid-effects-identity">
      <span>{project?.projectId ?? '--'} / {sequence?.id ?? '--'}</span>
      <span>r{graph?.revision ?? '--'}</span>
    </div>
    {!clip ? <div className="gvid-effects-empty">{pin ? 'Pinned clip unavailable' : 'No clip selected'}</div> : <>
      <div className="gvid-effects-keyframes">
        <button type="button" className={!keyframe ? 'active' : ''}
          onClick={() => chooseKeyframe(null)}>Base</button>
        {(clip.keyframes ?? []).filter((item) => item.sourceFrame >= clip.sourceIn &&
          item.sourceFrame < clip.sourceOut).sort((a, b) => a.sourceFrame - b.sourceFrame).map((item) =>
          <button key={item.id} type="button" className={item.id === keyframe?.id ? 'active' : ''}
            onClick={() => chooseKeyframe(item.id)}>{item.sourceFrame - clip.sourceIn}</button>)}
        <span className="gvid-effects-spacer" />
        <button type="button" title="Add keyframe at playhead" disabled={!canEdit ||
          transport?.frame === null || transport?.frame === undefined ||
          transport.frame < clip.timelineIn || transport.frame >= clip.timelineOut}
          onClick={() => { const target = scope(); if (target && transport?.frame !== null && transport?.frame !== undefined)
            void edit?.addClipKeyframe({ ...target, frame: transport.frame }); }}>+</button>
        <button type="button" title="Delete selected keyframe" disabled={!canEdit || !keyframe}
          onClick={() => { const target = scope(); if (target && keyframe) {
            chooseKeyframe(null); void edit?.deleteClipKeyframe({ ...target, keyframeId: keyframe.id });
          } }}>Delete</button>
      </div>
      <div className="gvid-effects-frame">{keyframe ? `Keyframe at timeline frame ${keyframeFrame}` :
        `Base state${transport?.frame !== null && transport?.frame !== undefined ?
          ` / playhead ${transport.frame}` : ''}`}
        {playheadEffects && <span> · evaluated α {Math.round(playheadEffects.alpha * 100)}% ·
          x {Math.round(playheadEffects.moveX)} · y {Math.round(playheadEffects.moveY)}</span>}
      </div>
      <div className="gvid-effects-scroll">
        <section className="gvid-effects-section" aria-label="Transparency">
          <div className="gvid-effects-section-head"><h3>Transparency</h3>
            <button type="button" disabled={!canEdit || acceptedEffects.alpha === 1}
              onClick={() => reset({ alpha: 1 })}>Reset</button></div>
          {control('Alpha', effects.alpha * 100, 0, 100, 1, (value) => update({ alpha: value / 100 }))}
        </section>
        <section className="gvid-effects-section" aria-label="Colour grade">
          <div className="gvid-effects-section-head"><h3>Colour grade</h3>
            <div className="gvid-effects-segments" role="group" aria-label="Colour mode">
              <button type="button" className={colourMode === 'rgba' ? 'active' : ''}
                onClick={() => colourModeTap?.set('rgba')}>RGBA</button>
              <button type="button" className={colourMode === 'cmyka' ? 'active' : ''}
                onClick={() => colourModeTap?.set('cmyka')}>CMYKA</button>
            </div>
            <button type="button" disabled={!canEdit ||
              (acceptedEffects.gradeR === 1 && acceptedEffects.gradeG === 1 && acceptedEffects.gradeB === 1)}
              onClick={() => reset({ gradeR: 1, gradeG: 1, gradeB: 1 })}>Reset</button>
          </div>
          {colourMode === 'rgba' ? <>
            {control('R', effects.gradeR * 100, 0, 100, 1, (value) => update({ gradeR: value / 100 }))}
            {control('G', effects.gradeG * 100, 0, 100, 1, (value) => update({ gradeG: value / 100 }))}
            {control('B', effects.gradeB * 100, 0, 100, 1, (value) => update({ gradeB: value / 100 }))}
          </> : <>
            {(['c', 'm', 'y', 'k'] as const).map((channel) => control(channel.toUpperCase(),
              cmyka[channel] * 100, 0, 100, 1, (value) =>
                change(effectsFromCmyka(effects, { ...cmyka, [channel]: value / 100 }))))}
          </>}
          {control('A', effects.alpha * 100, 0, 100, 1, (value) => update({ alpha: value / 100 }))}
          <small className="gvid-effects-note">Mock colour conversion; exact grading needs the colour pipeline.</small>
        </section>
        <section className="gvid-effects-section" aria-label="Transform">
          <div className="gvid-effects-section-head"><h3>Transform</h3><span>Centre (0, 0)</span>
            <button type="button" disabled={!canEdit || (acceptedEffects.moveX === 0 &&
              acceptedEffects.moveY === 0 && acceptedEffects.scaleX === 1 &&
              acceptedEffects.scaleY === 1 && acceptedEffects.rotateDeg === 0)}
              onClick={() => reset({ moveX: 0, moveY: 0, scaleX: 1, scaleY: 1, rotateDeg: 0 })}>
              Reset</button></div>
          {control('Move X', effects.moveX, -640, 640, 1, (value) => update({ moveX: value }), 'px', -4096, 4096)}
          {control('Move Y', effects.moveY, -360, 360, 1, (value) => update({ moveY: value }), 'px', -4096, 4096)}
          <label className="gvid-effects-link"><input type="checkbox" checked={scaleLinked}
            onChange={(event) => scaleLinkTap?.set(event.currentTarget.checked)} /> Link scale axes</label>
          {control('Scale X', effects.scaleX * 100, 1, 400, 1, (value) => update(scaleLinked ?
            { scaleX: value / 100, scaleY: value / 100 } : { scaleX: value / 100 }))}
          {control('Scale Y', effects.scaleY * 100, 1, 400, 1, (value) => update(scaleLinked ?
            { scaleX: value / 100, scaleY: value / 100 } : { scaleY: value / 100 }))}
          {control('Rotate', effects.rotateDeg, -360, 360, 1, (value) => update({ rotateDeg: value }), 'deg', -3600, 3600)}
        </section>
        <section className="gvid-effects-section" aria-label="Effects profiles">
          <h3>Effects profiles</h3>
          <div className="gvid-effects-profile-row">
            <input type="text" value={profileName} maxLength={80} aria-label="Profile name"
              placeholder="Profile name" onChange={(event) => profileNameTap?.set(event.currentTarget.value)} />
            <button type="button" disabled={!clip || !profileName.trim() || !edit}
              onClick={() => { const target = scope(); if (target)
                void edit?.saveEffectsProfile({ ...target, name: profileName }); }}>Save</button>
          </div>
          <div className="gvid-effects-profile-row">
            <select aria-label="Effects profile" value={currentProfile?.id ?? ''}
              onChange={(event) => profileChoiceTap?.set(event.currentTarget.value)}>
              {!currentProfile && <option value="">No profiles</option>}
              {profiles.map((item) => <option key={item.id} value={item.id}>{item.name} v{item.version}</option>)}
            </select>
            <button type="button" disabled={!canEdit || !currentProfile || !profileFits}
              title={!profileFits ? 'Profile keyframes do not fit this clip' : 'Replace all clip effects and keyframes'}
              onClick={() => { const target = scope(); if (target && currentProfile)
                void edit?.applyEffectsProfile({ ...target, profileId: currentProfile.id,
                  profileVersion: currentProfile.version }); }}>Apply</button>
          </div>
          {currentProfile && <div className="gvid-effects-profile-summary">
            <strong>{currentProfile.name} v{currentProfile.version}</strong>
            <span>{currentProfile.keyframes.length} keyframes · base alpha {Math.round(currentProfile.base.alpha * 100)}%</span>
            <span>Apply replaces this clip's effects and keyframes.</span>
          </div>}
          {currentProfile && !profileFits && <small>Profile keyframes exceed this clip.</small>}
        </section>
      </div>
      <footer className="gvid-effects-status" role="status">
        {activeDraft ? 'Uncommitted values' : result?.message ?? 'Mock effects preview'}
      </footer>
    </>}
  </section>;
}

addEntry(GVID_EFFECTS_PLUGIN, {
  tools: {
    [GVID_TOOLS.effects]: {
      label: 'Effects', defaultSize: { w: 470, h: 690 }, role: 'source',
      windowComponent: EffectsEditor,
      tabTaps: () => [
        createAtomValueTap(GVID_EFFECTS_PIN, { initial: null, handleGrip: GVID_EFFECTS_PIN_TAP }),
        createAtomValueTap(GVID_EFFECTS_DRAFT, { initial: null, handleGrip: GVID_EFFECTS_DRAFT_TAP }),
        createAtomValueTap(GVID_EFFECTS_COLOUR_MODE, { initial: 'rgba', handleGrip: GVID_EFFECTS_COLOUR_MODE_TAP }),
        createAtomValueTap(GVID_EFFECTS_SCALE_LINK, { initial: true, handleGrip: GVID_EFFECTS_SCALE_LINK_TAP }),
        createAtomValueTap(GVID_EFFECTS_PROFILE_NAME, { initial: '', handleGrip: GVID_EFFECTS_PROFILE_NAME_TAP }),
        createAtomValueTap(GVID_EFFECTS_PROFILE_CHOICE, { initial: '', handleGrip: GVID_EFFECTS_PROFILE_CHOICE_TAP }),
      ],
    },
  },
});
