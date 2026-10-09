import * as fs from "node:fs";

export interface SqliteSnapshot {
  fingerprint: string;
  data?: Buffer;
}

class SnapshotChangedError extends Error {}

function fileVersion(stat: fs.BigIntStats): string {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs ?? stat.mtimeMs}:${stat.ctimeNs ?? stat.ctimeMs}`;
}

async function openWal(dbPath: string): Promise<fs.promises.FileHandle | undefined> {
  try {
    return await fs.promises.open(`${dbPath}-wal`, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function readSnapshot(dbPath: string, previousFingerprint?: string): Promise<SqliteSnapshot> {
  const main = await fs.promises.open(dbPath, "r");
  let wal: fs.promises.FileHandle | undefined;
  try {
    wal = await openWal(dbPath);
    const mainBefore = await main.stat({ bigint: true });
    const walBefore = await wal?.stat({ bigint: true });
    const fingerprint = `${fileVersion(mainBefore)}|${walBefore ? fileVersion(walBefore) : "no-wal"}`;
    if (fingerprint === previousFingerprint) return { fingerprint };

    const mainData = await main.readFile();
    const walData = await wal?.readFile();
    const mainAfter = await main.stat({ bigint: true });
    const walAfter = await wal?.stat({ bigint: true });
    const currentMain = await fs.promises.stat(dbPath, { bigint: true });
    let currentWal: fs.BigIntStats | undefined;
    try {
      currentWal = await fs.promises.stat(`${dbPath}-wal`, { bigint: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (fileVersion(mainBefore) !== fileVersion(mainAfter)
      || fileVersion(mainBefore) !== fileVersion(currentMain)
      || (walBefore ? fileVersion(walBefore) : "no-wal") !== (walAfter ? fileVersion(walAfter) : "no-wal")
      || (walBefore ? fileVersion(walBefore) : "no-wal") !== (currentWal ? fileVersion(currentWal) : "no-wal")) {
      throw new SnapshotChangedError("Traces database changed while reading its snapshot");
    }
    return { fingerprint, data: walData?.length ? applyWal(mainData, walData) : mainData };
  } finally {
    await wal?.close();
    await main.close();
  }
}

export async function readSqliteSnapshot(dbPath: string, previousFingerprint?: string, attempt: number = 0): Promise<SqliteSnapshot> {
  try {
    return await readSnapshot(dbPath, previousFingerprint);
  } catch (error) {
    if (error instanceof SnapshotChangedError && attempt < 2) {
      return readSqliteSnapshot(dbPath, previousFingerprint, attempt + 1);
    }
    throw error;
  }
}

function checksum(bytes: Buffer, start: number, end: number, littleEndian: boolean, seed: [number, number]): [number, number] {
  let [first, second] = seed;
  for (let offset = start; offset < end; offset += 8) {
    const firstWord = littleEndian ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
    const secondWord = littleEndian ? bytes.readUInt32LE(offset + 4) : bytes.readUInt32BE(offset + 4);
    first = (first + firstWord + second) >>> 0;
    second = (second + secondWord + first) >>> 0;
  }
  return [first, second];
}

export function applyWal(main: Buffer, wal: Buffer): Buffer {
  if (wal.length < 32 || main.length < 100) throw new Error("Incomplete SQLite snapshot header");
  const magic = wal.readUInt32BE(0);
  if ((magic !== 0x377f0682 && magic !== 0x377f0683) || wal.readUInt32BE(4) !== 3007000) {
    throw new Error("Unsupported SQLite WAL header");
  }
  const pageSize = wal.readUInt32BE(8);
  const mainPageSize = main.readUInt16BE(16) === 1 ? 65536 : main.readUInt16BE(16);
  if (pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1)) !== 0 || pageSize !== mainPageSize) {
    throw new Error("SQLite WAL page size does not match its database");
  }
  const littleEndian = magic === 0x377f0682;
  let rolling = checksum(wal, 0, 24, littleEndian, [0, 0]);
  if (rolling[0] !== wal.readUInt32BE(24) || rolling[1] !== wal.readUInt32BE(28)) {
    throw new Error("Invalid SQLite WAL header checksum");
  }
  const frameSize = pageSize + 24;
  let committedEnd = 32;
  let committedPages = 0;
  for (let offset = 32; offset + frameSize <= wal.length; offset += frameSize) {
    if (wal.readUInt32BE(offset) === 0
      || wal.readUInt32BE(offset + 8) !== wal.readUInt32BE(16)
      || wal.readUInt32BE(offset + 12) !== wal.readUInt32BE(20)) break;
    rolling = checksum(wal, offset, offset + 8, littleEndian, rolling);
    rolling = checksum(wal, offset + 24, offset + frameSize, littleEndian, rolling);
    if (rolling[0] !== wal.readUInt32BE(offset + 16) || rolling[1] !== wal.readUInt32BE(offset + 20)) break;
    const pages = wal.readUInt32BE(offset + 4);
    if (pages > 0) {
      committedEnd = offset + frameSize;
      committedPages = pages;
    }
  }
  if (committedPages === 0) return main;

  const byteLength = committedPages * pageSize;
  if (byteLength > main.length + committedEnd - 32) throw new Error("Invalid SQLite WAL database size");
  const snapshot = byteLength > main.length ? Buffer.alloc(byteLength) : main.subarray(0, byteLength);
  if (snapshot !== main && byteLength > main.length) main.copy(snapshot);
  for (let offset = 32; offset < committedEnd; offset += frameSize) {
    const page = wal.readUInt32BE(offset);
    if (page <= committedPages) {
      wal.copy(snapshot, (page - 1) * pageSize, offset + 24, offset + frameSize);
    }
  }
  snapshot[18] = 1;
  snapshot[19] = 1;
  snapshot.writeUInt32BE(committedPages, 28);
  snapshot.writeUInt32BE(snapshot.readUInt32BE(24), 92);
  return snapshot;
}