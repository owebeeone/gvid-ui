import { addEntry } from '@grythjs/plugin-api';
import { GVID_ASSETS_PLUGIN, GVID_TOOLS } from '@gvidjs/contracts';

export function Placeholder() {
  return <div className="gvid-placeholder">Media library</div>;
}

addEntry(GVID_ASSETS_PLUGIN, {
  tools: {
    [GVID_TOOLS.assets]: {
      label: 'Media library',
      defaultSize: { w: 360, h: 520 },
      role: 'assets',
      windowComponent: Placeholder,
    },
  },
});
