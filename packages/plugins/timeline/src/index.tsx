import { addEntry } from '@grythjs/plugin-api';
import { GVID_TIMELINE_PLUGIN, GVID_TOOLS } from '@gvidjs/contracts';

export function Placeholder() {
  return <div className="gvid-placeholder">Timeline</div>;
}

addEntry(GVID_TIMELINE_PLUGIN, {
  tools: {
    [GVID_TOOLS.timeline]: {
      label: 'Timeline',
      defaultSize: { w: 1100, h: 360 },
      role: 'timeline',
      windowComponent: Placeholder,
    },
  },
});
