import { describe, expect, it } from 'vitest';
import type { GrythPlugin } from '@grythjs/plugin-api';
import { PluginRegistryTap } from '@grythjs/plugin-api';
import '@grythjs/plugin-settings';
import '@gvidjs/plugin-assets';
import '@gvidjs/plugin-effects';
import '@gvidjs/plugin-source';
import '@gvidjs/plugin-sequence';
import '@gvidjs/plugin-timeline';
import { GVID_TOOLS } from '@gvidjs/contracts';
import { GVID_DESK } from './desk';

describe('GVid first-run desk', () => {
  it('registers all five GVid tools and the existing Settings tool', () => {
    const ids = [...PluginRegistryTap.get().values()]
      .flatMap((plugin) => Object.keys((plugin as GrythPlugin).tools ?? {}));
    for (const id of [...Object.values(GVID_TOOLS), 'settings']) {
      expect(ids.filter((candidate) => candidate === id)).toHaveLength(1);
    }
  });

  it('starts with the accepted two-row four-panel arrangement', () => {
    expect(GVID_DESK.locked).toBe(true);
    expect(GVID_DESK.foundation?.layout.direction).toBe('column');
    expect(GVID_DESK.foundation?.designate[GVID_TOOLS.effects]).toBe('source');
    const rows = GVID_DESK.foundation?.layout.children ?? [];
    expect(rows.map((row) => row.size)).toEqual([58, 42]);
    expect(rows[0]?.children?.map((panel) => [panel.id, panel.size])).toEqual([
      ['assets', 22],
      ['source', 39],
      ['sequence-preview', 39],
    ]);
    expect(rows[1]?.id).toBe('timeline');
    expect(GVID_DESK.tools?.map((tool) => [tool.toolId, tool.wiredTo])).toEqual([
      [GVID_TOOLS.assets, undefined],
      [GVID_TOOLS.source, GVID_TOOLS.assets],
      [GVID_TOOLS.timeline, undefined],
      [GVID_TOOLS.sequence, GVID_TOOLS.timeline],
    ]);
  });
});
