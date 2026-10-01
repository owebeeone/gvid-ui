import { addEntry } from '@grythjs/plugin-api';
import { GVID_SOURCE_PLUGIN, GVID_TOOLS } from '@gvidjs/contracts';

export function Placeholder() {
  return <div className="gvid-placeholder">Source viewer</div>;
}

addEntry(GVID_SOURCE_PLUGIN, {
  tools: {
    [GVID_TOOLS.source]: {
      label: 'Source viewer',
      defaultSize: { w: 640, h: 520 },
      role: 'source',
      windowComponent: Placeholder,
    },
  },
});
