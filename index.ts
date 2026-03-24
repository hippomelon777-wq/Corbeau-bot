import {
  Client, GatewayIntentBits, Partials, EmbedBuilder,
  ButtonBuilder, ButtonStyle, ActionRowBuilder,
  TextChannel, ChannelType, Events,
  type Interaction, type Guild, type GuildMember, type Message,
  Collection,
} from "discord.js";

import { isBlacklisted, addToBlacklist, removeFromBlacklist, getBlacklist } from "./blacklist.js";
import { getWarnings, addWarning, removeWarning, clearWarnings, generateWarnId } from "./warnings.js";
import { getWhitelist, isWhitelisted, addToWhitelist, removeFromWhitelist } from "./whitelist.js";
import { getOwners, isOwner, addOwner, removeOwner } from "./owners.js";
import { getConfig, updateConfig } from "./data.js";
import { handleAntiSpam, handleAntiRaid, disableRaidLockdown, isRaidLockdown } from "./antispam.js";
import { createBackup, listBackups, loadBackup } from "./backup.js";
import {
  getEmbed, getAllEmbeds, createEmbed, updateEmbed, deleteEmbed,
  getTicket, getAllTickets, createTicket, updateTicket, deleteTicket,
  type SavedEmbed, type EmbedPage,
} from "./embedsdb.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const TOKEN = process.env["DISCORD_BOT_TOKEN"];
if (!TOKEN) throw new Error("DISCORD_BOT_TOKEN environment variable is required.");
const PREFIX = "+";

// ══════════════════════════════════════════════════════════════════════════════
// CONFIG DYNAMIQUE
// ══════════════════════════════════════════════════════════════════════════════
interface RolesConfig { perm1?: string; perm2?: string; perm3?: string; perm4?: string; perm5?: string; perm6?: string; }
interface LogsConfig {
  logs?: string; "tickets-deban"?: string; roles?: string; bl?: string;
  "bans-deban"?: string; "mute-unmute"?: string; messages?: string; "proposition-stream"?: string;
  "joins-leaves"?: string; "role-changes"?: string;
}
type PermCmdMap = Record<string, number>; // cmd -> perm level requis

interface ServerConfig { roles: RolesConfig; logs: LogsConfig; permcmds: PermCmdMap; }

// Permissions par défaut des commandes
const DEFAULT_PERM_CMDS: PermCmdMap = {
  "warn": 1, "unwarn": 1, "warnlist": 1, "mute": 1, "tempmute": 1, "unmute": 1,
  "kick": 2, "ban": 2, "unban": 2, "banlist": 2,
  "clear": 3, "rank": 3, "derank": 3, "slowmode": 3,
  "lock": 4, "unlock": 4, "renew": 4, "bl": 4, "unbl": 4, "blcheck": 4,
  "wl": 4, "backup": 4, "maintenance": 4, "lockdown": 4, "unlockdown": 4,
  "massban": 4, "clearinvites": 4,
  "createembed": 4, "embed": 4, "modifembed": 4, "deleteembed": 4, "listembeds": 4,
  "createticket": 4, "ticket": 4, "modifticket": 4, "deleteticket": 4, "listtickets": 4,
  "antilink": 6, "antispam": 6, "antiraid": 6, "antiraid-reset": 6,
  "antiaddbot": 6, "antimentionspam": 6,
  "setrole": 6, "setlog": 6, "config": 6, "logs": 6, "addlogs": 6, "deletelogs": 6, "modiflogs": 6,
  "owner": 6,
};

function getCmdPerm(cmd: string): number {
  const cfg = getServerConfig();
  const map = { ...DEFAULT_PERM_CMDS, ...(cfg.permcmds ?? {}) };
  return map[cmd] ?? 0;
}

const LOG_TYPES: (keyof LogsConfig)[] = ["logs","tickets-deban","roles","bl","bans-deban","mute-unmute","messages","proposition-stream","joins-leaves","role-changes"];
const LOG_LABELS: Record<string, string> = {
  "logs": "📋 Logs général", "tickets-deban": "🎫 Tickets déban", "roles": "🏷️ Logs rôles",
  "bl": "🚫 Logs blacklist", "bans-deban": "🔨 Logs bans/débans",
  "mute-unmute": "🔇 Logs mute/warn", "messages": "💬 Logs messages", "proposition-stream": "📺 Logs propositions",
  "joins-leaves": "🚪 Logs entrées/sorties", "role-changes": "🏷️ Logs changements de rôles",
};

const SERVER_CONFIG_FILE = join(DATA_DIR, "server-config.json");
function ensureDataDir(): void { if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true }); }
function getServerConfig(): ServerConfig {
  ensureDataDir();
  if (!existsSync(SERVER_CONFIG_FILE)) return { roles: {}, logs: {}, permcmds: {} };
  try { const d = JSON.parse(readFileSync(SERVER_CONFIG_FILE, "utf-8")) as ServerConfig; return { roles: d.roles ?? {}, logs: d.logs ?? {}, permcmds: d.permcmds ?? {} }; } catch { return { roles: {}, logs: {}, permcmds: {} }; }
}
function saveServerConfig(cfg: ServerConfig): void {
  ensureDataDir();
  writeFileSync(SERVER_CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf-8");
}

// ══════════════════════════════════════════════════════════════════════════════
// PERMISSIONS
// ══════════════════════════════════════════════════════════════════════════════
async function getPermLevel(guild: Guild, userId: string): Promise<number> {
  if (isOwner(userId)) return 6;
  const member = guild.members.cache.get(userId) ?? await guild.members.fetch(userId).catch(() => null);
  if (!member) return 0;
  const cfg = getServerConfig();
  let level = 0;
  for (const [roleId, lvl] of [[cfg.roles.perm1,1],[cfg.roles.perm2,2],[cfg.roles.perm3,3],[cfg.roles.perm4,4],[cfg.roles.perm5,5],[cfg.roles.perm6,6]] as [string|undefined,number][]) {
    if (roleId && member.roles.cache.has(roleId)) level = Math.max(level, lvl);
  }
  return level;
}

// ══════════════════════════════════════════════════════════════════════════════
// EMBED HELPERS
// ══════════════════════════════════════════════════════════════════════════════
const COLOR = { red:0xe74c3c, green:0x2ecc71, blue:0x5865f2, orange:0xe67e22, yellow:0xf1c40f, purple:0x9b59b6, dark:0x2c2f33, grey:0x95a5a6, darkred:0x8b0000 };
const errEmbed    = (d: string) => new EmbedBuilder().setColor(COLOR.red).setDescription(`❌ ${d}`).setTimestamp();
const okEmbed     = (t: string, d: string) => new EmbedBuilder().setColor(COLOR.green).setTitle(t).setDescription(d).setTimestamp();
const successEmbed = (m = "Commande effectuée avec succès.") => new EmbedBuilder().setColor(COLOR.green).setDescription(`✅ ${m}`).setTimestamp();
const infoEmbed   = (t: string, d: string) => new EmbedBuilder().setColor(COLOR.blue).setTitle(t).setDescription(d).setTimestamp();
const askEmbed    = (q: string) => new EmbedBuilder().setColor(COLOR.purple).setDescription(`💬 ${q}`).setTimestamp();

async function sendLog(guild: Guild, logKey: keyof LogsConfig, embed: EmbedBuilder): Promise<void> {
  const channelId = getServerConfig().logs[logKey];
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId);
  if (channel instanceof TextChannel) await channel.send({ embeds: [embed] }).catch(() => null);
}

// Vérifie si un membre est perm 6 (paix) via son rôle
async function hasPerm6Role(guild: Guild, userId: string): Promise<boolean> {
  const cfg = getServerConfig();
  if (!cfg.roles.perm6) return false;
  const member = guild.members.cache.get(userId) ?? await guild.members.fetch(userId).catch(() => null);
  return member?.roles.cache.has(cfg.roles.perm6) ?? false;
}

// Whitelist étendue : perm 6 (paix) = automatiquement whitelisté
async function isEffectivelyWhitelisted(guild: Guild, userId: string): Promise<boolean> {
  return isWhitelisted(userId) || isOwner(userId) || await hasPerm6Role(guild, userId);
}

function hexToInt(hex: string): number { return parseInt(hex.replace("#",""), 16) || COLOR.blue; }

// ══════════════════════════════════════════════════════════════════════════════
// SESSIONS — création pas à pas d'embeds et tickets
// ══════════════════════════════════════════════════════════════════════════════
type EmbedStep = "titre_page" | "texte_page" | "image_page" | "autre_page" | "date" | "signature" | "couleur" | "bouton_role" | "label_bouton_role" | "done";
type TicketStep = "description" | "bouton" | "couleur" | "done";

interface EmbedSession {
  type: "embed";
  userId: string;
  channelId: string;
  titre: string;           // titre du embed (identifiant)
  pages: EmbedPage[];
  currentPage: EmbedPage;
  afficherDate?: boolean;
  signature?: string;
  couleur?: string;
  step: EmbedStep;
  editing: boolean;        // true = modification, false = création
  roleId?: string;         // ID du rôle à donner via bouton
  roleBoutonLabel?: string; // label du bouton de rôle
}

interface TicketSession {
  type: "ticket";
  userId: string;
  channelId: string;
  titre: string;
  description?: string;
  bouton?: string;
  couleur?: string;
  step: TicketStep;
  editing: boolean;
}

const sessions = new Map<string, EmbedSession | TicketSession>();

function sessionKey(userId: string, channelId: string): string { return `${userId}:${channelId}`; }

// Construire l'embed final depuis une session
function buildFinalEmbed(s: EmbedSession, pageIndex = 0): EmbedBuilder {
  const page = s.pages[pageIndex] ?? s.pages[0]!;
  const color = hexToInt(s.couleur ?? "#5865f2");
  const e = new EmbedBuilder().setColor(color).setTitle(page.titre).setDescription(page.texte);
  if (page.image) e.setImage(page.image);
  if (s.afficherDate) e.setTimestamp();
  if (s.signature) e.setFooter({ text: s.signature });
  if (s.pages.length > 1) e.setFooter({ text: `${s.signature ? s.signature + " • " : ""}Page ${pageIndex+1}/${s.pages.length}` });
  return e;
}

// ══════════════════════════════════════════════════════════════════════════════
// HELP PAGES
// ══════════════════════════════════════════════════════════════════════════════
function helpNavRow(currentPage: number, totalPages: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`help_prev_${currentPage}`).setLabel("◀ Précédent").setStyle(ButtonStyle.Secondary).setDisabled(currentPage === 0),
    new ButtonBuilder().setCustomId("help_page_info").setLabel(`${currentPage+1} / ${totalPages}`).setStyle(ButtonStyle.Primary).setDisabled(true),
    new ButtonBuilder().setCustomId(`help_next_${currentPage}`).setLabel("Suivant ▶").setStyle(ButtonStyle.Secondary).setDisabled(currentPage === totalPages - 1),
  );
}

function buildHelpPages(): EmbedBuilder[] {
  const footer = { text: "Corbeaux Bot • Préfixe : +  |  Boutons pour naviguer" };

  const p1 = new EmbedBuilder().setColor(COLOR.red).setTitle("⚠️ Aide (1/6) · Sanctions & Modération")
    .setDescription("Commandes de sanction et de modération des membres.")
    .addFields(
      { name: "+warn @membre [raison]", value: "Donner un avertissement.", inline: false },
      { name: "+unwarn @membre [id]", value: "Retirer un warn. Sans ID = tout supprimer.", inline: false },
      { name: "+warnlist @membre", value: "Voir les avertissements d'un membre.", inline: false },
      { name: "+mute @membre [raison]", value: "Muter un membre de façon permanente (jusqu'à +unmute).", inline: false },
      { name: "+tempmute @membre <durée> <s|m|h|j> [raison]", value: "Muter temporairement. Ex : `+tempmute @user 10 m Spam`", inline: false },
      { name: "+unmute @membre", value: "Retirer le mute d'un membre.", inline: false },
      { name: "+kick @membre [raison]", value: "Expulser un membre.", inline: false },
      { name: "+ban @membre [raison]", value: "Bannir un membre.", inline: false },
      { name: "+unban <id> [raison]", value: "Débannir par ID.", inline: false },
      { name: "+banlist", value: "Voir la liste des bans actifs.", inline: false },
      { name: "+clear <nombre> [@membre]", value: "Supprimer 1 à 100 messages.", inline: false },
      { name: "+rank @membre @rôle", value: "Donner un rôle de grade à un membre.", inline: false },
      { name: "+derank @membre @rôle", value: "Retirer un rôle de grade à un membre.", inline: false },
    ).setFooter(footer);

  const p2 = new EmbedBuilder().setColor(COLOR.blue).setTitle("🔒 Aide (2/6) · Administration")
    .setDescription("Commandes de gestion du serveur.")
    .addFields(
      { name: "+lock [#salon] [raison]", value: "Verrouiller un salon.", inline: false },
      { name: "+unlock [#salon]", value: "Déverrouiller un salon.", inline: false },
      { name: "+renew [raison]", value: "Recréer le salon actuel à l'identique.", inline: false },
      { name: "+bl @membre [raison]", value: "Blacklister + bannir. Auto-ban s'il revient.", inline: false },
      { name: "+unbl <id>", value: "Retirer de la blacklist.", inline: false },
      { name: "+blcheck", value: "Voir la blacklist.", inline: false },
      { name: "+wl add @personne", value: "Ajouter à la whitelist (bypass anti-link/spam).", inline: false },
      { name: "+wl remove @personne  |  +wl check", value: "Retirer / voir la whitelist.", inline: false },
      { name: "+backup create|list|load [id]", value: "Gérer les sauvegardes.", inline: false },
      { name: "+maintenance on|off [message]", value: "Activer/désactiver le mode maintenance.", inline: false },
    ).setFooter(footer);

  const p3 = new EmbedBuilder().setColor(COLOR.darkred).setTitle("🛡️ Aide (3/6) · Sécurité")
    .setDescription("Systèmes de protection automatique du serveur.")
    .addFields(
      { name: "+antilink on|off", value: "Supprimer automatiquement les liens.", inline: false },
      { name: "+antispam on|off [seuil] [intervalle]", value: "Muter automatiquement les spammeurs.\nEx : `+antispam on 5 3`", inline: false },
      { name: "+antiraid on|off [seuil]", value: "Lockdown auto si trop de joins en 10s.", inline: false },
      { name: "+antiraid-reset", value: "Désactiver manuellement le lockdown anti-raid.", inline: false },
      { name: "+antiaddbot on|off", value: "Empêcher l'ajout de bots (seuls owners et whitelist peuvent en ajouter).", inline: false },
      { name: "+antimentionspam on|off [seuil]", value: "Muter auto les mass-mentions.\nEx : `+antimentionspam on 5`", inline: false },
      { name: "+slowmode [#salon] <secondes>", value: "Activer un slowmode. `0` pour désactiver.", inline: false },
      { name: "+lockdown [raison]", value: "Verrouiller TOUS les salons d'urgence.", inline: false },
      { name: "+unlockdown", value: "Déverrouiller tous les salons.", inline: false },
      { name: "+massban <id1> <id2> ... [raison]", value: "Bannir plusieurs personnes d'un coup par ID.", inline: false },
      { name: "+clearinvites", value: "Supprimer toutes les invitations du serveur.", inline: false },
    ).setFooter(footer);

  const p4 = new EmbedBuilder().setColor(COLOR.dark).setTitle("⚙️ Aide (4/6) · Configuration")
    .setDescription("Commandes pour configurer le bot.")
    .addFields(
      { name: "+setrole <1-6> @rôle", value: "Associer un rôle à un niveau (1=Helpeur, 2=Modo, 3=Chef Modo, 4=Responsable, 5=Co Owner, 6=Paix).\nEx : `+setrole 2 @Modo`", inline: false },
      { name: "+perm", value: "Voir les rôles associés à chaque niveau.", inline: false },
      { name: "+permission", value: "Voir le récapitulatif complet : qui a quel rôle et quelles commandes.", inline: false },
      { name: "+setpermcmd <commande> <niveau>", value: "Modifier le niveau de perm requis pour une commande.\nEx : `+setpermcmd warn 2`", inline: false },
      { name: "+resetpermcmd <commande>", value: "Remettre une commande à sa permission par défaut.", inline: false },
      { name: "+config", value: "Voir la configuration complète.", inline: false },
      { name: "+owner add @personne", value: "Ajouter un owner (perm 5 permanente).", inline: false },
      { name: "+owner remove @personne  |  +owner list", value: "Retirer / lister les owners.", inline: false },
    ).setFooter(footer);

  const p5 = new EmbedBuilder().setColor(COLOR.purple).setTitle("📋 Aide (5/6) · Embeds & Tickets")
    .setDescription("Créer et gérer des embeds et panels de tickets sauvegardés.")
    .addFields(
      { name: "+createembed [titre]", value: "Créer un embed pas à pas (titre, texte, image, date, signature, couleur, plusieurs pages).", inline: false },
      { name: "+embed [titre]", value: "Poster un embed sauvegardé dans le salon.", inline: false },
      { name: "+modifembed [titre]", value: "Modifier un embed existant.", inline: false },
      { name: "+deleteembed [titre]", value: "Supprimer un embed.", inline: false },
      { name: "+listembeds", value: "Voir tous les embeds sauvegardés.", inline: false },
      { name: "\u200b", value: "\u200b", inline: false },
      { name: "+createticket [titre]", value: "Créer un panel ticket pas à pas.", inline: false },
      { name: "+ticket [titre]", value: "Poster un panel ticket dans le salon.", inline: false },
      { name: "+modifticket [titre]", value: "Modifier un ticket existant.", inline: false },
      { name: "+deleteticket [titre]", value: "Supprimer un ticket.", inline: false },
      { name: "+listtickets", value: "Voir tous les tickets sauvegardés.", inline: false },
    ).setFooter(footer);

  const p6 = new EmbedBuilder().setColor(COLOR.orange).setTitle("📝 Aide (6/6) · Salons de logs")
    .setDescription("Commandes pour gérer les salons de logs.")
    .addFields(
      { name: "+logs", value: "Voir tous les salons de logs configurés.", inline: false },
      { name: "+addlogs <type> #salon", value: "Configurer un salon de logs.\nEx : `+addlogs mute-unmute #logs-mute`", inline: false },
      { name: "+deletelogs <type>", value: "Supprimer un salon de logs.", inline: false },
      { name: "+modiflogs <type> #salon", value: "Modifier un salon de logs existant.", inline: false },
      { name: "\u200b", value: "\u200b", inline: false },
      { name: "📋 Types", value: "`logs` · `tickets-deban` · `roles` · `bl` · `bans-deban` · `mute-unmute` · `messages` · `proposition-stream`", inline: false },
    ).setFooter(footer);

  return [p1, p2, p3, p4, p5, p6];
}

// ══════════════════════════════════════════════════════════════════════════════
// CLIENT
// ══════════════════════════════════════════════════════════════════════════════
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildIntegrations],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember],
});

client.once(Events.ClientReady, readyClient => {
  console.log(`✅ Connecté : ${readyClient.user.tag} | Préfixe : ${PREFIX}`);
});

// ══════════════════════════════════════════════════════════════════════════════
// BOUTONS
// ══════════════════════════════════════════════════════════════════════════════
client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  if (!interaction.isButton()) return;
  const { customId } = interaction;

  // Navigation help
  if (customId.startsWith("help_prev_") || customId.startsWith("help_next_")) {
    const pages = buildHelpPages();
    const currentPage = parseInt(customId.split("_").pop()!, 10);
    const newPage = customId.startsWith("help_next_") ? currentPage + 1 : currentPage - 1;
    const safePage = Math.max(0, Math.min(newPage, pages.length - 1));
    await interaction.update({ embeds: [pages[safePage]!], components: [helpNavRow(safePage, pages.length)] });
    return;
  }

  // Ouverture d'un ticket
  if (customId.startsWith("ticket_open_")) {
    if (!interaction.guild) return;
    const titre = decodeURIComponent(customId.replace("ticket_open_", ""));
    const entry = getTicket(titre);
    if (!entry) { await interaction.reply({ content: "❌ Ce ticket n'existe plus.", ephemeral: true }); return; }
    const guild = interaction.guild;
    const existing = guild.channels.cache.find(c => c.name === `ticket-${interaction.user.username}`.toLowerCase());
    if (existing) { await interaction.reply({ content: "❌ Tu as déjà un ticket ouvert.", ephemeral: true }); return; }
    const ticket = await guild.channels.create({
      name: `ticket-${interaction.user.username}`,
      type: ChannelType.GuildText,
      permissionOverwrites: [
        { id: guild.roles.everyone, deny: ["ViewChannel"] },
        { id: interaction.user.id, allow: ["ViewChannel", "SendMessages"] },
      ],
    });
    const cfg = getServerConfig();
    for (const key of ["perm3","perm4","perm5"] as (keyof RolesConfig)[]) {
      const roleId = cfg.roles[key];
      if (roleId) await ticket.permissionOverwrites.create(roleId, { ViewChannel: true, SendMessages: true }).catch(() => null);
    }
    const closeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`ticket_close_${ticket.id}`).setLabel("🔒 Fermer le ticket").setStyle(ButtonStyle.Danger)
    );
    await ticket.send({
      embeds: [new EmbedBuilder().setColor(hexToInt(entry.couleur)).setTitle(`🎫 ${entry.titre}`)
        .setDescription(`Ticket ouvert par ${interaction.user}.\n\nExplique ta demande, le staff reviendra vers toi.`).setTimestamp()],
      components: [closeRow],
    });
    await interaction.reply({ content: `✅ Ton ticket a été créé : ${ticket}`, ephemeral: true });
    return;
  }

  // Toggle rôle via bouton embed
  if (customId.startsWith("toggle_role_")) {
    if (!interaction.guild) return;
    const roleId = customId.replace("toggle_role_", "");
    const role = interaction.guild.roles.cache.get(roleId);
    if (!role) { await interaction.reply({ content: "❌ Rôle introuvable.", ephemeral: true }); return; }
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) return;
    if (member.roles.cache.has(role.id)) {
      await member.roles.remove(role);
      await interaction.reply({ content: `✅ Rôle **${role.name}** retiré.`, ephemeral: true });
    } else {
      await member.roles.add(role);
      await interaction.reply({ content: `✅ Rôle **${role.name}** attribué.`, ephemeral: true });
    }
    return;
  }

  // Fermeture d'un ticket
  if (customId.startsWith("ticket_close_")) {
    if (!interaction.guild) return;
    const permLevel = await getPermLevel(interaction.guild, interaction.user.id);
    const channel = interaction.channel as TextChannel;
    const isOpener = channel.permissionOverwrites.cache.has(interaction.user.id);
    if (permLevel < 3 && !isOpener) {
      await interaction.reply({ content: "❌ Tu n'as pas la permission de fermer ce ticket.", ephemeral: true });
      return;
    }
    await interaction.reply({ content: "🔒 Fermeture dans 5 secondes..." });
    setTimeout(() => channel.delete().catch(() => null), 5000);
    return;
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// AUTO-BAN + ANTI-RAID
// ══════════════════════════════════════════════════════════════════════════════
client.on(Events.GuildMemberAdd, async (member: GuildMember) => {
  if (isBlacklisted(member.id)) { await member.ban({ reason: "Blacklisté — auto-ban" }).catch(() => null); return; }
  await handleAntiRaid(member);
  // Log entrée
  await sendLog(member.guild, "joins-leaves", new EmbedBuilder().setColor(COLOR.green)
    .setTitle("📥 Membre rejoint")
    .setThumbnail(member.user.displayAvatarURL())
    .addFields(
      { name: "Membre", value: `${member.user.tag} (${member.id})`, inline: true },
      { name: "Compte créé", value: `<t:${Math.floor(member.user.createdTimestamp/1000)}:R>`, inline: true },
    ).setTimestamp());
});

client.on(Events.GuildMemberRemove, async (member) => {
  await sendLog((member as GuildMember).guild, "joins-leaves", new EmbedBuilder().setColor(COLOR.red)
    .setTitle("📤 Membre parti")
    .setThumbnail(member.user?.displayAvatarURL() ?? null)
    .addFields({ name: "Membre", value: `${member.user?.tag ?? "Inconnu"} (${member.id})`, inline: true })
    .setTimestamp());
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  const added = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
  const removed = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));
  if (added.size === 0 && removed.size === 0) return;
  const lines: string[] = [];
  added.forEach(r => lines.push(`✅ Ajouté : **${r.name}**`));
  removed.forEach(r => lines.push(`❌ Retiré : **${r.name}**`));
  await sendLog(newMember.guild, "role-changes", new EmbedBuilder().setColor(COLOR.blue)
    .setTitle("🏷️ Changement de rôles")
    .addFields({ name: "Membre", value: `${newMember.user.tag} (${newMember.id})`, inline: true }, { name: "Changements", value: lines.join("\n"), inline: false })
    .setTimestamp());
});

// Anti-add bot : kick les bots ajoutés si antiaddbot est activé
client.on(Events.GuildIntegrationsUpdate, async (guild) => {
  const config = getConfig();
  if (!config.antiaddbot) return;
  // Trouver les bots récemment ajoutés
  const bots = guild.members.cache.filter(m => m.user.bot && m.joinedTimestamp && Date.now() - m.joinedTimestamp < 10000);
  for (const [, bot] of bots) {
    if (isOwner(bot.id) || isWhitelisted(bot.id)) continue; // perm5 handled via owner check
    await bot.kick("Anti-add bot activé").catch(() => null);
    await sendLog(guild, "logs", new EmbedBuilder().setColor(COLOR.red)
      .setTitle("🤖 Bot expulsé — Anti-add bot")
      .addFields({ name: "Bot", value: `${bot.user.tag} (${bot.id})`, inline: true })
      .setTimestamp());
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// MESSAGES — COMMANDES + SESSIONS EMBED/TICKET
// ══════════════════════════════════════════════════════════════════════════════
client.on(Events.MessageCreate, async (message: Message) => {
  if (message.author.bot || !message.guild) return;

  // ── Gestion des sessions de création pas à pas ─────────────────────────────
  const sKey = sessionKey(message.author.id, message.channelId);
  const session = sessions.get(sKey);
  if (session && !message.content.startsWith(PREFIX)) {
    const response = message.content.trim();

    if (session.type === "embed") {
      const s = session as EmbedSession;

      if (s.step === "titre_page") {
        s.currentPage.titre = response;
        s.step = "texte_page";
        await message.reply({ embeds: [askEmbed("Quel est le **texte / description** de cette page ?")] });

      } else if (s.step === "texte_page") {
        s.currentPage.texte = response;
        s.step = "image_page";
        await message.reply({ embeds: [askEmbed("Y a-t-il une **image** pour cette page ? (envoie l'URL ou tape `non`)")] });

      } else if (s.step === "image_page") {
        if (response.toLowerCase() !== "non") s.currentPage.image = response;
        s.step = "autre_page";
        await message.reply({ embeds: [askEmbed(`Page ${s.pages.length + 1} enregistrée !\nVeux-tu ajouter **une autre page** ? (oui/non)`)] });

      } else if (s.step === "autre_page") {
        if (response.toLowerCase() === "oui") {
          s.pages.push({ ...s.currentPage });
          s.currentPage = { titre: "", texte: "" };
          s.step = "titre_page";
          await message.reply({ embeds: [askEmbed(`**Page ${s.pages.length + 1}**\nQuel est le **titre** de cette page ?`)] });
        } else {
          s.pages.push({ ...s.currentPage });
          s.step = "date";
          await message.reply({ embeds: [askEmbed("Veux-tu afficher la **date** sur l'embed ? (oui/non)")] });
        }

      } else if (s.step === "date") {
        s.afficherDate = response.toLowerCase() === "oui";
        s.step = "signature";
        await message.reply({ embeds: [askEmbed("Veux-tu ajouter une **signature** (ex: `Posté par le Staff`) ? (tape le texte ou `non`)")] });

      } else if (s.step === "signature") {
        if (response.toLowerCase() !== "non") s.signature = response;
        s.step = "couleur";
        await message.reply({ embeds: [askEmbed("Quelle **couleur** pour l'embed ? (ex: `#e74c3c`, ou `non` pour bleu par défaut)")] });

      } else if (s.step === "couleur") {
        s.couleur = response.toLowerCase() !== "non" ? response : "#5865f2";
        s.step = "bouton_role";
        await message.reply({ embeds: [askEmbed("Veux-tu ajouter un **bouton de rôle** ? (mentionne le rôle avec @, ou tape `non`)
En cliquant dessus, les membres recevront/retireront le rôle automatiquement.")] });

      } else if (s.step === "bouton_role") {
        if (response.toLowerCase() === "non") {
          s.step = "done";
          sessions.delete(sKey);
          if (s.editing) {
            updateEmbed(s.titre, { pages: s.pages, afficherDate: s.afficherDate!, signature: s.signature, couleur: s.couleur, roleId: undefined, roleBoutonLabel: undefined });
          } else {
            createEmbed({ titre: s.titre, pages: s.pages, afficherDate: s.afficherDate!, signature: s.signature, couleur: s.couleur!, createdAt: new Date().toISOString(), createdBy: message.author.tag });
          }
          await message.reply({ embeds: [successEmbed(`Embed **${s.titre}** ${s.editing ? "modifié" : "créé"} ! Poste-le avec \`+embed ${s.titre}\`.`)] });
          await message.channel.send({ embeds: [buildFinalEmbed(s, 0)] });
        } else {
          // Extraire l'ID du rôle mentionné
          const roleMatch = response.match(/<@&(\d+)>/);
          if (!roleMatch) {
            await message.reply({ embeds: [askEmbed("Mentionne un rôle avec @ ou tape `non`.")] });
          } else {
            s.roleId = roleMatch[1];
            s.step = "label_bouton_role";
            await message.reply({ embeds: [askEmbed("Quel **label** pour le bouton ? (ex: `✅ Accepter le règlement`)")] });
          }
        }

      } else if (s.step === "label_bouton_role") {
        s.roleBoutonLabel = response;
        s.step = "done";
        sessions.delete(sKey);
        if (s.editing) {
          updateEmbed(s.titre, { pages: s.pages, afficherDate: s.afficherDate!, signature: s.signature, couleur: s.couleur, roleId: s.roleId, roleBoutonLabel: s.roleBoutonLabel });
        } else {
          createEmbed({ titre: s.titre, pages: s.pages, afficherDate: s.afficherDate!, signature: s.signature, couleur: s.couleur!, roleId: s.roleId, roleBoutonLabel: s.roleBoutonLabel, createdAt: new Date().toISOString(), createdBy: message.author.tag });
        }
        await message.reply({ embeds: [successEmbed(`Embed **${s.titre}** ${s.editing ? "modifié" : "créé"} avec bouton de rôle ! Poste-le avec \`+embed ${s.titre}\`.`)] });
        await message.channel.send({ embeds: [buildFinalEmbed(s, 0)] });
      }

    } else if (session.type === "ticket") {
      const s = session as TicketSession;

      if (s.step === "description") {
        s.description = response;
        s.step = "bouton";
        await message.reply({ embeds: [askEmbed("Quel texte pour le **bouton** ? (ex: `📋 Ouvrir un ticket`)")] });

      } else if (s.step === "bouton") {
        s.bouton = response;
        s.step = "couleur";
        await message.reply({ embeds: [askEmbed("Quelle **couleur** pour l'embed du panel ? (ex: `#5865f2`, ou `non` pour bleu par défaut)")] });

      } else if (s.step === "couleur") {
        s.couleur = response.toLowerCase() !== "non" ? response : "#5865f2";
        s.step = "done";
        sessions.delete(sKey);

        if (s.editing) {
          updateTicket(s.titre, { description: s.description!, bouton: s.bouton!, couleur: s.couleur });
          await message.reply({ embeds: [successEmbed(`Ticket **${s.titre}** modifié ! Poste-le avec \`+ticket ${s.titre}\`.`)] });
        } else {
          createTicket({ titre: s.titre, description: s.description!, bouton: s.bouton!, couleur: s.couleur, rolesAcces: [], createdAt: new Date().toISOString(), createdBy: message.author.tag });
          await message.reply({ embeds: [successEmbed(`Ticket **${s.titre}** créé ! Poste-le avec \`+ticket ${s.titre}\`.`)] });
        }
        // Aperçu
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`ticket_open_${encodeURIComponent(s.titre)}`).setLabel(s.bouton!).setStyle(ButtonStyle.Primary)
        );
        await message.channel.send({
          embeds: [new EmbedBuilder().setColor(hexToInt(s.couleur)).setTitle(s.titre).setDescription(s.description!).setTimestamp()],
          components: [row],
        });
      }
    }
    return;
  }

  // Anti-spam/link si pas une commande
  if (!message.content.startsWith(PREFIX)) {
    // Perm 5 members bypass antispam/antilink automatically
    const senderPerm = await getPermLevel(message.guild, message.author.id);
    if (senderPerm < 6) await handleAntiSpam(message);
    return;
  }

  const config = getConfig();
  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = args.shift()!.toLowerCase();
  const guild = message.guild;
  const permLevel = await getPermLevel(guild, message.author.id);

  if (config.maintenanceMode && permLevel < 5 && cmd !== "help" && cmd !== "perm") {
    await message.reply({ embeds: [new EmbedBuilder().setColor(COLOR.yellow).setTitle("🔧 Bot en maintenance").setDescription(config.maintenanceMessage).setTimestamp()] });
    return;
  }

  const noPerm = async () => message.reply({ embeds: [errEmbed("Tu n'as pas la permission d'utiliser cette commande.")] });

  try {

  // ── +help ──────────────────────────────────────────────────────────────────
  if (cmd === "help") {
    const pages = buildHelpPages();
    await message.channel.send({ embeds: [pages[0]!], components: [helpNavRow(0, pages.length)] });
    return;
  }

  // ── +setpermcmd <commande> <niveau> ───────────────────────────────────────
  if (cmd === "setpermcmd") {
    if (permLevel < 6) { await noPerm(); return; }
    const targetCmd = args[0]?.toLowerCase();
    const niveau = parseInt(args[1] ?? "", 10);
    if (!targetCmd || isNaN(niveau) || niveau < 0 || niveau > 6) {
      await message.reply({ embeds: [errEmbed("Usage : `+setpermcmd <commande> <niveau 0-6>`\nEx : `+setpermcmd warn 2` pour que warn nécessite perm 2")] });
      return;
    }
    if (!(targetCmd in DEFAULT_PERM_CMDS)) {
      await message.reply({ embeds: [errEmbed(`Commande **${targetCmd}** introuvable.\nUtilise \`+permission\` pour voir les commandes disponibles.`)] });
      return;
    }
    const cfg = getServerConfig();
    cfg.permcmds[targetCmd] = niveau;
    saveServerConfig(cfg);
    await message.reply({ embeds: [successEmbed(`Commande **+${targetCmd}** → perm **${niveau}** requis.`)] });
    return;
  }

  // ── +resetpermcmd <commande> ───────────────────────────────────────────────
  if (cmd === "resetpermcmd") {
    if (permLevel < 6) { await noPerm(); return; }
    const targetCmd = args[0]?.toLowerCase();
    if (!targetCmd) { await message.reply({ embeds: [errEmbed("Usage : `+resetpermcmd <commande>`")] }); return; }
    const cfg = getServerConfig();
    delete cfg.permcmds[targetCmd];
    saveServerConfig(cfg);
    const defaut = DEFAULT_PERM_CMDS[targetCmd] ?? 0;
    await message.reply({ embeds: [successEmbed(`Commande **+${targetCmd}** remise à la perm par défaut (**${defaut}**).`)] });
    return;
  }

  // ── +permission ────────────────────────────────────────────────────────────
  if (cmd === "permission") {
    const cfg = getServerConfig();
    const activeMap = { ...DEFAULT_PERM_CMDS, ...(cfg.permcmds ?? {}) };
    const r = (n: number) => { const id = cfg.roles[`perm${n}` as keyof RolesConfig]; return id ? `<@&${id}>` : "*(non configuré)*"; };
    const cmdsForLevel = (n: number) => Object.entries(activeMap).filter(([,v]) => v === n).map(([k]) => `+${k}`).join(", ") || "*(aucune)*";
    const hasCustom = Object.keys(cfg.permcmds ?? {}).length > 0;
    const embed = new EmbedBuilder().setColor(COLOR.purple)
      .setTitle("🔑 Permissions — Récapitulatif")
      .addFields(
        { name: `🟢 Perm 1 — ${r(1)}`, value: cmdsForLevel(1), inline: false },
        { name: `🔵 Perm 2 — ${r(2)}`, value: cmdsForLevel(2), inline: false },
        { name: `🟡 Perm 3 — ${r(3)}`, value: cmdsForLevel(3), inline: false },
        { name: `🔴 Perm 4 — ${r(4)}`, value: cmdsForLevel(4), inline: false },
        { name: `🟠 Perm 5 — ${r(5)}`, value: cmdsForLevel(5) === "*(aucune)*" ? "*(niveau intermédiaire)*" : cmdsForLevel(5), inline: false },
        { name: `⚫ Perm 6 — ${r(6)} — Owner auto`, value: cmdsForLevel(6), inline: false },
        { name: "⬜ Tout le monde", value: "+help, +perm, +permission", inline: false },
      )
      .setFooter({ text: hasCustom ? "⚠️ Permissions personnalisées actives • +resetpermcmd <cmd> pour remettre par défaut" : "Défauts actifs • +setpermcmd <cmd> <1-6> pour modifier" })
      .setTimestamp();
    await message.reply({ embeds: [embed] });
    return;
  }

  // ── +perm ──────────────────────────────────────────────────────────────────
  if (cmd === "perm") {
    const cfg = getServerConfig();
    const lines = ([1,2,3,4,5,6] as const).map(n => {
      const id = cfg.roles[`perm${n}` as keyof RolesConfig];
      return `${["🟢 Perm 1 — Helpeur","🔵 Perm 2 — Modo","🟡 Perm 3 — Chef Modo","🔴 Perm 4 — Responsable","🟠 Perm 5 — Co Owner","⚫ Perm 6 — Paix"][n-1]} → ${id ? `<@&${id}>` : "*(non configuré)*"}`;
    });
    await message.reply({ embeds: [new EmbedBuilder().setColor(COLOR.blue).setTitle("🔑 Permissions").setDescription(lines.join("\n")).setFooter({ text: "+setrole <1-5> @rôle pour configurer" }).setTimestamp()] });
    return;
  }

  // ── +config ────────────────────────────────────────────────────────────────
  if (cmd === "config") {
    if (permLevel < 6) { await noPerm(); return; }
    const cfg = getServerConfig();
    const roles = ([1,2,3,4,5,6] as const).map(n => { const id = cfg.roles[`perm${n}` as keyof RolesConfig]; return `Perm ${n} : ${id ? `<@&${id}>` : "*(non défini)*"}`; }).join("\n");
    const logs = LOG_TYPES.map(k => `${LOG_LABELS[k]} : ${cfg.logs[k] ? `<#${cfg.logs[k]}>` : "*(non défini)*"}`).join("\n");
    await message.reply({ embeds: [new EmbedBuilder().setColor(COLOR.dark).setTitle("⚙️ Configuration").addFields({ name: "Rôles", value: roles }, { name: "Salons de logs", value: logs }).setTimestamp()] });
    return;
  }

  // ── +setrole ───────────────────────────────────────────────────────────────
  if (cmd === "setrole") {
    if (permLevel < 6) { await noPerm(); return; }
    const lvl = parseInt(args[0] ?? "", 10);
    if (isNaN(lvl) || lvl < 1 || lvl > 5) { await message.reply({ embeds: [errEmbed("Usage : `+setrole <1-5> @rôle`")] }); return; }
    const role = message.mentions.roles.first();
    if (!role) { await message.reply({ embeds: [errEmbed("Mentionne un rôle.")] }); return; }
    const cfg = getServerConfig();
    (cfg.roles as Record<string,string>)[`perm${lvl}`] = role.id;
    saveServerConfig(cfg);
    await message.reply({ embeds: [successEmbed(`Perm **${lvl}** → **${role.name}** défini.`)] });
    return;
  }

  // ── +logs ──────────────────────────────────────────────────────────────────
  if (cmd === "logs") {
    if (permLevel < 6) { await noPerm(); return; }
    const cfg = getServerConfig();
    const lines = LOG_TYPES.map(k => `${LOG_LABELS[k]} → ${cfg.logs[k] ? `<#${cfg.logs[k]}>` : "*(non configuré)*"}`).join("\n");
    await message.reply({ embeds: [new EmbedBuilder().setColor(COLOR.blue).setTitle("📋 Salons de logs").setDescription(lines).setFooter({ text: "+addlogs <type> #salon" }).setTimestamp()] });
    return;
  }

  // ── +addlogs ───────────────────────────────────────────────────────────────
  if (cmd === "addlogs") {
    if (permLevel < 6) { await noPerm(); return; }
    const key = args[0]?.toLowerCase() as keyof LogsConfig;
    if (!key || !LOG_TYPES.includes(key)) { await message.reply({ embeds: [errEmbed(`Type invalide. Types : \`${LOG_TYPES.join(", ")}\``)] }); return; }
    const channel = message.mentions.channels.first();
    if (!(channel instanceof TextChannel)) { await message.reply({ embeds: [errEmbed("Mentionne un salon textuel.")] }); return; }
    const cfg = getServerConfig();
    (cfg.logs as Record<string,string>)[key] = channel.id;
    saveServerConfig(cfg);
    await message.reply({ embeds: [successEmbed(`**${LOG_LABELS[key]}** → ${channel}.`)] });
    return;
  }

  // ── +deletelogs ────────────────────────────────────────────────────────────
  if (cmd === "deletelogs") {
    if (permLevel < 6) { await noPerm(); return; }
    const key = args[0]?.toLowerCase() as keyof LogsConfig;
    if (!key || !LOG_TYPES.includes(key)) { await message.reply({ embeds: [errEmbed(`Type invalide. Types : \`${LOG_TYPES.join(", ")}\``)] }); return; }
    const cfg = getServerConfig();
    delete (cfg.logs as Record<string,string|undefined>)[key];
    saveServerConfig(cfg);
    await message.reply({ embeds: [successEmbed(`Logs **${LOG_LABELS[key]}** supprimé.`)] });
    return;
  }

  // ── +modiflogs ─────────────────────────────────────────────────────────────
  if (cmd === "modiflogs") {
    if (permLevel < 6) { await noPerm(); return; }
    const key = args[0]?.toLowerCase() as keyof LogsConfig;
    if (!key || !LOG_TYPES.includes(key)) { await message.reply({ embeds: [errEmbed(`Type invalide. Types : \`${LOG_TYPES.join(", ")}\``)] }); return; }
    const channel = message.mentions.channels.first();
    if (!(channel instanceof TextChannel)) { await message.reply({ embeds: [errEmbed("Mentionne un salon textuel.")] }); return; }
    const cfg = getServerConfig();
    (cfg.logs as Record<string,string>)[key] = channel.id;
    saveServerConfig(cfg);
    await message.reply({ embeds: [successEmbed(`**${LOG_LABELS[key]}** modifié → ${channel}.`)] });
    return;
  }

  // ── +warn ──────────────────────────────────────────────────────────────────
  if (cmd === "warn") {
    if (permLevel < getCmdPerm("warn")) { await noPerm(); return; }
    const target = message.mentions.users.first();
    if (!target) { await message.reply({ embeds: [errEmbed("Usage : `+warn @membre [raison]`")] }); return; }
    const raison = args.slice(1).join(" ") || "Aucune raison fournie";
    const id = generateWarnId();
    addWarning({ id, userId: target.id, userTag: target.tag, raison, warnedAt: new Date().toISOString(), warnedBy: message.author.tag, warnedById: message.author.id });
    const warns = getWarnings(target.id);
    await message.reply({ embeds: [successEmbed(`Warn donné à **${target.tag}** (total : ${warns.length}). ID : \`${id}\``)] });
    await sendLog(guild, "mute-unmute", new EmbedBuilder().setColor(COLOR.yellow).setTitle("⚠️ Warn donné")
      .addFields({ name: "Utilisateur", value: `${target.tag} (${target.id})`, inline: true }, { name: "Modérateur", value: message.author.tag, inline: true }, { name: "Raison", value: raison }, { name: "ID", value: `\`${id}\``, inline: true }).setTimestamp());
    return;
  }

  // ── +unwarn ────────────────────────────────────────────────────────────────
  if (cmd === "unwarn") {
    if (permLevel < getCmdPerm("unwarn")) { await noPerm(); return; }
    const target = message.mentions.users.first();
    if (!target) { await message.reply({ embeds: [errEmbed("Usage : `+unwarn @membre [id]`")] }); return; }
    const warnId = args[1];
    if (warnId) {
      const removed = removeWarning(warnId);
      if (!removed) { await message.reply({ embeds: [errEmbed(`Warn \`${warnId}\` introuvable.`)] }); return; }
      await message.reply({ embeds: [successEmbed(`Warn \`${warnId}\` supprimé.`)] });
      await sendLog(guild, "mute-unmute", new EmbedBuilder().setColor(COLOR.green).setTitle("✅ Warn retiré").addFields({ name: "Utilisateur", value: `${target.tag}`, inline: true }, { name: "Modérateur", value: message.author.tag, inline: true }, { name: "ID", value: `\`${warnId}\``, inline: true }).setTimestamp());
    } else {
      const count = clearWarnings(target.id);
      await message.reply({ embeds: [successEmbed(`${count} warn(s) supprimé(s) pour **${target.tag}**.`)] });
      await sendLog(guild, "mute-unmute", new EmbedBuilder().setColor(COLOR.green).setTitle("✅ Warns supprimés").addFields({ name: "Utilisateur", value: target.tag, inline: true }, { name: "Nombre", value: `${count}`, inline: true }).setTimestamp());
    }
    return;
  }

  // ── +warnlist ──────────────────────────────────────────────────────────────
  if (cmd === "warnlist") {
    if (permLevel < getCmdPerm("warnlist")) { await noPerm(); return; }
    const target = message.mentions.users.first();
    if (!target) { await message.reply({ embeds: [errEmbed("Usage : `+warnlist @membre`")] }); return; }
    const warns = getWarnings(target.id);
    if (warns.length === 0) { await message.reply({ embeds: [okEmbed("⚠️ Warns", `**${target.tag}** n'a aucun avertissement.`)] }); return; }
    await message.reply({ embeds: [new EmbedBuilder().setColor(COLOR.yellow).setTitle(`⚠️ Warns de ${target.tag}`)
      .setDescription(warns.map((w,i) => `**${i+1}.** ID: \`${w.id}\`\n> ${w.raison} — par ${w.warnedBy} le ${new Date(w.warnedAt).toLocaleDateString("fr-FR")}`).join("\n\n"))
      .setFooter({ text: `${warns.length} avertissement(s)` }).setTimestamp()] });
    return;
  }

  // ── +mute @membre [raison] — mute permanent ───────────────────────────────
  if (cmd === "mute") {
    if (permLevel < getCmdPerm("mute")) { await noPerm(); return; }
    const target = message.mentions.users.first();
    if (!target) { await message.reply({ embeds: [errEmbed("Usage : `+mute @membre [raison]`")] }); return; }
    const raison = args.slice(1).join(" ") || "Aucune raison fournie";
    const member = await guild.members.fetch(target.id).catch(() => null);
    if (!member?.moderatable) { await message.reply({ embeds: [errEmbed("Impossible de muter ce membre.")] }); return; }
    // Mute permanent = timeout max Discord (28 jours) renouvelable — on stocke pour le rendre "permanent"
    await member.timeout(28 * 24 * 3600000, raison);
    await message.reply({ embeds: [successEmbed(`**${target.tag}** muté de façon permanente. Utilise \`+unmute\` pour lever.`)] });
    await sendLog(guild, "mute-unmute", new EmbedBuilder().setColor(COLOR.orange).setTitle("🔇 Mute permanent")
      .addFields({ name: "Utilisateur", value: `${target.tag} (${target.id})`, inline: true }, { name: "Modérateur", value: message.author.tag, inline: true }, { name: "Raison", value: raison }).setTimestamp());
    return;
  }

  // ── +tempmute @membre <durée> <s|m|h|j> [raison] — mute temporaire ────────
  if (cmd === "tempmute") {
    if (permLevel < getCmdPerm("tempmute")) { await noPerm(); return; }
    const target = message.mentions.users.first();
    if (!target) { await message.reply({ embeds: [errEmbed("Usage : `+tempmute @membre <durée> <s|m|h|j> [raison]`\nEx : `+tempmute @user 10 m Spam`")] }); return; }
    const valeur = parseInt(args[1] ?? "", 10);
    const unite = args[2]?.toLowerCase();
    const msMap: Record<string,number> = { s:1000, m:60000, h:3600000, j:86400000 };
    if (isNaN(valeur) || valeur < 1 || !unite || !msMap[unite]) {
      await message.reply({ embeds: [errEmbed("Usage : `+tempmute @membre <durée> <s|m|h|j> [raison]`\nUnités : `s` secondes, `m` minutes, `h` heures, `j` jours")] }); return;
    }
    const totalMs = valeur * msMap[unite]!;
    if (totalMs > 28*24*3600000) { await message.reply({ embeds: [errEmbed("Durée max : 28 jours.")] }); return; }
    const raison = args.slice(3).join(" ") || "Aucune raison fournie";
    const member = await guild.members.fetch(target.id).catch(() => null);
    if (!member?.moderatable) { await message.reply({ embeds: [errEmbed("Impossible de muter ce membre.")] }); return; }
    await member.timeout(totalMs, raison);
    await message.reply({ embeds: [successEmbed(`**${target.tag}** muté temporairement pour **${valeur}${unite}**.`)] });
    await sendLog(guild, "mute-unmute", new EmbedBuilder().setColor(COLOR.orange).setTitle("🔇 Tempmute")
      .addFields({ name: "Utilisateur", value: `${target.tag} (${target.id})`, inline: true }, { name: "Modérateur", value: message.author.tag, inline: true }, { name: "Durée", value: `${valeur}${unite}`, inline: true }, { name: "Raison", value: raison }).setTimestamp());
    return;
  }

  // ── +unmute ────────────────────────────────────────────────────────────────
  if (cmd === "unmute") {
    if (permLevel < getCmdPerm("unmute")) { await noPerm(); return; }
    const target = message.mentions.users.first();
    if (!target) { await message.reply({ embeds: [errEmbed("Usage : `+unmute @membre`")] }); return; }
    const member = await guild.members.fetch(target.id).catch(() => null);
    if (!member) { await message.reply({ embeds: [errEmbed("Membre introuvable.")] }); return; }
    await member.timeout(null);
    await message.reply({ embeds: [successEmbed(`**${target.tag}** démuté.`)] });
    await sendLog(guild, "mute-unmute", new EmbedBuilder().setColor(COLOR.green).setTitle("🔊 Unmute").addFields({ name: "Utilisateur", value: target.tag, inline: true }, { name: "Modérateur", value: message.author.tag, inline: true }).setTimestamp());
    return;
  }

  // ── +kick ──────────────────────────────────────────────────────────────────
  if (cmd === "kick") {
    if (permLevel < getCmdPerm("kick")) { await noPerm(); return; }
    const target = message.mentions.users.first();
    if (!target) { await message.reply({ embeds: [errEmbed("Usage : `+kick @membre [raison]`")] }); return; }
    const raison = args.slice(1).join(" ") || "Aucune raison fournie";
    const member = await guild.members.fetch(target.id).catch(() => null);
    if (!member?.kickable) { await message.reply({ embeds: [errEmbed("Impossible d'expulser ce membre.")] }); return; }
    await member.kick(raison);
    await message.reply({ embeds: [successEmbed(`**${target.tag}** expulsé.`)] });
    await sendLog(guild, "logs", new EmbedBuilder().setColor(COLOR.orange).setTitle("👢 Kick").addFields({ name: "Utilisateur", value: `${target.tag}`, inline: true }, { name: "Modérateur", value: message.author.tag, inline: true }, { name: "Raison", value: raison }).setTimestamp());
    return;
  }

  // ── +ban ───────────────────────────────────────────────────────────────────
  if (cmd === "ban") {
    if (permLevel < getCmdPerm("ban")) { await noPerm(); return; }
    const target = message.mentions.users.first();
    if (!target) { await message.reply({ embeds: [errEmbed("Usage : `+ban @membre [raison]`")] }); return; }
    const raison = args.slice(1).join(" ") || "Aucune raison fournie";
    const member = await guild.members.fetch(target.id).catch(() => null);
    if (!member?.bannable) { await message.reply({ embeds: [errEmbed("Impossible de bannir ce membre.")] }); return; }
    await member.ban({ reason: raison });
    await message.reply({ embeds: [successEmbed(`**${target.tag}** banni.`)] });
    await sendLog(guild, "bans-deban", new EmbedBuilder().setColor(COLOR.red).setTitle("🔨 Ban").addFields({ name: "Utilisateur", value: `${target.tag}`, inline: true }, { name: "Modérateur", value: message.author.tag, inline: true }, { name: "Raison", value: raison }).setTimestamp());
    return;
  }

  // ── +unban ─────────────────────────────────────────────────────────────────
  if (cmd === "unban") {
    if (permLevel < getCmdPerm("unban")) { await noPerm(); return; }
    const id = args[0];
    if (!id) { await message.reply({ embeds: [errEmbed("Usage : `+unban <id> [raison]`")] }); return; }
    const raison = args.slice(1).join(" ") || "Aucune raison fournie";
    const ban = await guild.bans.fetch(id).catch(() => null);
    if (!ban) { await message.reply({ embeds: [errEmbed("Aucun ban trouvé.")] }); return; }
    await guild.bans.remove(id, raison);
    await message.reply({ embeds: [successEmbed(`ID \`${id}\` débanni.`)] });
    await sendLog(guild, "bans-deban", new EmbedBuilder().setColor(COLOR.green).setTitle("✅ Unban").addFields({ name: "ID", value: `\`${id}\``, inline: true }, { name: "Modérateur", value: message.author.tag, inline: true }).setTimestamp());
    return;
  }

  // ── +banlist ───────────────────────────────────────────────────────────────
  if (cmd === "banlist") {
    if (permLevel < getCmdPerm("banlist")) { await noPerm(); return; }
    const bans = await guild.bans.fetch().catch(() => new Collection());
    if (bans.size === 0) { await message.reply({ embeds: [okEmbed("🔨 Bans", "Aucun ban actif.")] }); return; }
    const desc = [...bans.values()].slice(0,20).map((b,i) => `**${i+1}.** ${b.user.tag} (\`${b.user.id}\`)\n> ${b.reason ?? "Aucune raison"}`).join("\n\n");
    await message.reply({ embeds: [new EmbedBuilder().setColor(COLOR.red).setTitle(`🔨 Bans (${bans.size})`).setDescription(desc).setFooter({ text: "Limité à 20" }).setTimestamp()] });
    return;
  }

  // ── +clear ─────────────────────────────────────────────────────────────────
  if (cmd === "clear") {
    if (permLevel < getCmdPerm("clear")) { await noPerm(); return; }
    const nombre = parseInt(args[0] ?? "", 10);
    if (isNaN(nombre) || nombre < 1 || nombre > 100) { await message.reply({ embeds: [errEmbed("Usage : `+clear <1-100> [@membre]`")] }); return; }
    const targetUser = message.mentions.users.first();
    const channel = message.channel as TextChannel;
    let msgs = await channel.messages.fetch({ limit: Math.min(nombre+5, 100) });
    if (targetUser) msgs = msgs.filter(m => m.author.id === targetUser.id);
    const deleted = await channel.bulkDelete([...msgs.values()].slice(0, nombre), true).catch(() => new Collection());
    const reply = await channel.send({ embeds: [successEmbed(`${deleted.size} message(s) supprimé(s).`)] });
    setTimeout(() => reply.delete().catch(() => null), 5000);
    await sendLog(guild, "messages", new EmbedBuilder().setColor(COLOR.blue).setTitle("🧹 Clear").addFields({ name: "Salon", value: `#${channel.name}`, inline: true }, { name: "Par", value: message.author.tag, inline: true }, { name: "Supprimés", value: `${deleted.size}`, inline: true }).setTimestamp());
    return;
  }

  // ── +rank ──────────────────────────────────────────────────────────────────
  if (cmd === "rank") {
    if (permLevel < getCmdPerm("rank")) { await noPerm(); return; }
    const target = message.mentions.members?.first();
    const role = message.mentions.roles.first();
    if (!target || !role) { await message.reply({ embeds: [errEmbed("Usage : `+rank @membre @rôle`")] }); return; }
    if (target.roles.cache.has(role.id)) { await message.reply({ embeds: [errEmbed(`**${target.user.tag}** a déjà ce rôle.`)] }); return; }
    await target.roles.add(role, `Rank par ${message.author.tag}`);
    await message.reply({ embeds: [successEmbed(`Rôle **${role.name}** donné à **${target.user.tag}**.`)] });
    await sendLog(guild, "roles", new EmbedBuilder().setColor(COLOR.green).setTitle("⬆️ Rank").addFields({ name: "Membre", value: target.user.tag, inline: true }, { name: "Rôle", value: role.name, inline: true }, { name: "Par", value: message.author.tag, inline: true }).setTimestamp());
    return;
  }

  // ── +derank ────────────────────────────────────────────────────────────────
  if (cmd === "derank") {
    if (permLevel < getCmdPerm("derank")) { await noPerm(); return; }
    const target = message.mentions.members?.first();
    const role = message.mentions.roles.first();
    if (!target || !role) { await message.reply({ embeds: [errEmbed("Usage : `+derank @membre @rôle`")] }); return; }
    if (!target.roles.cache.has(role.id)) { await message.reply({ embeds: [errEmbed(`**${target.user.tag}** n'a pas ce rôle.`)] }); return; }
    await target.roles.remove(role, `Derank par ${message.author.tag}`);
    await message.reply({ embeds: [successEmbed(`Rôle **${role.name}** retiré à **${target.user.tag}**.`)] });
    await sendLog(guild, "roles", new EmbedBuilder().setColor(COLOR.orange).setTitle("⬇️ Derank").addFields({ name: "Membre", value: target.user.tag, inline: true }, { name: "Rôle", value: role.name, inline: true }, { name: "Par", value: message.author.tag, inline: true }).setTimestamp());
    return;
  }

  // ── +lock ──────────────────────────────────────────────────────────────────
  if (cmd === "lock") {
    if (permLevel < getCmdPerm("lock")) { await noPerm(); return; }
    const targetChan = (message.mentions.channels.first() as TextChannel | undefined) ?? message.channel as TextChannel;
    const raison = args.filter(a => !a.startsWith("<")).join(" ") || "Aucune raison fournie";
    await targetChan.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false });
    await message.reply({ embeds: [successEmbed(`🔒 **#${targetChan.name}** verrouillé.`)] });
    await sendLog(guild, "logs", new EmbedBuilder().setColor(COLOR.orange).setTitle("🔒 Lock").addFields({ name: "Salon", value: `#${targetChan.name}`, inline: true }, { name: "Par", value: message.author.tag, inline: true }, { name: "Raison", value: raison }).setTimestamp());
    return;
  }

  // ── +unlock ────────────────────────────────────────────────────────────────
  if (cmd === "unlock") {
    if (permLevel < getCmdPerm("unlock")) { await noPerm(); return; }
    const targetChan = (message.mentions.channels.first() as TextChannel | undefined) ?? message.channel as TextChannel;
    await targetChan.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: null });
    await message.reply({ embeds: [successEmbed(`🔓 **#${targetChan.name}** déverrouillé.`)] });
    await sendLog(guild, "logs", new EmbedBuilder().setColor(COLOR.green).setTitle("🔓 Unlock").addFields({ name: "Salon", value: `#${targetChan.name}`, inline: true }, { name: "Par", value: message.author.tag, inline: true }).setTimestamp());
    return;
  }

  // ── +renew ─────────────────────────────────────────────────────────────────
  if (cmd === "renew") {
    if (permLevel < getCmdPerm("renew")) { await noPerm(); return; }
    const channel = message.channel as TextChannel;
    const raison = args.join(" ") || "Aucune raison fournie";
    const { name, parent, topic, nsfw, position } = channel;
    const perms = channel.permissionOverwrites.cache;
    await message.reply({ embeds: [infoEmbed("♻️ Renouvellement", "Recréation dans 3 secondes...")] });
    setTimeout(async () => {
      const newChannel = await guild.channels.create({ name, type: ChannelType.GuildText, parent: parent ?? undefined, topic: topic ?? undefined, nsfw, position, permissionOverwrites: perms.map(p => ({ id: p.id, allow: p.allow, deny: p.deny })) });
      await channel.delete().catch(() => null);
      await (newChannel as TextChannel).send({ embeds: [new EmbedBuilder().setColor(COLOR.blue).setTitle("♻️ Salon renouvelé").setDescription(`Renouvelé par ${message.author.tag}.\n**Raison :** ${raison}`).setTimestamp()] });
      await sendLog(guild, "logs", new EmbedBuilder().setColor(COLOR.blue).setTitle("♻️ Renew").addFields({ name: "Salon", value: name, inline: true }, { name: "Par", value: message.author.tag, inline: true }, { name: "Raison", value: raison }).setTimestamp());
    }, 3000);
    return;
  }

  // ── +bl ────────────────────────────────────────────────────────────────────
  if (cmd === "bl") {
    if (permLevel < getCmdPerm("bl")) { await noPerm(); return; }
    const target = message.mentions.users.first();
    if (!target) { await message.reply({ embeds: [errEmbed("Usage : `+bl @membre [raison]`")] }); return; }
    const raison = args.slice(1).join(" ") || "Aucune raison fournie";
    addToBlacklist({ id: target.id, tag: target.tag, raison, addedAt: new Date().toISOString(), addedBy: message.author.tag });
    const member = await guild.members.fetch(target.id).catch(() => null);
    if (member) await member.ban({ reason: `Blacklist: ${raison}` }).catch(() => null);
    await message.reply({ embeds: [successEmbed(`**${target.tag}** blacklisté et banni.`)] });
    await sendLog(guild, "bl", new EmbedBuilder().setColor(COLOR.darkred).setTitle("🚫 Blacklist — Ajout").addFields({ name: "Utilisateur", value: `${target.tag}`, inline: true }, { name: "Par", value: message.author.tag, inline: true }, { name: "Raison", value: raison }).setTimestamp());
    return;
  }

  // ── +unbl ──────────────────────────────────────────────────────────────────
  if (cmd === "unbl") {
    if (permLevel < getCmdPerm("unbl")) { await noPerm(); return; }
    const id = args[0];
    if (!id) { await message.reply({ embeds: [errEmbed("Usage : `+unbl <id>`")] }); return; }
    const removed = removeFromBlacklist(id);
    if (!removed) { await message.reply({ embeds: [errEmbed(`ID \`${id}\` introuvable.`)] }); return; }
    await message.reply({ embeds: [successEmbed(`ID \`${id}\` retiré de la blacklist.`)] });
    await sendLog(guild, "bl", new EmbedBuilder().setColor(COLOR.green).setTitle("✅ Blacklist — Retrait").addFields({ name: "ID", value: `\`${id}\``, inline: true }, { name: "Par", value: message.author.tag, inline: true }).setTimestamp());
    return;
  }

  // ── +blcheck ───────────────────────────────────────────────────────────────
  if (cmd === "blcheck") {
    if (permLevel < getCmdPerm("blcheck")) { await noPerm(); return; }
    const list = getBlacklist();
    if (list.length === 0) { await message.reply({ embeds: [okEmbed("🚫 Blacklist", "La blacklist est vide.")] }); return; }
    const desc = list.map((e,i) => `**${i+1}.** ${e.tag} (\`${e.id}\`)\n> ${e.raison} — par ${e.addedBy}`).join("\n\n");
    await message.reply({ embeds: [new EmbedBuilder().setColor(COLOR.darkred).setTitle(`🚫 Blacklist (${list.length})`).setDescription(desc).setTimestamp()] });
    return;
  }

  // ── +wl ────────────────────────────────────────────────────────────────────
  if (cmd === "wl") {
    if (permLevel < getCmdPerm("wl")) { await noPerm(); return; }
    const sub = args[0]?.toLowerCase();
    if (sub === "add") {
      const target = message.mentions.users.first();
      if (!target) { await message.reply({ embeds: [errEmbed("Usage : `+wl add @personne`")] }); return; }
      addToWhitelist({ id: target.id, tag: target.tag, addedAt: new Date().toISOString(), addedBy: message.author.tag });
      await message.reply({ embeds: [successEmbed(`**${target.tag}** ajouté à la whitelist.`)] });
    } else if (sub === "remove") {
      const target = message.mentions.users.first();
      if (!target) { await message.reply({ embeds: [errEmbed("Usage : `+wl remove @personne`")] }); return; }
      const removed = removeFromWhitelist(target.id);
      if (!removed) { await message.reply({ embeds: [errEmbed(`**${target.tag}** introuvable dans la whitelist.`)] }); return; }
      await message.reply({ embeds: [successEmbed(`**${target.tag}** retiré de la whitelist.`)] });
    } else if (sub === "check") {
      const list = getWhitelist();
      const cfg = getServerConfig();
      const perm5RoleId = cfg.roles.perm6;
      const autoNote = perm5RoleId ? `\n\n*Les membres avec le rôle <@&${perm5RoleId}> (perm 6 — paix) sont automatiquement whitelistés.*` : "";
      if (list.length === 0) { await message.reply({ embeds: [okEmbed("✅ Whitelist", `La whitelist manuelle est vide.${autoNote}`)] }); return; }
      const desc = list.map((e,i) => `**${i+1}.** ${e.tag} (\`${e.id}\`)`).join("\n") + autoNote;
      await message.reply({ embeds: [new EmbedBuilder().setColor(COLOR.green).setTitle(`✅ Whitelist (${list.length})`).setDescription(desc).setTimestamp()] });
    } else { await message.reply({ embeds: [errEmbed("Usage : `+wl add|remove|check`")] }); }
    return;
  }

  // ── +backup ────────────────────────────────────────────────────────────────
  if (cmd === "backup") {
    if (permLevel < getCmdPerm("backup")) { await noPerm(); return; }
    const sub = args[0]?.toLowerCase();
    if (sub === "create") {
      const backup = createBackup(guild, message.author.tag);
      await message.reply({ embeds: [successEmbed(`Sauvegarde créée ! ID : \`${backup.id}\``)] });
    } else if (sub === "list") {
      const backups = listBackups();
      if (backups.length === 0) { await message.reply({ embeds: [okEmbed("💾 Sauvegardes", "Aucune sauvegarde.")] }); return; }
      await message.reply({ embeds: [new EmbedBuilder().setColor(COLOR.blue).setTitle("💾 Sauvegardes").setDescription(backups.slice(0,10).map((b,i) => `**${i+1}.** \`${b.id}\` — ${new Date(b.createdAt).toLocaleDateString("fr-FR")} par ${b.createdBy}`).join("\n")).setTimestamp()] });
    } else if (sub === "load") {
      const id = args[1];
      if (!id) { await message.reply({ embeds: [errEmbed("Usage : `+backup load <id>`")] }); return; }
      if (!loadBackup(id)) { await message.reply({ embeds: [errEmbed(`Sauvegarde \`${id}\` introuvable.`)] }); return; }
      await message.reply({ embeds: [successEmbed(`Sauvegarde \`${id}\` restaurée.`)] });
    } else { await message.reply({ embeds: [errEmbed("Usage : `+backup create|list|load [id]`")] }); }
    return;
  }

  // ── +maintenance ───────────────────────────────────────────────────────────
  if (cmd === "maintenance") {
    if (permLevel < getCmdPerm("maintenance")) { await noPerm(); return; }
    const statut = args[0]?.toLowerCase();
    if (statut !== "on" && statut !== "off") { await message.reply({ embeds: [errEmbed("Usage : `+maintenance on|off [message]`")] }); return; }
    const on = statut === "on";
    updateConfig({ maintenanceMode: on, maintenanceMessage: args.slice(1).join(" ") || "Le bot est en maintenance." });
    await message.reply({ embeds: [successEmbed(`Maintenance ${on ? "activée" : "désactivée"}.`)] });
    return;
  }

  // ── +antilink ──────────────────────────────────────────────────────────────
  if (cmd === "antilink") {
    if (permLevel < 6) { await noPerm(); return; }
    const on = args[0]?.toLowerCase() === "on";
    updateConfig({ antilink: on });
    await message.reply({ embeds: [successEmbed(`Antilink ${on ? "activé" : "désactivé"}.`)] });
    await sendLog(guild, "logs", new EmbedBuilder().setColor(on ? COLOR.red : COLOR.green).setTitle(`🔗 Antilink ${on ? "activé" : "désactivé"}`).addFields({ name: "Par", value: message.author.tag }).setTimestamp());
    return;
  }

  // ── +antispam ──────────────────────────────────────────────────────────────
  if (cmd === "antispam") {
    if (permLevel < 6) { await noPerm(); return; }
    const on = args[0]?.toLowerCase() === "on";
    const seuil = args[1] ? parseInt(args[1],10) : undefined;
    const intervalle = args[2] ? parseInt(args[2],10) : undefined;
    updateConfig({ antispam: on, ...(seuil && !isNaN(seuil) && { antispamThreshold: seuil }), ...(intervalle && !isNaN(intervalle) && { antispamInterval: intervalle*1000 }) });
    await message.reply({ embeds: [successEmbed(`Antispam ${on ? "activé" : "désactivé"}.`)] });
    await sendLog(guild, "logs", new EmbedBuilder().setColor(on ? COLOR.orange : COLOR.green).setTitle(`🚫 Antispam ${on ? "activé" : "désactivé"}`).addFields({ name: "Par", value: message.author.tag }).setTimestamp());
    return;
  }

  // ── +antiraid ──────────────────────────────────────────────────────────────
  if (cmd === "antiraid") {
    if (permLevel < 6) { await noPerm(); return; }
    const on = args[0]?.toLowerCase() === "on";
    const seuil = args[1] ? parseInt(args[1],10) : undefined;
    updateConfig({ antiraid: on, ...(seuil && !isNaN(seuil) && { antiraidThreshold: seuil }) });
    await message.reply({ embeds: [successEmbed(`Antiraid ${on ? "activé" : "désactivé"}.`)] });
    await sendLog(guild, "logs", new EmbedBuilder().setColor(on ? COLOR.orange : COLOR.green).setTitle(`🛡️ Antiraid ${on ? "activé" : "désactivé"}`).addFields({ name: "Par", value: message.author.tag }).setTimestamp());
    return;
  }

  // ── +antiraid-reset ────────────────────────────────────────────────────────
  if (cmd === "antiraid-reset") {
    if (permLevel < 6) { await noPerm(); return; }
    if (!isRaidLockdown()) { await message.reply({ embeds: [errEmbed("Aucun lockdown actif.")] }); return; }
    disableRaidLockdown();
    await message.reply({ embeds: [successEmbed("Lockdown désactivé.")] });
    await sendLog(guild, "logs", new EmbedBuilder().setColor(COLOR.green).setTitle("🛡️ Antiraid — Lockdown levé").addFields({ name: "Par", value: message.author.tag }).setTimestamp());
    return;
  }

  // ── +antiaddbot on|off ────────────────────────────────────────────────────
  if (cmd === "antiaddbot") {
    if (permLevel < 6) { await noPerm(); return; }
    const statut = args[0]?.toLowerCase();
    if (statut !== "on" && statut !== "off") { await message.reply({ embeds: [errEmbed("Usage : `+antiaddbot on|off`")] }); return; }
    const on = statut === "on";
    updateConfig({ antiaddbot: on });
    await message.reply({ embeds: [successEmbed(`Anti-add bot ${on ? "activé — seuls les owners et la whitelist peuvent ajouter des bots" : "désactivé"}.`)] });
    await sendLog(guild, "logs", new EmbedBuilder().setColor(on ? COLOR.red : COLOR.green).setTitle(`🤖 Anti-add bot ${on ? "activé" : "désactivé"}`).addFields({ name: "Par", value: message.author.tag }).setTimestamp());
    return;
  }

  // ── +slowmode #salon <secondes> ───────────────────────────────────────────
  if (cmd === "slowmode") {
    if (permLevel < getCmdPerm("slowmode")) { await noPerm(); return; }
    const targetChan = (message.mentions.channels.first() as TextChannel | undefined) ?? message.channel as TextChannel;
    const secondes = parseInt(args.find(a => !a.startsWith("<")) ?? "", 10);
    if (isNaN(secondes) || secondes < 0 || secondes > 21600) { await message.reply({ embeds: [errEmbed("Usage : `+slowmode [#salon] <0-21600>`
`0` pour désactiver.")] }); return; }
    await targetChan.setRateLimitPerUser(secondes);
    await message.reply({ embeds: [successEmbed(secondes === 0 ? `Slowmode désactivé sur **#${targetChan.name}**.` : `Slowmode de **${secondes}s** activé sur **#${targetChan.name}**.`)] });
    await sendLog(guild, "logs", new EmbedBuilder().setColor(secondes === 0 ? COLOR.green : COLOR.orange).setTitle("🐢 Slowmode").addFields({ name: "Salon", value: `#${targetChan.name}`, inline: true }, { name: "Durée", value: `${secondes}s`, inline: true }, { name: "Par", value: message.author.tag, inline: true }).setTimestamp());
    return;
  }

  // ── +lockdown [raison] ────────────────────────────────────────────────────
  if (cmd === "lockdown") {
    if (permLevel < getCmdPerm("lockdown")) { await noPerm(); return; }
    const raison = args.join(" ") || "Lockdown d'urgence";
    const channels = guild.channels.cache.filter(c => c instanceof TextChannel) as Collection<string, TextChannel>;
    let count = 0;
    for (const [, chan] of channels) {
      await chan.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false }).catch(() => null);
      count++;
    }
    await message.reply({ embeds: [successEmbed(`🔒 **${count} salons** verrouillés. Raison : ${raison}`)] });
    await sendLog(guild, "logs", new EmbedBuilder().setColor(COLOR.darkred).setTitle("🔒 LOCKDOWN ACTIVÉ").addFields({ name: "Par", value: message.author.tag, inline: true }, { name: "Salons", value: `${count}`, inline: true }, { name: "Raison", value: raison }).setTimestamp());
    return;
  }

  // ── +unlockdown ───────────────────────────────────────────────────────────
  if (cmd === "unlockdown") {
    if (permLevel < getCmdPerm("unlockdown")) { await noPerm(); return; }
    const channels = guild.channels.cache.filter(c => c instanceof TextChannel) as Collection<string, TextChannel>;
    let count = 0;
    for (const [, chan] of channels) {
      await chan.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: null }).catch(() => null);
      count++;
    }
    await message.reply({ embeds: [successEmbed(`🔓 **${count} salons** déverrouillés.`)] });
    await sendLog(guild, "logs", new EmbedBuilder().setColor(COLOR.green).setTitle("🔓 LOCKDOWN LEVÉ").addFields({ name: "Par", value: message.author.tag, inline: true }, { name: "Salons", value: `${count}`, inline: true }).setTimestamp());
    return;
  }

  // ── +massban <id1> <id2> ... [raison] ─────────────────────────────────────
  if (cmd === "massban") {
    if (permLevel < getCmdPerm("massban")) { await noPerm(); return; }
    const ids = args.filter(a => /^\d{17,19}$/.test(a));
    const raison = args.filter(a => !/^\d{17,19}$/.test(a)).join(" ") || "Massban";
    if (ids.length === 0) { await message.reply({ embeds: [errEmbed("Usage : `+massban <id1> <id2> ... [raison]`")] }); return; }
    let success = 0;
    for (const id of ids) {
      await guild.bans.create(id, { reason: raison }).catch(() => null);
      success++;
    }
    await message.reply({ embeds: [successEmbed(`**${success}** membres bannis. Raison : ${raison}`)] });
    await sendLog(guild, "bans-deban", new EmbedBuilder().setColor(COLOR.darkred).setTitle("🔨 Massban").addFields({ name: "Bans", value: `${success}`, inline: true }, { name: "Par", value: message.author.tag, inline: true }, { name: "Raison", value: raison }).setTimestamp());
    return;
  }

  // ── +clearinvites ─────────────────────────────────────────────────────────
  if (cmd === "clearinvites") {
    if (permLevel < getCmdPerm("clearinvites")) { await noPerm(); return; }
    const invites = await guild.invites.fetch().catch(() => null);
    if (!invites || invites.size === 0) { await message.reply({ embeds: [okEmbed("🔗 Invitations", "Aucune invitation active.")] }); return; }
    let count = 0;
    for (const [, invite] of invites) {
      await invite.delete("Clearinvites").catch(() => null);
      count++;
    }
    await message.reply({ embeds: [successEmbed(`**${count}** invitation(s) supprimée(s).`)] });
    await sendLog(guild, "logs", new EmbedBuilder().setColor(COLOR.orange).setTitle("🔗 Clearinvites").addFields({ name: "Supprimées", value: `${count}`, inline: true }, { name: "Par", value: message.author.tag, inline: true }).setTimestamp());
    return;
  }

  // ── +antimentionspam on|off [seuil] ───────────────────────────────────────
  if (cmd === "antimentionspam") {
    if (permLevel < getCmdPerm("antimentionspam")) { await noPerm(); return; }
    const statut = args[0]?.toLowerCase();
    if (statut !== "on" && statut !== "off") { await message.reply({ embeds: [errEmbed("Usage : `+antimentionspam on|off [seuil]`
Ex: `+antimentionspam on 5`")] }); return; }
    const on = statut === "on";
    const seuil = args[1] ? parseInt(args[1], 10) : undefined;
    updateConfig({ antimentionspam: on, ...(seuil && !isNaN(seuil) && { antimentionspamThreshold: seuil }) });
    await message.reply({ embeds: [successEmbed(`Anti-mention spam ${on ? `activé (seuil : ${seuil ?? getConfig().antimentionspamThreshold ?? 5} mentions)` : "désactivé"}.`)] });
    await sendLog(guild, "logs", new EmbedBuilder().setColor(on ? COLOR.orange : COLOR.green).setTitle(`📢 Anti-mention spam ${on ? "activé" : "désactivé"}`).addFields({ name: "Par", value: message.author.tag }).setTimestamp());
    return;
  }

  // ── +owner ─────────────────────────────────────────────────────────────────
  if (cmd === "owner") {
    if (permLevel < 6) { await noPerm(); return; }
    const sub = args[0]?.toLowerCase();
    if (sub === "add") {
      const target = message.mentions.users.first();
      if (!target) { await message.reply({ embeds: [errEmbed("Usage : `+owner add @personne`")] }); return; }
      if (target.id === message.author.id) { await message.reply({ embeds: [errEmbed("Tu ne peux pas te mettre owner toi-même.")] }); return; }
      if (isOwner(target.id)) { await message.reply({ embeds: [errEmbed(`**${target.tag}** est déjà owner.`)] }); return; }
      addOwner({ id: target.id, tag: target.tag, addedAt: new Date().toISOString(), addedBy: message.author.tag });
      await message.reply({ embeds: [successEmbed(`**${target.tag}** ajouté comme owner.`)] });
    } else if (sub === "remove") {
      const target = message.mentions.users.first();
      if (!target) { await message.reply({ embeds: [errEmbed("Usage : `+owner remove @personne`")] }); return; }
      const removed = removeOwner(target.id);
      if (!removed) { await message.reply({ embeds: [errEmbed(`**${target.tag}** n'est pas owner.`)] }); return; }
      await message.reply({ embeds: [successEmbed(`**${target.tag}** retiré des owners.`)] });
    } else if (sub === "list") {
      const owners = getOwners();
      const cfg = getServerConfig();
      const perm5RoleId = cfg.roles.perm6;
      const autoNote = perm5RoleId ? `\n\n*Les membres avec le rôle <@&${perm5RoleId}> (perm 6 — paix) sont automatiquement owners.*` : "";
      if (owners.length === 0) { await message.reply({ embeds: [okEmbed("👑 Owners", `Aucun owner manuel enregistré.${autoNote}`)] }); return; }
      const desc = owners.map((o,i) => `**${i+1}.** ${o.tag} (\`${o.id}\`)`).join("\n") + autoNote;
      await message.reply({ embeds: [new EmbedBuilder().setColor(COLOR.dark).setTitle(`👑 Owners manuels (${owners.length})`).setDescription(desc).setTimestamp()] });
    } else { await message.reply({ embeds: [errEmbed("Usage : `+owner add|remove|list`")] }); }
    return;
  }

  // ── +createembed [titre] ───────────────────────────────────────────────────
  if (cmd === "createembed") {
    if (permLevel < getCmdPerm("createembed")) { await noPerm(); return; }
    const titre = args.join(" ");
    if (!titre) { await message.reply({ embeds: [errEmbed("Usage : `+createembed [titre]`")] }); return; }
    if (getEmbed(titre)) { await message.reply({ embeds: [errEmbed(`Un embed **${titre}** existe déjà. Utilise \`+modifembed ${titre}\`.`)] }); return; }
    sessions.set(sKey, { type: "embed", userId: message.author.id, channelId: message.channelId, titre, pages: [], currentPage: { titre: "", texte: "" }, step: "titre_page", editing: false });
    await message.reply({ embeds: [infoEmbed(`📝 Création de l'embed "${titre}"`, "Réponds aux questions une par une.\nTape `+annuler` à tout moment pour annuler.")] });
    await message.channel.send({ embeds: [askEmbed("**Page 1** — Quel est le **titre** de cette page ?")] });
    return;
  }

  // ── +modifembed [titre] ────────────────────────────────────────────────────
  if (cmd === "modifembed") {
    if (permLevel < getCmdPerm("modifembed")) { await noPerm(); return; }
    const titre = args.join(" ");
    if (!titre) { await message.reply({ embeds: [errEmbed("Usage : `+modifembed [titre]`")] }); return; }
    const existing = getEmbed(titre);
    if (!existing) { await message.reply({ embeds: [errEmbed(`Aucun embed **${titre}** trouvé. Utilise \`+listembeds\`.`)] }); return; }
    sessions.set(sKey, { type: "embed", userId: message.author.id, channelId: message.channelId, titre, pages: [], currentPage: { titre: "", texte: "" }, step: "titre_page", editing: true });
    await message.reply({ embeds: [infoEmbed(`✏️ Modification de l'embed "${titre}"`, "Les nouvelles infos remplaceront l'ancien embed.\nTape `+annuler` pour annuler.")] });
    await message.channel.send({ embeds: [askEmbed("**Page 1** — Quel est le **titre** de cette page ?")] });
    return;
  }

  // ── +embed [titre] — poster ────────────────────────────────────────────────
  if (cmd === "embed") {
    if (permLevel < getCmdPerm("embed")) { await noPerm(); return; }
    const titre = args.join(" ");
    if (!titre) { await message.reply({ embeds: [errEmbed("Usage : `+embed [titre]`")] }); return; }
    const entry = getEmbed(titre);
    if (!entry) { await message.reply({ embeds: [errEmbed(`Aucun embed **${titre}** trouvé. Utilise \`+listembeds\`.`)] }); return; }
    // Poster toutes les pages
    for (let i = 0; i < entry.pages.length; i++) {
      const page = entry.pages[i]!;
      const e = new EmbedBuilder().setColor(hexToInt(entry.couleur)).setTitle(page.titre).setDescription(page.texte);
      if (page.image) e.setImage(page.image);
      if (entry.afficherDate) e.setTimestamp();
      const footerParts: string[] = [];
      if (entry.pages.length > 1) footerParts.push(`Page ${i+1}/${entry.pages.length}`);
      if (entry.signature) footerParts.push(entry.signature);
      if (footerParts.length) e.setFooter({ text: footerParts.join(" • ") });
      // Bouton de rôle uniquement sur la dernière page
      if (entry.roleId && entry.roleBoutonLabel && i === entry.pages.length - 1) {
        const roleRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`toggle_role_${entry.roleId}`).setLabel(entry.roleBoutonLabel).setStyle(ButtonStyle.Success)
        );
        await message.channel.send({ embeds: [e], components: [roleRow] });
      } else {
        await message.channel.send({ embeds: [e] });
      }
    }
    return;
  }

  // ── +deleteembed [titre] ───────────────────────────────────────────────────
  if (cmd === "deleteembed") {
    if (permLevel < getCmdPerm("deleteembed")) { await noPerm(); return; }
    const titre = args.join(" ");
    if (!titre) { await message.reply({ embeds: [errEmbed("Usage : `+deleteembed [titre]`")] }); return; }
    if (!deleteEmbed(titre)) { await message.reply({ embeds: [errEmbed(`Aucun embed **${titre}** trouvé.`)] }); return; }
    await message.reply({ embeds: [successEmbed(`Embed **${titre}** supprimé.`)] });
    return;
  }

  // ── +listembeds ────────────────────────────────────────────────────────────
  if (cmd === "listembeds") {
    if (permLevel < getCmdPerm("listembeds")) { await noPerm(); return; }
    const list = getAllEmbeds();
    if (list.length === 0) { await message.reply({ embeds: [okEmbed("📋 Embeds", "Aucun embed sauvegardé.")] }); return; }
    await message.reply({ embeds: [new EmbedBuilder().setColor(COLOR.purple).setTitle(`📋 Embeds (${list.length})`).setDescription(list.map((e,i) => `**${i+1}.** \`${e.titre}\` — ${e.pages.length} page(s) — par ${e.createdBy}`).join("\n")).setTimestamp()] });
    return;
  }

  // ── +createticket [titre] ─────────────────────────────────────────────────
  if (cmd === "createticket") {
    if (permLevel < getCmdPerm("createticket")) { await noPerm(); return; }
    const titre = args.join(" ");
    if (!titre) { await message.reply({ embeds: [errEmbed("Usage : `+createticket [titre]`")] }); return; }
    if (getTicket(titre)) { await message.reply({ embeds: [errEmbed(`Un ticket **${titre}** existe déjà. Utilise \`+modifticket ${titre}\`.`)] }); return; }
    sessions.set(sKey, { type: "ticket", userId: message.author.id, channelId: message.channelId, titre, step: "description", editing: false });
    await message.reply({ embeds: [infoEmbed(`🎫 Création du ticket "${titre}"`, "Réponds aux questions une par une.\nTape `+annuler` pour annuler.")] });
    await message.channel.send({ embeds: [askEmbed("Quelle est la **description** affichée sur le panel ?")] });
    return;
  }

  // ── +modifticket [titre] ──────────────────────────────────────────────────
  if (cmd === "modifticket") {
    if (permLevel < getCmdPerm("modifticket")) { await noPerm(); return; }
    const titre = args.join(" ");
    if (!titre) { await message.reply({ embeds: [errEmbed("Usage : `+modifticket [titre]`")] }); return; }
    if (!getTicket(titre)) { await message.reply({ embeds: [errEmbed(`Aucun ticket **${titre}** trouvé.`)] }); return; }
    sessions.set(sKey, { type: "ticket", userId: message.author.id, channelId: message.channelId, titre, step: "description", editing: true });
    await message.reply({ embeds: [infoEmbed(`✏️ Modification du ticket "${titre}"`, "Tape `+annuler` pour annuler.")] });
    await message.channel.send({ embeds: [askEmbed("Nouvelle **description** du panel ?")] });
    return;
  }

  // ── +ticket [titre] — poster ───────────────────────────────────────────────
  if (cmd === "ticket") {
    if (permLevel < getCmdPerm("ticket")) { await noPerm(); return; }
    const titre = args.join(" ");
    if (!titre) { await message.reply({ embeds: [errEmbed("Usage : `+ticket [titre]`")] }); return; }
    const entry = getTicket(titre);
    if (!entry) { await message.reply({ embeds: [errEmbed(`Aucun ticket **${titre}** trouvé. Utilise \`+listtickets\`.`)] }); return; }
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`ticket_open_${encodeURIComponent(entry.titre)}`).setLabel(entry.bouton).setStyle(ButtonStyle.Primary)
    );
    await message.channel.send({ embeds: [new EmbedBuilder().setColor(hexToInt(entry.couleur)).setTitle(entry.titre).setDescription(entry.description).setTimestamp()], components: [row] });
    return;
  }

  // ── +deleteticket [titre] ─────────────────────────────────────────────────
  if (cmd === "deleteticket") {
    if (permLevel < getCmdPerm("deleteticket")) { await noPerm(); return; }
    const titre = args.join(" ");
    if (!titre) { await message.reply({ embeds: [errEmbed("Usage : `+deleteticket [titre]`")] }); return; }
    if (!deleteTicket(titre)) { await message.reply({ embeds: [errEmbed(`Aucun ticket **${titre}** trouvé.`)] }); return; }
    await message.reply({ embeds: [successEmbed(`Ticket **${titre}** supprimé.`)] });
    return;
  }

  // ── +listtickets ──────────────────────────────────────────────────────────
  if (cmd === "listtickets") {
    if (permLevel < getCmdPerm("listtickets")) { await noPerm(); return; }
    const list = getAllTickets();
    if (list.length === 0) { await message.reply({ embeds: [okEmbed("🎫 Tickets", "Aucun ticket sauvegardé.")] }); return; }
    await message.reply({ embeds: [new EmbedBuilder().setColor(COLOR.blue).setTitle(`🎫 Tickets (${list.length})`).setDescription(list.map((t,i) => `**${i+1}.** \`${t.titre}\` — bouton: *${t.bouton}* — par ${t.createdBy}`).join("\n")).setTimestamp()] });
    return;
  }

  // ── +annuler — annuler une session en cours ────────────────────────────────
  if (cmd === "annuler") {
    if (sessions.has(sKey)) {
      sessions.delete(sKey);
      await message.reply({ embeds: [successEmbed("Session annulée.")] });
    } else {
      await message.reply({ embeds: [errEmbed("Aucune session en cours à annuler.")] });
    }
    return;
  }

  } catch (err) {
    console.error("Erreur commande:", err);
    await message.reply({ embeds: [errEmbed("Une erreur interne est survenue.")] }).catch(() => null);
  }
});

client.login(TOKEN);
