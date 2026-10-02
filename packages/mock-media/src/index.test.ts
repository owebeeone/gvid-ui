import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AssetRecord,
  FrameResult,
  SequenceClip,
  SequenceFrameKey,
  SourceFrameKey,
} from '@gvidjs/contracts';
import { createMockFrameProvider, type MockFrameInput } from './index';

const asset: AssetRecord = {
  id: 'lighthouse',
  displayName: 'Lighthouse',
  version: 'v1',
  fingerprint: 'bytes-a',
  streamId: 'video-0',
  frameCount: 120,
  width: 640,
  height: 360,
  frameRate: { num: 24, den: 1 },
  status: 'ready',
};

const clip: SequenceClip = {
  id: 'clip-a', assetId: asset.id, sourceIn: 12, sourceOut: 60,
  timelineIn: 0, timelineOut: 48,
};

function sourceKey(sourceFrame = 12, overrides: Partial<SourceFrameKey> = {}): SourceFrameKey {
  return {
    requestId: 'request-a', cancelGroupId: 'group-a', viewerId: 'viewer-a',
    sessionId: 'session-a', projectId: 'mock-a', revision: 1, assetId: asset.id,
    assetVersion: asset.version, fingerprint: asset.fingerprint, streamId: asset.streamId,
    sourceFrame, sourcePts: { num: sourceFrame, den: 24 }, ...overrides,
  };
}

function sequenceKey(timelineFrame = 0, overrides: Partial<SequenceFrameKey> = {}): SequenceFrameKey {
  return {
    requestId: 'request-b', cancelGroupId: 'group-b', viewerId: 'viewer-b',
    sessionId: 'session-a', projectId: 'mock-a', graphId: 'graph-a',
    sequenceId: 'main', revision: 1, bindingSetId: 'bindings-a',
    bindingRevision: 1, timelineFrame, ...overrides,
  };
}

function png(payload = 'png'): Blob {
  return new Blob([payload], { type: 'image/png' });
}

function resource<K>(result: FrameResult<K>): { leaseId: string; objectUrl: string } {
  if (result.resource?.kind !== 'mock-png') throw new Error('Expected mock PNG resource');
  return result.resource;
}

let urlNumber: number;
beforeEach(() => {
  urlNumber = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:mock-${++urlNumber}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('createMockFrameProvider', () => {
  it('encodes a labeled 640x360 source frame and gives each result its own lease', async () => {
    const encodePng = vi.fn(async (input: MockFrameInput) => png(`${input.asset.displayName}:${input.sourceFrame}`));
    const provider = createMockFrameProvider({ encodePng });
    const signal = new AbortController().signal;
    const firstKey = sourceKey();
    const first = await provider.source(firstKey, asset, signal);
    const second = await provider.source(sourceKey(12, { requestId: 'request-c' }), asset, signal);

    expect(first).toMatchObject({ key: firstKey, state: 'ready', fidelity: 'mock' });
    expect(encodePng).toHaveBeenCalledExactlyOnceWith({ asset, sourceFrame: 12, width: 640, height: 360 });
    expect(resource(first).leaseId).not.toBe(resource(second).leaseId);
    expect(resource(first).objectUrl).not.toBe(resource(second).objectUrl);
    provider.release(resource(first).leaseId);
    provider.release(resource(first).leaseId);
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(resource(first).objectUrl);
    provider.release(resource(second).leaseId);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('rejects source bounds, mismatched context and unavailable assets without encoding', async () => {
    const encodePng = vi.fn(async () => png());
    const provider = createMockFrameProvider({ encodePng });
    const signal = new AbortController().signal;
    for (const frame of [-1, 120, 1.5]) {
      const result = await provider.source(sourceKey(frame), asset, signal);
      expect(result).toMatchObject({ state: 'failed', diagnostic: { code: 'out-of-range' } });
    }
    for (const overrides of [
      { assetVersion: 'v2' }, { fingerprint: 'other' }, { streamId: 'other' },
      { projectId: '' }, { revision: -1 }, { sourcePts: { num: 13, den: 24 } },
    ]) {
      const result = await provider.source(sourceKey(12, overrides), asset, signal);
      expect(result).toMatchObject({ state: 'failed', diagnostic: { code: 'invalid-context' } });
    }
    const unavailable = await provider.source(sourceKey(), { ...asset, status: 'changed' }, signal);
    expect(unavailable).toMatchObject({ state: 'failed', diagnostic: { code: 'unavailable' } });
    expect(encodePng).not.toHaveBeenCalled();
  });

  it('maps the active sequence clip with nonzero source In and emits an explicit gap', async () => {
    const encodePng = vi.fn(async () => png());
    const provider = createMockFrameProvider({ encodePng });
    const signal = new AbortController().signal;
    const key = sequenceKey(5);
    const frame = await provider.sequence(key, clip, asset, signal);
    expect(frame).toMatchObject({ key, state: 'ready', fidelity: 'mock', composition: 'mock-topmost-track' });
    expect(encodePng).toHaveBeenCalledExactlyOnceWith({ asset, sourceFrame: 17, width: 640, height: 360 });
    provider.release(resource(frame).leaseId);
    for (const [frameNumber, activeClip] of [[48, clip], [3, null]] as const) {
      const gap = await provider.sequence(sequenceKey(frameNumber), activeClip, null, signal);
      expect(gap).toMatchObject({ state: 'gap', fidelity: 'mock', composition: 'mock-topmost-track' });
      expect(gap.resource).toBeUndefined();
    }
    expect(encodePng).toHaveBeenCalledTimes(1);
  });

  it('shares encoded pixels between source and sequence while keeping leases independent', async () => {
    const encodePng = vi.fn(async () => png());
    const provider = createMockFrameProvider({ encodePng });
    const signal = new AbortController().signal;
    const source = await provider.source(sourceKey(17), asset, signal);
    const sequence = await provider.sequence(sequenceKey(5), clip, asset, signal);
    expect(encodePng).toHaveBeenCalledTimes(1);
    expect(resource(source).leaseId).not.toBe(resource(sequence).leaseId);
    provider.release(resource(source).leaseId);
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(resource(source).objectUrl);
    provider.release(resource(sequence).leaseId);
  });

  it('fails invalid active clips and missing assets without showing a frame', async () => {
    const provider = createMockFrameProvider({ encodePng: async () => png() });
    const signal = new AbortController().signal;
    const invalid = await provider.sequence(sequenceKey(), { ...clip, sourceOut: 61 }, asset, signal);
    const missing = await provider.sequence(sequenceKey(), clip, null, signal);
    const wrongAsset = await provider.sequence(sequenceKey(), clip, { ...asset, id: 'other' }, signal);
    for (const result of [invalid, missing, wrongAsset]) {
      expect(result).toMatchObject({ state: 'failed', composition: 'mock-topmost-track' });
      expect(result.resource).toBeUndefined();
    }
  });

  it('isolates cached pixels by project, session, asset identity, name and frame', async () => {
    const encodePng = vi.fn(async () => png());
    const provider = createMockFrameProvider({ encodePng });
    const signal = new AbortController().signal;
    const cases: Array<[SourceFrameKey, AssetRecord]> = [
      [sourceKey(), asset],
      [sourceKey(12, { projectId: 'mock-b' }), asset],
      [sourceKey(12, { sessionId: 'session-b' }), asset],
      [sourceKey(12, { assetVersion: 'v2' }), { ...asset, version: 'v2' }],
      [sourceKey(12, { fingerprint: 'bytes-b' }), { ...asset, fingerprint: 'bytes-b' }],
      [sourceKey(), { ...asset, displayName: 'Other Lighthouse' }],
      [sourceKey(13), asset],
    ];
    for (const [key, record] of cases) {
      const result = await provider.source(key, record, signal);
      expect(result.state).toBe('ready');
      provider.release(resource(result).leaseId);
    }
    expect(encodePng).toHaveBeenCalledTimes(cases.length);
    const repeated = await provider.source(sourceKey(12, { requestId: 'new-request' }), asset, signal);
    expect(repeated.state).toBe('ready');
    expect(encodePng).toHaveBeenCalledTimes(cases.length);
    provider.release(resource(repeated).leaseId);
  });

  it('bounds the pixel cache by entry count and encoded bytes', async () => {
    const signal = new AbortController().signal;
    const encodePng = vi.fn(async () => png());
    const provider = createMockFrameProvider({ encodePng });
    for (let frame = 0; frame < 65; frame += 1) {
      const result = await provider.source(sourceKey(frame), asset, signal);
      provider.release(resource(result).leaseId);
    }
    const newest = await provider.source(sourceKey(64), asset, signal);
    provider.release(resource(newest).leaseId);
    expect(encodePng).toHaveBeenCalledTimes(65);
    const oldest = await provider.source(sourceKey(0), asset, signal);
    provider.release(resource(oldest).leaseId);
    expect(encodePng).toHaveBeenCalledTimes(66);

    const large = new Blob([new Uint8Array(2 * 1024 * 1024)], { type: 'image/png' });
    const largeEncoder = vi.fn(async () => large);
    const byteProvider = createMockFrameProvider({ encodePng: largeEncoder });
    for (let frame = 0; frame < 17; frame += 1) {
      const result = await byteProvider.source(sourceKey(frame), asset, signal);
      byteProvider.release(resource(result).leaseId);
    }
    const evicted = await byteProvider.source(sourceKey(0), asset, signal);
    byteProvider.release(resource(evicted).leaseId);
    expect(largeEncoder).toHaveBeenCalledTimes(18);
  });

  it('keeps a leased URL alive after its pixels are evicted', async () => {
    const provider = createMockFrameProvider({ encodePng: async () => png() });
    const signal = new AbortController().signal;
    const retained = await provider.source(sourceKey(0), asset, signal);
    for (let frame = 1; frame <= 64; frame += 1) {
      const result = await provider.source(sourceKey(frame), asset, signal);
      provider.release(resource(result).leaseId);
    }
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(resource(retained).objectUrl);
    provider.release(resource(retained).leaseId);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(resource(retained).objectUrl);
  });

  it('draws the display name and zero-based frame through the default canvas encoder', async () => {
    const fillText = vi.fn();
    const context = {
      fillStyle: '', font: '', fillRect: vi.fn(), measureText: () => ({ width: 100 }),
      save: vi.fn(), restore: vi.fn(), translate: vi.fn(), scale: vi.fn(), fillText,
    };
    const sizes: Array<[number, number]> = [];
    vi.stubGlobal('OffscreenCanvas', class {
      width: number;
      height: number;
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        sizes.push([width, height]);
      }
      getContext() { return context; }
      async convertToBlob() { return png(); }
    });
    const provider = createMockFrameProvider();
    const result = await provider.source(sourceKey(0), asset, new AbortController().signal);
    expect(result.state).toBe('ready');
    expect(sizes).toEqual([[640, 360]]);
    expect(fillText).toHaveBeenCalledWith('Lighthouse', 32, 105);
    expect(fillText).toHaveBeenCalledWith('Frame 0', 32, 332);
    provider.release(resource(result).leaseId);
  });

  it('cancels a delayed request without delivering a lease, while another waiter succeeds', async () => {
    let finish!: (blob: Blob) => void;
    const deferred = new Promise<Blob>((resolve) => { finish = resolve; });
    const encodePng = vi.fn(() => deferred);
    const provider = createMockFrameProvider({ encodePng });
    const cancelled = new AbortController();
    const active = new AbortController();
    const first = provider.source(sourceKey(), asset, cancelled.signal);
    const second = provider.source(sourceKey(12, { requestId: 'request-2' }), asset, active.signal);
    cancelled.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    finish(png());
    const delivered = await second;
    expect(delivered.state).toBe('ready');
    expect(encodePng).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    provider.release(resource(delivered).leaseId);
  });

  it('reports encoder failures and retries them; pre-aborted requests do no work', async () => {
    const encodePng = vi.fn()
      .mockRejectedValueOnce(new Error('controlled failure'))
      .mockResolvedValueOnce(png());
    const provider = createMockFrameProvider({ encodePng });
    const aborted = new AbortController();
    aborted.abort();
    await expect(provider.source(sourceKey(), asset, aborted.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(encodePng).not.toHaveBeenCalled();
    const failed = await provider.source(sourceKey(), asset, new AbortController().signal);
    expect(failed).toMatchObject({ state: 'failed', diagnostic: { code: 'encode-failed', message: 'controlled failure' } });
    expect(failed.resource).toBeUndefined();
    const retried = await provider.source(sourceKey(), asset, new AbortController().signal);
    expect(retried.state).toBe('ready');
    provider.release(resource(retried).leaseId);
  });
});
