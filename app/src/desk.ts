import type { DesktopSetup } from '@grythjs/desktop';
import { GVID_TOOLS } from '@gvidjs/contracts';

export const GVID_DESK: DesktopSetup = {
  entry: 'gvid-mock',
  locked: true,
  persistAppearance: true,
  foundation: {
    layout: {
      id: 'root',
      size: 100,
      direction: 'column',
      children: [
        {
          id: 'top',
          size: 58,
          direction: 'row',
          children: [
            { id: 'assets', size: 22 },
            { id: 'source', size: 39 },
            { id: 'sequence-preview', size: 39 },
          ],
        },
        { id: 'timeline', size: 42 },
      ],
    },
    designate: { settings: 'assets', [GVID_TOOLS.effects]: 'source' },
    fallback: 'sequence-preview',
  },
  tools: [
    { toolId: GVID_TOOLS.assets },
    { toolId: GVID_TOOLS.source, wiredTo: GVID_TOOLS.assets },
    { toolId: GVID_TOOLS.timeline },
    { toolId: GVID_TOOLS.sequence, wiredTo: GVID_TOOLS.timeline },
  ],
};
