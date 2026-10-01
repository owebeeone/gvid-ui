import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { Desktop } from '@grythjs/desktop';
import { AppShell, SessionNotice } from './AppShell';

describe('GVid session warning', () => {
  it('names edit and undo loss on reload or browser close', () => {
    const html = renderToStaticMarkup(<SessionNotice />);
    expect(html).toContain('role="status"');
    expect(html).toMatch(/Edits and undo history are session-only/);
    expect(html).toMatch(/Reloading or closing this browser tab discards them/);
  });

  it('keeps the warning outside the dockable desktop', () => {
    const shell = AppShell();
    const children = shell.props.children as ReactElement[];
    expect(children.map((child) => child.type)).toEqual([SessionNotice, Desktop]);
  });
});
