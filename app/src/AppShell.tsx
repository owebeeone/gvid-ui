import { Desktop } from '@grythjs/desktop';

export function SessionNotice() {
  return (
    <div className="gvid-session-notice" role="status">
      Edits and undo history are session-only. Reloading or closing this browser tab discards them.
    </div>
  );
}

export function AppShell() {
  return (
    <div className="gvid-app">
      <SessionNotice />
      <Desktop />
    </div>
  );
}
