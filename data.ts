import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const FILE = join(DATA_DIR, "config.json");

export interface BotConfig {
  maintenanceMode: boolean;
  maintenanceMessage: string;
  antilink: boolean;
  antispam: boolean;
  antiraid: boolean;
  antiraidThreshold: number;
  antispamThreshold: number;
  antispamInterval: number;
}

const DEFAULTS: BotConfig = {
  maintenanceMode: false,
  maintenanceMessage: "Le bot est actuellement en maintenance. Réessayez plus tard.",
  antilink: false,
  antispam: false,
  antiraid: false,
  antiraidThreshold: 5,
  antispamThreshold: 5,
  antispamInterval: 5000,
};

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

export function getConfig(): BotConfig {
  ensureDir();
  if (!existsSync(FILE)) return { ...DEFAULTS };
  try { return { ...DEFAULTS, ...JSON.parse(readFileSync(FILE, "utf-8")) }; } catch { return { ...DEFAULTS }; }
}

export function saveConfig(config: BotConfig): void {
  ensureDir();
  writeFileSync(FILE, JSON.stringify(config, null, 2), "utf-8");
}

export function updateConfig(patch: Partial<BotConfig>): BotConfig {
  const config = { ...getConfig(), ...patch };
  saveConfig(config);
  return config;
}
