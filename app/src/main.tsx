import './style.css';
import '@grythjs/plugin-settings';
import '@gvidjs/plugin-assets';
import '@gvidjs/plugin-source';
import '@gvidjs/plugin-sequence';
import '@gvidjs/plugin-timeline';

import ReactDOM from 'react-dom/client';
import { GripProvider } from '@owebeeone/grip-react';
import { grok, main, PluginRegistryTap } from '@grythjs/plugin-api';
import { Desktop, registerDesktopTaps } from '@grythjs/desktop';
import { registerSettingsTaps } from '@grythjs/plugin-settings';
import { registerMockTaps } from '@gvidjs/editor-core';
import { GVID_DESK } from './desk';

grok.registerTap(PluginRegistryTap);
registerSettingsTaps(grok);
registerMockTaps(grok);
registerDesktopTaps(grok, GVID_DESK);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <GripProvider grok={grok} context={main}>
    <Desktop />
  </GripProvider>,
);
