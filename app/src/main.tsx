import './style.css';
import '@grythjs/plugin-settings';
import '@gvidjs/plugin-assets';
import '@gvidjs/plugin-source';
import '@gvidjs/plugin-sequence';
import '@gvidjs/plugin-timeline';

import ReactDOM from 'react-dom/client';
import { GripProvider, createAtomValueTap } from '@owebeeone/grip-react';
import { grok, main, PluginRegistryTap } from '@grythjs/plugin-api';
import { registerDesktopTaps } from '@grythjs/desktop';
import { registerSettingsTaps } from '@grythjs/plugin-settings';
import { registerMockTaps } from '@gvidjs/editor-core';
import { createMockFrameProvider } from '@gvidjs/mock-media';
import { GVID_FRAME_PROVIDER, GVID_SOURCE_DRAG, GVID_SOURCE_DRAG_TAP,
  GVID_TIMELINE_CLIP_DRAG, GVID_TIMELINE_CLIP_DRAG_TAP,
  GVID_TIMELINE_TRIM_DRAFT, GVID_TIMELINE_TRIM_DRAFT_TAP } from '@gvidjs/contracts';
import { GVID_DESK } from './desk';
import { AppShell } from './AppShell';

grok.registerTap(PluginRegistryTap);
grok.registerTap(createAtomValueTap(GVID_FRAME_PROVIDER, { initial: createMockFrameProvider() }));
grok.registerTap(createAtomValueTap(GVID_SOURCE_DRAG, { initial: null, handleGrip: GVID_SOURCE_DRAG_TAP }));
grok.registerTap(createAtomValueTap(GVID_TIMELINE_CLIP_DRAG, { initial: null, handleGrip: GVID_TIMELINE_CLIP_DRAG_TAP }));
grok.registerTap(createAtomValueTap(GVID_TIMELINE_TRIM_DRAFT, { initial: null, handleGrip: GVID_TIMELINE_TRIM_DRAFT_TAP }));
registerSettingsTaps(grok);
registerMockTaps(grok);
registerDesktopTaps(grok, GVID_DESK);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <GripProvider grok={grok} context={main}>
    <AppShell />
  </GripProvider>,
);
