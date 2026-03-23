import { Message, GuildMember, TextChannel, EmbedBuilder, Guild } from "discord.js";
import { getConfig } from "./data.js";
import { isWhitelisted } from "./whitelist.js";

// ── Anti-spam tracker ─────────────────────────────────────────────────────────
interface SpamRecord {
  count: number;
  firstAt: number;
  messageIds: string[];
}
const spamMap = new Map<string, SpamRecord>();

// ── Anti-raid tracker ─────────────────────────────────────────────────────────
interface JoinRecord {
  count: number;
  firstAt: number;
}
let raidRecord: JoinRecord = { count: 0, firstAt: Date.now() };
let raidLockdown = false;

const LINK_REGEX = /https?:\/\/[^\s]+|discord\.gg\/[^\s]+|www\.[^\s]+\.[a-z]{2,}/i;
const DISCORD_INVITE = /discord\.(gg|com\/invite)\/[a-zA-Z0-9-]+/i;

async function sendLog(guild: Guild, channelName: string, embed: EmbedBuilder): Promise<void> {
  const { TextChannel: TC } = await import("discord.js");
  const channel = guild.channels.cache.find(c => c.name === channelName);
  if (channel && channel instanceof TextChannel) {
    await channel.send({ embeds: [embed] }).catch(() => null);
  }
}

export async function handleAntiSpam(message: Message): Promise<boolean> {
  if (!message.guild || !message.member) return false;
  const config = getConfig();

  // ── Antilink ──────────────────────────────────────────────────────────────
  if (config.antilink) {
    if (isWhitelisted(message.author.id)) {
      // whitelist → bypass antilink
    } else if (LINK_REGEX.test(message.content) || DISCORD_INVITE.test(message.content)) {
      await message.delete().catch(() => null);
      const warn = await message.channel.send({
        embeds: [new EmbedBuilder()
          .setColor(0xe74c3c)
          .setDescription(`🔗 ${message.author}, les liens sont interdits sur ce serveur.`)
          .setTimestamp()],
      }).catch(() => null);
      if (warn) setTimeout(() => warn.delete().catch(() => null), 5000);

      // Log antilink
      await sendLog(message.guild, "⚙️・logs", new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle("🔗 Antilink — Lien supprimé")
        .addFields(
          { name: "Utilisateur", value: `${message.author.tag} (${message.author.id})`, inline: true },
          { name: "Salon", value: `#${(message.channel as TextChannel).name}`, inline: true },
          { name: "Contenu", value: message.content.slice(0, 200) || "—", inline: false },
        )
        .setTimestamp()
      );
      return true;
    }
  }

  // ── Antispam ──────────────────────────────────────────────────────────────
  if (config.antispam) {
    if (!isWhitelisted(message.author.id)) {
      const key = `${message.guild.id}:${message.author.id}`;
      const now = Date.now();
      const record = spamMap.get(key) ?? { count: 0, firstAt: now, messageIds: [] };

      if (now - record.firstAt > config.antispamInterval) {
        record.count = 1;
        record.firstAt = now;
        record.messageIds = [message.id];
      } else {
        record.count++;
        record.messageIds.push(message.id);
      }
      spamMap.set(key, record);

      if (record.count >= config.antispamThreshold) {
        const channel = message.channel as TextChannel;
        for (const msgId of record.messageIds) {
          await channel.messages.delete(msgId).catch(() => null);
        }
        spamMap.delete(key);

        await message.member.timeout(5 * 60 * 1000, "Anti-spam automatique").catch(() => null);
        const warn = await channel.send({
          embeds: [new EmbedBuilder()
            .setColor(0xe74c3c)
            .setDescription(`🚫 ${message.author}, tu as été muté automatiquement pour spam (${config.antispamThreshold} messages en ${config.antispamInterval / 1000}s).`)
            .setTimestamp()],
        }).catch(() => null);
        if (warn) setTimeout(() => warn.delete().catch(() => null), 8000);

        // Log antispam
        await sendLog(message.guild, "⚙️・logs", new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle("🚫 Antispam — Mute automatique")
          .addFields(
            { name: "Utilisateur", value: `${message.author.tag} (${message.author.id})`, inline: true },
            { name: "Salon", value: `#${channel.name}`, inline: true },
            { name: "Messages supprimés", value: `${record.messageIds.length}`, inline: true },
          )
          .setTimestamp()
        );
        return true;
      }
    }
  }

  return false;
}

export async function handleAntiRaid(member: GuildMember): Promise<boolean> {
  const config = getConfig();
  if (!config.antiraid) return false;

  const now = Date.now();
  if (now - raidRecord.firstAt > 10_000) {
    raidRecord = { count: 1, firstAt: now };
  } else {
    raidRecord.count++;
  }

  if (raidRecord.count >= config.antiraidThreshold) {
    raidLockdown = true;
    await member.ban({ reason: "Anti-raid automatique" }).catch(() => null);

    // Log antiraid
    const guild = member.guild;
    await sendLog(guild, "⚙️・logs", new EmbedBuilder()
      .setColor(0x8b0000)
      .setTitle("🛡️ Antiraid — Lockdown activé")
      .addFields(
        { name: "Membre banni", value: `${member.user.tag} (${member.id})`, inline: true },
        { name: "Seuil atteint", value: `${config.antiraidThreshold} joins en 10s`, inline: true },
      )
      .setTimestamp()
    );
    return true;
  }

  if (raidLockdown && !isWhitelisted(member.id)) {
    await member.ban({ reason: "Anti-raid automatique (lockdown actif)" }).catch(() => null);
    return true;
  }

  return false;
}

export function disableRaidLockdown(): void {
  raidLockdown = false;
  raidRecord = { count: 0, firstAt: Date.now() };
}

export function isRaidLockdown(): boolean { return raidLockdown; }
