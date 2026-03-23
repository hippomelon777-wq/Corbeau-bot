import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { Guild } from "discord.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const BACKUP_DIR = join(__dirname, "..", "backups");

export interface BackupData {
  id: string;
  createdAt: string;
  createdBy: string;
  guildId: string;
  guildName: string;
  blacklist: unknown;
  warnings: unknown;
  whitelist: unknown;
  owners: unknown;
  config: unknown;
  ranks: unknown;
}

function ensureDirs(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });
}

function readJsonSafe(path: string): unknown {
  if (!existsSync(path)) return [];
  try { return JSON.parse(readFileSync(path, "utf-8")); } catch { return []; }
}

export function createBackup(guild: Guild, createdBy: string): BackupData {
  ensureDirs();
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const backup: BackupData = {
    id,
    createdAt: new Date().toISOString(),
    createdBy,
    guildId: guild.id,
    guildName: guild.name,
    blacklist: readJsonSafe(join(DATA_DIR, "blacklist.json")),
    warnings: readJsonSafe(join(DATA_DIR, "warnings.json")),
    whitelist: readJsonSafe(join(DATA_DIR, "whitelist.json")),
    owners: readJsonSafe(join(DATA_DIR, "owners.json")),
    config: readJsonSafe(join(DATA_DIR, "config.json")),
    ranks: readJsonSafe(join(DATA_DIR, "ranks.json")),
  };
  writeFileSync(join(BACKUP_DIR, `backup_${id}.json`), JSON.stringify(backup, null, 2), "utf-8");
  return backup;
}

export function listBackups(): BackupData[] {
  ensureDirs();
  return readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith("backup_") && f.endsWith(".json"))
    .map(f => {
      try { return JSON.parse(readFileSync(join(BACKUP_DIR, f), "utf-8")) as BackupData; } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b!.createdAt).getTime() - new Date(a!.createdAt).getTime()) as BackupData[];
}

export function loadBackup(backupId: string): boolean {
  ensureDirs();
  const file = join(BACKUP_DIR, `backup_${backupId}.json`);
  if (!existsSync(file)) return false;
  try {
    const backup = JSON.parse(readFileSync(file, "utf-8")) as BackupData;
    writeFileSync(join(DATA_DIR, "blacklist.json"), JSON.stringify(backup.blacklist, null, 2), "utf-8");
    writeFileSync(join(DATA_DIR, "warnings.json"), JSON.stringify(backup.warnings, null, 2), "utf-8");
    writeFileSync(join(DATA_DIR, "whitelist.json"), JSON.stringify(backup.whitelist, null, 2), "utf-8");
    writeFileSync(join(DATA_DIR, "owners.json"), JSON.stringify(backup.owners, null, 2), "utf-8");
    writeFileSync(join(DATA_DIR, "config.json"), JSON.stringify(backup.config, null, 2), "utf-8");
    if (backup.ranks) writeFileSync(join(DATA_DIR, "ranks.json"), JSON.stringify(backup.ranks, null, 2), "utf-8");
    return true;
  } catch { return false; }
}
