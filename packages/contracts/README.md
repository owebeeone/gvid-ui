# GVid UI Shared Contract (Mock Phase 0)

This package is the provisional common import for the parallel mock lanes. The accepted source of truth is `D:\projects\gvid-wz\dev-docs\ui-design-v2.md`; this file pins the build's current names and producer ownership. A lane may ask the integration owner for an amendment, but must not mint a duplicate Grip or alter a shared signature independently.

## Scope and ownership

| Producer | Grips / contract |
| --- | --- |
| Gryth app boot | One `PluginRegistryTap`, one `registerDesktopTaps`, one existing `registerSettingsTaps`. |
| `ProjectSessionTap` | `GVID_DEST_PROJECT_ID`, `GVID_PROJECT_VIEW`, `GVID_PROJECT_CONTROL`. |
| `GraphMirrorTap` and `BindingCatalogTap` | `GVID_GRAPH_VIEW`, `GVID_CHANGE_STATUS`, `GVID_ASSET_CATALOG`, `GVID_BINDING_VIEW`. |
| `SequenceProjectionTap` | `GVID_SEQUENCE_VIEW`. |
| `ActiveInsertTargetTap`, `EditorCommandTap`, `HistoryTap` | Insertion target, edit command/result and history Grips. |
| `MockMediaProviderTap` | `GVID_FRAME_PROVIDER`; separate source and sequence results are never shared scalar slots. |
| Assets tab | Asset selection and query values/handles. |
| Source tab | Source link/destination, source cursor/transport, source marks, source result/presentation and viewer identity. |
| Timeline tab | Sequence selection, timeline cursor/transport, timeline marks, selected track/clip, viewport and insertion target intent. |
| Sequence viewer tab | Sequence link/destination, sequence result/presentation and viewer identity. |

The root project fixture is `mock-a`, sequence `main`, 24/1 fps and one video track. Its two 640x360 assets are Lighthouse (120 frames) and Workshop (90 frames). The initial clips are Lighthouse source `[12,60)` at timeline `[0,48)`, then Workshop source `[5,53)` at `[48,96)`. All frame indices are zero-based; In is included and Out is exclusive. A second `mock-b` fixture is for cross-project request/cache tests.

The source viewer resolves registered asset frames without a graph slot. The timeline viewer requests the sequence position; the mock may map its sole active clip to a PNG but must mark the result `mock-single-track`. `FrameResult<K>` and `FramePresentation<K>` are media-neutral. A panel reads them through `useGrip`; it does not render a PNG, run its own timer, or retain a lease independently of its tap. Results must be compared with the complete current key at publication. On cancellation or tab close, the owner calls `FrameProvider.release` for each abandoned lease.

Use Gryth tab contexts for tab-local state and the six destination axes. Do not use React local state/effect hooks. The root `pnpm test` command includes the no-React-state scanner.
