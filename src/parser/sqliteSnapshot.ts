import * as fs from "node:fs";

export type SnapshotRefreshMode = "unchanged" | "incremental" | "full";

export interface SnapshotRefresh {
  changed: boolean;
  mode: SnapshotRefreshMode;
  data: Buffer;
  bytesRead: number;
  durationMs: number;
}

type Checksum = [number, number];

interface WalHeader {
  littleEndian: boolean;
  pageSize: number;
  checkpointSequence: number;
  salt1: number;
  salt2: number;
  checksum: Checksum;
}

interface WalFrame {
  bytes: Buffer;
  offset: number;
  page: number;
}

interface WalScan {
  frames: WalFrame[];
  committedEnd: number;
  checksum: Checksum;
  committedPages: number;
}

interface WalState extends Omit<WalHeader, "checksum"> {
  committedEnd: number;
  checksum: Checksum;
  committedPages: number;
}

interface SnapshotState {
  fingerprint: string;
  mainIdentity: string;
  wal?: WalState;
}

interface ReadCounter {
  bytesRead: number;
}

interface Source extends ReadCounter {
  main: fs.promises.FileHandle;
  wal?: fs.promises.FileHandle;
  mainBefore: fs.BigIntStats;
  walBefore?: fs.BigIntStats;
  fingerprint: string;
}

type RefreshOutcome = Omit<SnapshotRefresh, "durationMs">;

class SnapshotChangedError extends Error {}

const DATABASE_HEADER_BYTES = 100;
const WAL_HEADER_BYTES = 32;
const FRAME_HEADER_BYTES = 24;
const WAL_CHUNK_BYTES = 1024 * 1024;
const MAIN_CHUNK_BYTES = 16 * 1024 * 1024;
const STORAGE_ALIGNMENT = 64 * 1024;
const STORAGE_HEADROOM = 1.125;
const MAX_ATTEMPTS = 3;

function fileVersion(stat: fs.BigIntStats): string {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs ?? stat.mtimeMs}:${stat.ctimeNs ?? stat.ctimeMs}`;
}

function walVersion(stat: fs.BigIntStats | undefined): string {
  return stat ? fileVersion(stat) : "no-wal";
}

function fileIdentity(stat: fs.BigIntStats): string {
  return `${stat.dev}:${stat.ino}`;
}

async function openWal(dbPath: string): Promise<fs.promises.FileHandle | undefined> {
  try {
    return await fs.promises.open(`${dbPath}-wal`, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function statIfExists(filePath: string): Promise<fs.BigIntStats | undefined> {
  try {
    return await fs.promises.stat(filePath, { bigint: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function readAt(handle: fs.promises.FileHandle, position: number, length: number, counter: ReadCounter): Promise<Buffer> {
  const bytes = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    const { bytesRead } = await handle.read(bytes, filled, length - filled, position + filled);
    if (bytesRead === 0) break;
    filled += bytesRead;
  }
  counter.bytesRead += filled;
  return filled === length ? bytes : bytes.subarray(0, filled);
}

async function readInto(handle: fs.promises.FileHandle, target: Buffer, length: number, counter: ReadCounter): Promise<void> {
  let filled = 0;
  while (filled < length) {
    const { bytesRead } = await handle.read(target, filled, Math.min(MAIN_CHUNK_BYTES, length - filled), filled);
    if (bytesRead === 0) throw new SnapshotChangedError("Traces database shrank while reading its snapshot");
    filled += bytesRead;
    counter.bytesRead += bytesRead;
  }
}

function checksum(bytes: Buffer, start: number, end: number, littleEndian: boolean, seed: Checksum): Checksum {
  let [first, second] = seed;
  for (let offset = start; offset < end; offset += 8) {
    const firstWord = littleEndian ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
    const secondWord = littleEndian ? bytes.readUInt32LE(offset + 4) : bytes.readUInt32BE(offset + 4);
    first = (first + firstWord + second) >>> 0;
    second = (second + secondWord + first) >>> 0;
  }
  return [first, second];
}

function databasePageSize(databaseHeader: Buffer): number {
  const raw = databaseHeader.readUInt16BE(16);
  return raw === 1 ? 65536 : raw;
}

function parseWalHeader(wal: Buffer, expectedPageSize: number): WalHeader {
  const magic = wal.readUInt32BE(0);
  if ((magic !== 0x377f0682 && magic !== 0x377f0683) || wal.readUInt32BE(4) !== 3007000) {
    throw new Error("Unsupported SQLite WAL header");
  }
  const pageSize = wal.readUInt32BE(8);
  if (pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1)) !== 0 || pageSize !== expectedPageSize) {
    throw new Error("SQLite WAL page size does not match its database");
  }
  const littleEndian = magic === 0x377f0682;
  const headerChecksum = checksum(wal, 0, 24, littleEndian, [0, 0]);
  if (headerChecksum[0] !== wal.readUInt32BE(24) || headerChecksum[1] !== wal.readUInt32BE(28)) {
    throw new Error("Invalid SQLite WAL header checksum");
  }
  return {
    littleEndian,
    pageSize,
    checkpointSequence: wal.readUInt32BE(12),
    salt1: wal.readUInt32BE(16),
    salt2: wal.readUInt32BE(20),
    checksum: headerChecksum,
  };
}

function tryParseWalHeader(wal: Buffer, expectedPageSize: number): WalHeader | undefined {
  if (wal.length < WAL_HEADER_BYTES) return undefined;
  try {
    return parseWalHeader(wal, expectedPageSize);
  } catch {
    return undefined;
  }
}

function validateFrame(bytes: Buffer, offset: number, header: WalHeader, rolling: Checksum): Checksum | undefined {
  if (bytes.readUInt32BE(offset) === 0
    || bytes.readUInt32BE(offset + 8) !== header.salt1
    || bytes.readUInt32BE(offset + 12) !== header.salt2) return undefined;
  const data = offset + FRAME_HEADER_BYTES;
  let next = checksum(bytes, offset, offset + 8, header.littleEndian, rolling);
  next = checksum(bytes, data, data + header.pageSize, header.littleEndian, next);
  if (next[0] !== bytes.readUInt32BE(offset + 16) || next[1] !== bytes.readUInt32BE(offset + 20)) return undefined;
  return next;
}

/** Validates consecutive WAL frames across chunks and remembers the last commit frame. */
class WalScanner {
  stopped = false;
  private readonly header: WalHeader;
  private readonly frames: WalFrame[] = [];
  private rolling: Checksum;
  private committedFrames = 0;
  private committedEnd: number;
  private committedChecksum: Checksum;
  private committedPages = 0;

  constructor(header: WalHeader, start: number, seed: Checksum) {
    this.header = header;
    this.rolling = seed;
    this.committedEnd = start;
    this.committedChecksum = seed;
  }

  /** Scans whole frames in `bytes`, whose first byte is at WAL file offset `fileOffset`. */
  scan(bytes: Buffer, fileOffset: number): void {
    const frameSize = this.header.pageSize + FRAME_HEADER_BYTES;
    for (let offset = 0; offset + frameSize <= bytes.length; offset += frameSize) {
      const next = validateFrame(bytes, offset, this.header, this.rolling);
      if (!next) {
        this.stopped = true;
        return;
      }
      this.rolling = next;
      this.frames.push({ bytes, offset, page: bytes.readUInt32BE(offset) });
      const pages = bytes.readUInt32BE(offset + 4);
      if (pages > 0) {
        this.committedFrames = this.frames.length;
        this.committedEnd = fileOffset + offset + frameSize;
        this.committedChecksum = next;
        this.committedPages = pages;
      }
    }
  }

  result(): WalScan {
    return {
      frames: this.frames.slice(0, this.committedFrames),
      committedEnd: this.committedEnd,
      checksum: this.committedChecksum,
      committedPages: this.committedPages,
    };
  }
}

async function scanWal(
  handle: fs.promises.FileHandle,
  walSize: number,
  header: WalHeader,
  start: number,
  seed: Checksum,
  counter: ReadCounter,
): Promise<WalScan> {
  const frameSize = header.pageSize + FRAME_HEADER_BYTES;
  const chunkBytes = Math.max(1, Math.floor(WAL_CHUNK_BYTES / frameSize)) * frameSize;
  const scanner = new WalScanner(header, start, seed);
  for (let offset = start; !scanner.stopped && offset + frameSize <= walSize; offset += chunkBytes) {
    const wanted = Math.min(chunkBytes, Math.floor((walSize - offset) / frameSize) * frameSize);
    const bytes = await readAt(handle, offset, wanted, counter);
    scanner.scan(bytes, offset);
    if (bytes.length < wanted) break;
  }
  return scanner.result();
}

function committedByteLength(scan: WalScan, header: WalHeader, mainSize: number): number {
  const byteLength = scan.committedPages * header.pageSize;
  if (byteLength > mainSize + scan.committedEnd - WAL_HEADER_BYTES) throw new Error("Invalid SQLite WAL database size");
  return byteLength;
}

function applyFrames(target: Buffer, scan: WalScan, pageSize: number): void {
  for (const frame of scan.frames) {
    if (frame.page > scan.committedPages) continue;
    const data = frame.offset + FRAME_HEADER_BYTES;
    frame.bytes.copy(target, (frame.page - 1) * pageSize, data, data + pageSize);
  }
}

/** Marks the image as a rollback-journal database so sql.js never looks for WAL or SHM files. */
function normalizeHeader(image: Buffer, byteLength: number, committedPages: number): void {
  if (byteLength < DATABASE_HEADER_BYTES) return;
  image[18] = 1;
  image[19] = 1;
  if (committedPages > 0) {
    image.writeUInt32BE(committedPages, 28);
    image.writeUInt32BE(image.readUInt32BE(24), 92);
  }
}

export function applyWal(main: Buffer, wal: Buffer): Buffer {
  if (wal.length < WAL_HEADER_BYTES || main.length < DATABASE_HEADER_BYTES) throw new Error("Incomplete SQLite snapshot header");
  const header = parseWalHeader(wal, databasePageSize(main));
  const scanner = new WalScanner(header, WAL_HEADER_BYTES, header.checksum);
  scanner.scan(wal.subarray(WAL_HEADER_BYTES), WAL_HEADER_BYTES);
  const scan = scanner.result();
  if (scan.committedPages === 0) return main;

  const byteLength = committedByteLength(scan, header, main.length);
  let snapshot: Buffer;
  if (byteLength > main.length) {
    snapshot = Buffer.alloc(byteLength);
    main.copy(snapshot);
  } else {
    snapshot = main.subarray(0, byteLength);
  }
  applyFrames(snapshot, scan, header.pageSize);
  normalizeHeader(snapshot, byteLength, scan.committedPages);
  return snapshot;
}

/**
 * Keeps a single in-memory image of an SQLite database: the main file plus committed WAL pages.
 * Commits appended to the same WAL generation are applied in place; any other change reloads the
 * image into the same storage, so a refresh never needs a second full copy. Source files are only
 * opened read-only, and their WAL index (SHM) is never touched.
 */
export class IncrementalSqliteSnapshot {
  private readonly dbPath: string;
  private storage: Buffer | undefined;
  private length = 0;
  /** Bytes beyond `length` but below this mark may hold stale data and must be cleared before reuse. */
  private writtenEnd = 0;
  private state: SnapshotState | undefined;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  get capacity(): number {
    return this.storage?.length ?? 0;
  }

  /** `beforeMutate` runs right before the storage changes; the previous image must no longer be used. */
  async refresh(beforeMutate: () => void): Promise<SnapshotRefresh> {
    const started = performance.now();
    for (let attempt = 1; ; attempt++) {
      try {
        const outcome = await this.refreshOnce(beforeMutate);
        return { ...outcome, durationMs: performance.now() - started };
      } catch (error) {
        if (!(error instanceof SnapshotChangedError) || attempt >= MAX_ATTEMPTS) throw error;
      }
    }
  }

  release(): void {
    this.storage = undefined;
    this.length = 0;
    this.writtenEnd = 0;
    this.state = undefined;
  }

  private image(): Buffer {
    return (this.storage ?? Buffer.alloc(0)).subarray(0, this.length);
  }

  private async refreshOnce(beforeMutate: () => void): Promise<RefreshOutcome> {
    const main = await fs.promises.open(this.dbPath, "r");
    let wal: fs.promises.FileHandle | undefined;
    try {
      wal = await openWal(this.dbPath);
      const mainBefore = await main.stat({ bigint: true });
      const walBefore = await wal?.stat({ bigint: true });
      const fingerprint = `${fileVersion(mainBefore)}|${walVersion(walBefore)}`;
      if (this.storage && this.state?.fingerprint === fingerprint) {
        return { changed: false, mode: "unchanged", data: this.image(), bytesRead: 0 };
      }
      const source: Source = { main, wal, mainBefore, walBefore, fingerprint, bytesRead: 0 };
      try {
        return (await this.applyCommittedFrames(source, beforeMutate)) ?? (await this.reload(source, beforeMutate));
      } catch (error) {
        if (!(error instanceof SnapshotChangedError)) await this.verifyUnchanged(source);
        throw error;
      }
    } finally {
      await wal?.close();
      await main.close();
    }
  }

  /** Applies commits appended to the current WAL generation, or returns undefined if a reload is needed. */
  private async applyCommittedFrames(source: Source, beforeMutate: () => void): Promise<RefreshOutcome | undefined> {
    const previous = this.state;
    const storage = this.storage;
    const { wal, walBefore } = source;
    if (!previous?.wal || !storage || !wal || !walBefore || previous.mainIdentity !== fileIdentity(source.mainBefore)) {
      return undefined;
    }
    const walSize = Number(walBefore.size);
    if (walSize < previous.wal.committedEnd) return undefined;
    const header = tryParseWalHeader(await readAt(wal, 0, WAL_HEADER_BYTES, source), previous.wal.pageSize);
    if (!header
      || header.salt1 !== previous.wal.salt1
      || header.salt2 !== previous.wal.salt2
      || header.checkpointSequence !== previous.wal.checkpointSequence
      || header.littleEndian !== previous.wal.littleEndian) {
      return undefined;
    }

    // Checkpoints within a generation only copy pages that the WAL still overrides, and frames are
    // checksummed, so a concurrent append or reset can only end this scan early.
    const scan = await scanWal(wal, walSize, header, previous.wal.committedEnd, previous.wal.checksum, source);
    if (scan.frames.length === 0) {
      this.state = { ...previous, fingerprint: source.fingerprint };
      return { changed: false, mode: "incremental", data: this.image(), bytesRead: source.bytesRead };
    }
    const byteLength = scan.committedPages * header.pageSize;
    if (byteLength > storage.length) return undefined;

    beforeMutate();
    applyFrames(storage, scan, header.pageSize);
    if (byteLength < this.length) storage.fill(0, byteLength, this.length);
    this.length = byteLength;
    this.writtenEnd = Math.max(this.writtenEnd, byteLength);
    normalizeHeader(storage, byteLength, scan.committedPages);
    this.state = {
      ...previous,
      fingerprint: source.fingerprint,
      wal: { ...previous.wal, committedEnd: scan.committedEnd, checksum: scan.checksum, committedPages: scan.committedPages },
    };
    return { changed: true, mode: "incremental", data: this.image(), bytesRead: source.bytesRead };
  }

  /** Rebuilds the image from the main file and the current WAL generation inside the existing storage. */
  private async reload(source: Source, beforeMutate: () => void): Promise<RefreshOutcome> {
    beforeMutate();
    this.state = undefined;
    this.length = 0;
    const { main, wal, mainBefore, walBefore } = source;
    const mainSize = Number(mainBefore.size);
    const walSize = walBefore ? Number(walBefore.size) : 0;
    let header: WalHeader | undefined;
    let scan: WalScan | undefined;
    if (wal && walSize > 0) {
      const databaseHeader = await readAt(main, 0, DATABASE_HEADER_BYTES, source);
      const walHeader = await readAt(wal, 0, WAL_HEADER_BYTES, source);
      if (walHeader.length < WAL_HEADER_BYTES || databaseHeader.length < DATABASE_HEADER_BYTES) {
        throw new Error("Incomplete SQLite snapshot header");
      }
      header = parseWalHeader(walHeader, databasePageSize(databaseHeader));
      scan = await scanWal(wal, walSize, header, WAL_HEADER_BYTES, header.checksum, source);
    }
    const committedPages = scan?.committedPages ?? 0;
    const byteLength = scan && header && committedPages > 0 ? committedByteLength(scan, header, mainSize) : mainSize;

    const storage = this.reserve(byteLength);
    const mainBytes = Math.min(mainSize, byteLength);
    const clearEnd = Math.max(byteLength, this.writtenEnd);
    this.writtenEnd = clearEnd;
    await readInto(main, storage, mainBytes, source);
    storage.fill(0, mainBytes, clearEnd);
    if (scan && header) applyFrames(storage, scan, header.pageSize);
    normalizeHeader(storage, byteLength, committedPages);
    await this.verifyUnchanged(source);

    this.length = byteLength;
    this.state = {
      fingerprint: source.fingerprint,
      mainIdentity: fileIdentity(mainBefore),
      wal: header && scan
        ? {
          littleEndian: header.littleEndian,
          pageSize: header.pageSize,
          checkpointSequence: header.checkpointSequence,
          salt1: header.salt1,
          salt2: header.salt2,
          committedEnd: scan.committedEnd,
          checksum: scan.checksum,
          committedPages,
        }
        : undefined,
    };
    return { changed: true, mode: "full", data: this.image(), bytesRead: source.bytesRead };
  }

  private reserve(byteLength: number): Buffer {
    if (this.storage && this.storage.length >= byteLength) return this.storage;
    // Release the old allocation first so it can be collected while the larger one fills.
    this.storage = undefined;
    this.writtenEnd = 0;
    this.storage = Buffer.alloc(Math.ceil((byteLength * STORAGE_HEADROOM) / STORAGE_ALIGNMENT) * STORAGE_ALIGNMENT);
    return this.storage;
  }

  private async verifyUnchanged(source: Source): Promise<void> {
    const mainAfter = await source.main.stat({ bigint: true });
    const walAfter = await source.wal?.stat({ bigint: true });
    const currentMain = await statIfExists(this.dbPath);
    const currentWal = await statIfExists(`${this.dbPath}-wal`);
    const mainVersion = fileVersion(source.mainBefore);
    const walBeforeVersion = walVersion(source.walBefore);
    if (mainVersion !== fileVersion(mainAfter)
      || !currentMain
      || mainVersion !== fileVersion(currentMain)
      || walBeforeVersion !== walVersion(walAfter)
      || walBeforeVersion !== walVersion(currentWal)) {
      throw new SnapshotChangedError("Traces database changed while reading its snapshot");
    }
  }
}