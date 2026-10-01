import type {
  AssetRecord,
  FrameProvider,
  FrameResult,
  SequenceClip,
  SourceFrameKey,
} from '@gvidjs/contracts';

const WIDTH = 640;
const HEIGHT = 360;
const STYLE_VERSION = 'mock-frame-v1';
const MAX_ENTRIES = 64;
const MAX_BYTES = 32 * 1024 * 1024;

export interface MockFrameInput {
  asset: AssetRecord;
  sourceFrame: number;
  width: number;
  height: number;
}

export interface MockFrameProviderOptions {
  encodePng?: (input: MockFrameInput) => Promise<Blob>;
}

let nextLeaseId = 0;

function abortError(): DOMException {
  return new DOMException('Frame request cancelled', 'AbortError');
}

function awaitOrAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error) => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

function validId(value: string): boolean {
  return value.length > 0;
}

function validAsset(asset: AssetRecord): boolean {
  return validId(asset.id) && validId(asset.version) && validId(asset.fingerprint) &&
    validId(asset.streamId) && validId(asset.displayName) &&
    Number.isSafeInteger(asset.frameCount) && asset.frameCount > 0 &&
    asset.width === WIDTH && asset.height === HEIGHT &&
    Number.isSafeInteger(asset.frameRate.num) && asset.frameRate.num > 0 &&
    Number.isSafeInteger(asset.frameRate.den) && asset.frameRate.den > 0;
}

function validSourcePts(key: SourceFrameKey, asset: AssetRecord): boolean {
  const { num, den } = key.sourcePts;
  return Number.isSafeInteger(key.sourceFrame) && Number.isSafeInteger(num) && num >= 0 &&
    Number.isSafeInteger(den) && den > 0 &&
    BigInt(num) * BigInt(asset.frameRate.num) ===
      BigInt(key.sourceFrame) * BigInt(asset.frameRate.den) * BigInt(den);
}

function validClip(clip: SequenceClip): boolean {
  return validId(clip.id) && validId(clip.assetId) &&
    [clip.sourceIn, clip.sourceOut, clip.timelineIn, clip.timelineOut].every(Number.isSafeInteger) &&
    clip.sourceIn >= 0 && clip.timelineIn >= 0 &&
    clip.sourceIn < clip.sourceOut && clip.timelineIn < clip.timelineOut &&
    clip.sourceOut - clip.sourceIn === clip.timelineOut - clip.timelineIn;
}

function failed<K>(key: K, code: string, message: string, composition?: 'mock-single-track'): FrameResult<K> {
  return { key, state: 'failed', fidelity: 'mock', composition, diagnostic: { code, message } };
}

function colorSeed(input: MockFrameInput): number {
  let hash = 2166136261;
  const identity = `${input.asset.id}|${input.asset.fingerprint}|${input.asset.displayName}|${input.sourceFrame}`;
  for (let index = 0; index < identity.length; index += 1) {
    hash = Math.imul(hash ^ identity.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

async function encodeCanvasPng(input: MockFrameInput): Promise<Blob> {
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(input.width, input.height)
    : document.createElement('canvas');
  canvas.width = input.width;
  canvas.height = input.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas is unavailable');

  const seed = colorSeed(input);
  context.fillStyle = `hsl(${seed % 360} 38% 24%)`;
  context.fillRect(0, 0, input.width, input.height);
  context.fillStyle = `hsl(${(seed + 144) % 360} 52% 42%)`;
  context.fillRect(0, input.height - 95, input.width, 95);
  context.fillStyle = '#ffffff';
  context.font = 'bold 36px sans-serif';
  const name = input.asset.displayName;
  const measured = context.measureText(name).width;
  context.save();
  if (measured > input.width - 64) {
    context.translate(32, 0);
    context.scale((input.width - 64) / measured, 1);
    context.fillText(name, 0, 105);
  } else {
    context.fillText(name, 32, 105);
  }
  context.restore();
  context.font = 'bold 50px sans-serif';
  context.fillText(`Frame ${input.sourceFrame}`, 32, input.height - 28);

  if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: 'image/png' });
  }
  return new Promise<Blob>((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('PNG encoding failed')),
      'image/png',
    );
  });
}

export function createMockFrameProvider(options: MockFrameProviderOptions = {}): FrameProvider {
  const encodePng = options.encodePng ?? encodeCanvasPng;
  const cache = new Map<string, Blob>();
  const inFlight = new Map<string, Promise<Blob>>();
  const leases = new Map<string, string>();
  let cacheBytes = 0;

  function pixels(projectId: string, sessionId: string, asset: AssetRecord, sourceFrame: number): Promise<Blob> {
    const identity = JSON.stringify([
      projectId, sessionId, asset.id, asset.version, asset.fingerprint, asset.streamId,
      asset.displayName, sourceFrame, WIDTH, HEIGHT, STYLE_VERSION,
    ]);
    const cached = cache.get(identity);
    if (cached) {
      cache.delete(identity);
      cache.set(identity, cached);
      return Promise.resolve(cached);
    }
    const existing = inFlight.get(identity);
    if (existing) return existing;

    const pending = Promise.resolve()
      .then(() => encodePng({ asset, sourceFrame, width: WIDTH, height: HEIGHT }))
      .then((blob) => {
        if (!(blob instanceof Blob) || blob.type !== 'image/png') {
          throw new Error('Encoder must return a PNG Blob');
        }
        if (blob.size <= MAX_BYTES) {
          cache.set(identity, blob);
          cacheBytes += blob.size;
          while (cache.size > MAX_ENTRIES || cacheBytes > MAX_BYTES) {
            const oldest = cache.keys().next().value;
            if (oldest === undefined) break;
            cacheBytes -= cache.get(oldest)!.size;
            cache.delete(oldest);
          }
        }
        return blob;
      })
      .finally(() => inFlight.delete(identity));
    inFlight.set(identity, pending);
    return pending;
  }

  async function deliver<K>(
    key: K,
    projectId: string,
    sessionId: string,
    asset: AssetRecord,
    sourceFrame: number,
    signal: AbortSignal,
    composition?: 'mock-single-track',
  ): Promise<FrameResult<K>> {
    try {
      const blob = await awaitOrAbort(pixels(projectId, sessionId, asset, sourceFrame), signal);
      if (signal.aborted) throw abortError();
      const objectUrl = URL.createObjectURL(blob);
      const leaseId = `mock-png-${++nextLeaseId}`;
      leases.set(leaseId, objectUrl);
      if (signal.aborted) {
        leases.delete(leaseId);
        URL.revokeObjectURL(objectUrl);
        throw abortError();
      }
      return { key, state: 'ready', fidelity: 'mock', composition,
        resource: { kind: 'mock-png', leaseId, objectUrl } };
    } catch (error) {
      if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw abortError();
      return failed(key, 'encode-failed', error instanceof Error ? error.message : String(error), composition);
    }
  }

  return {
    source(key, asset, signal) {
      if (signal.aborted) return Promise.reject(abortError());
      if (!validId(key.requestId) || !validId(key.cancelGroupId) || !validId(key.viewerId) ||
        !validId(key.projectId) || !validId(key.sessionId) ||
        !Number.isSafeInteger(key.revision) || key.revision < 0 || !validAsset(asset) ||
        key.assetId !== asset.id || key.assetVersion !== asset.version ||
        key.fingerprint !== asset.fingerprint || key.streamId !== asset.streamId) {
        return Promise.resolve(failed(key, 'invalid-context', 'Source request does not match the registered asset'));
      }
      if (!Number.isSafeInteger(key.sourceFrame) || key.sourceFrame < 0 || key.sourceFrame >= asset.frameCount) {
        return Promise.resolve(failed(key, 'out-of-range', 'Source frame is outside the asset'));
      }
      if (!validSourcePts(key, asset)) {
        return Promise.resolve(failed(key, 'invalid-context', 'Source PTS does not match the frame'));
      }
      if (asset.status !== 'ready') {
        return Promise.resolve(failed(key, 'unavailable', 'Asset is not ready'));
      }
      return deliver(key, key.projectId, key.sessionId, asset, key.sourceFrame, signal);
    },
    sequence(key, clip, asset, signal) {
      if (signal.aborted) return Promise.reject(abortError());
      const composition = 'mock-single-track';
      if (!validId(key.requestId) || !validId(key.cancelGroupId) || !validId(key.viewerId) ||
        !validId(key.projectId) || !validId(key.sessionId) || !validId(key.graphId) ||
        !validId(key.sequenceId) || !validId(key.bindingSetId) ||
        !Number.isSafeInteger(key.revision) || key.revision < 0 ||
        !Number.isSafeInteger(key.bindingRevision) || key.bindingRevision < 0 ||
        !Number.isSafeInteger(key.timelineFrame) || key.timelineFrame < 0) {
        return Promise.resolve(failed(key, 'invalid-context', 'Invalid sequence request', composition));
      }
      if (clip === null) {
        return Promise.resolve({ key, state: 'gap', fidelity: 'mock', composition });
      }
      if (!validClip(clip)) {
        return Promise.resolve(failed(key, 'invalid-clip', 'Invalid clip span', composition));
      }
      if (key.timelineFrame < clip.timelineIn || key.timelineFrame >= clip.timelineOut) {
        return Promise.resolve({ key, state: 'gap', fidelity: 'mock', composition });
      }
      if (!asset || !validAsset(asset) || clip.assetId !== asset.id || clip.sourceOut > asset.frameCount) {
        return Promise.resolve(failed(key, 'invalid-clip', 'Clip does not match a valid asset span', composition));
      }
      if (asset.status !== 'ready') {
        return Promise.resolve(failed(key, 'unavailable', 'Asset is not ready', composition));
      }
      const sourceFrame = clip.sourceIn + key.timelineFrame - clip.timelineIn;
      return deliver(key, key.projectId, key.sessionId, asset, sourceFrame, signal, composition);
    },
    release(leaseId) {
      const objectUrl = leases.get(leaseId);
      if (objectUrl === undefined) return;
      leases.delete(leaseId);
      URL.revokeObjectURL(objectUrl);
    },
  };
}
