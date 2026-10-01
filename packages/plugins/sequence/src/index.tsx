import { addEntry } from '@grythjs/plugin-api';
import { GVID_PREVIEW_PLUGIN, GVID_TOOLS } from '@gvidjs/contracts';

export function Placeholder() {
  return <div className="gvid-placeholder">Timeline viewer</div>;
}

addEntry(GVID_PREVIEW_PLUGIN, {
  tools: {
    [GVID_TOOLS.sequence]: {
      label: 'Timeline viewer',
      defaultSize: { w: 640, h: 520 },
      role: 'sequence-preview',
      windowComponent: Placeholder,
    },
  },
});
