import {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  ChannelType,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  TextChannel,
  type Interaction,
  type Guild,
  type GuildMember,
} from "discord.js";
import { isBlacklisted, addToBlacklist, removeFromBlacklist, getBlacklist } from "./blacklist.js";

const TOKEN = process.env["DISCORD_BOT_TOKEN"];
const ROLE_ID = process.env["ROLE_ID"];

if (!TOKEN) throw new Error("DISCORD_BOT_TOKEN environment variable is required.");
if (!ROLE_ID) throw new Error("ROLE_ID environment variable is required.");

// ── Permission levels ────────────────────────────────────────────────────────
// 1 = helper       → mute / unmute
// 2 = Modérateurs  → kick / ban / unban  (+ level 1)
// 3 = admin        → bl / unbl / blcheck / règles / ticket-deban  (+ levels 1 & 2)

const ROLE_LEVELS: Record<string, number> = {
  "helper": 1,
  "Modérateurs": 2,
  "admin": 3,
};

async function getPermLevel(guild: Guild, userId: string): Promise<number> {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return 0;
  let level = 0;
  for (const [roleName, roleLevel] of Object.entries(ROLE_LEVELS)) {
    const role = guild.roles.cache.find((r) => r.name === roleName);
    if (role && member.roles.cache.has(role.id)) {
      level = Math.max(level, roleLevel);
    }
  }
  return level;
}

async function hasTicketAccess(guild: Guild, userId: string): Promise<boolean> {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return false;
  const accessRoleNames = ["Modérateurs", "admin", "Acces Ticket"];
  return accessRoleNames.some((roleName) => {
    const role = guild.roles.cache.find((r) => r.name === roleName);
    return role ? member.roles.cache.has(role.id) : false;
  });
}

// ── Embed helpers ─────────────────────────────────────────────────────────────
function errEmbed(description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xe74c3c)
    .setDescription(`❌ ${description}`)
    .setTimestamp();
}

function okEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();
}

function successEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setDescription("✅ La commande a été effectuée avec succès.")
    .setTimestamp();
}

function confirmRow(confirmId: string, label: string): ActionRowBuilder<ButtonBuilder> {
  const confirmBtn = new ButtonBuilder()
    .setCustomId(confirmId)
    .setLabel(label)
    .setStyle(ButtonStyle.Danger);
  const cancelBtn = new ButtonBuilder()
    .setCustomId("cancel_confirm")
    .setLabel("❌ Annuler")
    .setStyle(ButtonStyle.Secondary);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(confirmBtn, cancelBtn);
}

// ── In-memory store for proposition ticket data ───────────────────────────────
interface PropositionData {
  nomRencontre: string;
  heure: string;
  chaine: string;
  sport: string;
  userId: string;
  userTag: string;
  userAvatar: string;
}
const propositionCache = new Map<string, PropositionData>();

// ── Client ───────────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel],
});

// ── Commands ─────────────────────────────────────────────────────────────────
const commands = [
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Afficher la liste de toutes les commandes disponibles"),

  new SlashCommandBuilder()
    .setName("règles")
    .setDescription("Envoie le message des règlements du serveur"),

  new SlashCommandBuilder()
    .setName("ticket-deban")
    .setDescription("Poster le panel de demande de déban avec bouton"),

  new SlashCommandBuilder()
    .setName("ticket-proposition")
    .setDescription("Poster le panel de proposition d'ajout de stream"),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Bannir un membre du serveur")
    .addUserOption((o) => o.setName("membre").setDescription("Membre à bannir").setRequired(true))
    .addStringOption((o) => o.setName("raison").setDescription("Raison du ban (optionnel)").setRequired(false)),

  new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Débannir un utilisateur du serveur")
    .addStringOption((o) => o.setName("id").setDescription("ID de l'utilisateur à débannir").setRequired(true))
    .addStringOption((o) => o.setName("raison").setDescription("Raison du déban (optionnel)").setRequired(false)),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Expulser un membre du serveur")
    .addUserOption((o) => o.setName("membre").setDescription("Membre à expulser").setRequired(true))
    .addStringOption((o) => o.setName("raison").setDescription("Raison de l'expulsion (optionnel)").setRequired(false)),

  new SlashCommandBuilder()
    .setName("mute")
    .setDescription("Muter (timeout) un membre")
    .addUserOption((o) => o.setName("membre").setDescription("Membre à muter").setRequired(true))
    .addStringOption((o) =>
      o.setName("duree").setDescription("Valeur de la durée (ex: 10, 30, 2)").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("unite").setDescription("Unité de temps").setRequired(true)
        .addChoices(
          { name: "Secondes", value: "secondes" },
          { name: "Minutes", value: "minutes" },
          { name: "Heures", value: "heures" },
          { name: "Jours", value: "jours" },
        )
    )
    .addStringOption((o) => o.setName("raison").setDescription("Raison du mute (optionnel)").setRequired(false)),

  new SlashCommandBuilder()
    .setName("unmute")
    .setDescription("Retirer le mute d'un membre")
    .addUserOption((o) => o.setName("membre").setDescription("Membre à démuter").setRequired(true)),

  new SlashCommandBuilder()
    .setName("bl")
    .setDescription("Ajouter un utilisateur à la blacklist et le bannir")
    .addUserOption((o) => o.setName("membre").setDescription("Membre à blacklister").setRequired(true))
    .addStringOption((o) => o.setName("raison").setDescription("Raison (optionnel)").setRequired(false)),

  new SlashCommandBuilder()
    .setName("unbl")
    .setDescription("Retirer un utilisateur de la blacklist")
    .addStringOption((o) => o.setName("id").setDescription("ID de l'utilisateur").setRequired(true)),

  new SlashCommandBuilder()
    .setName("blcheck")
    .setDescription("Afficher la liste des utilisateurs blacklistés"),
];

// ── Ready ─────────────────────────────────────────────────────────────────────
client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Bot connecté en tant que ${readyClient.user.tag}`);
  const rest = new REST().setToken(TOKEN!);
  for (const guild of readyClient.guilds.cache.values()) {
    await rest.put(Routes.applicationGuildCommands(readyClient.user.id, guild.id), {
      body: commands.map((c) => c.toJSON()),
    });
  }
  console.log("Commandes slash enregistrées.");
});

// ── Auto-ban blacklisted users on join ────────────────────────────────────────
client.on(Events.GuildMemberAdd, async (member: GuildMember) => {
  if (isBlacklisted(member.id)) {
    await member.ban({ reason: "Utilisateur blacklisté" }).catch(() => null);
    console.log(`Auto-ban: ${member.user.tag} (${member.id}) blacklisté.`);
  }
});

// ── Log helper ────────────────────────────────────────────────────────────────
async function sendLog(guild: Guild, channelName: string, embed: EmbedBuilder): Promise<void> {
  const channel = guild.channels.cache.find((c) => c.name === channelName && c instanceof TextChannel);
  if (channel instanceof TextChannel) {
    await channel.send({ embeds: [embed] }).catch(() => null);
  }
}

// ── Close ticket helper ───────────────────────────────────────────────────────
async function closeTicket(channel: TextChannel, closedBy: string, reason: string): Promise<void> {
  const closeEmbed = new EmbedBuilder()
    .setTitle("🔒 Ticket fermé")
    .setColor(0x95a5a6)
    .addFields(
      { name: "Fermé par", value: closedBy, inline: true },
      { name: "Raison", value: reason, inline: true }
    )
    .setTimestamp();
  await channel.send({ embeds: [closeEmbed] }).catch(() => null);
  setTimeout(() => channel.delete().catch(() => null), 5000);
}

// ── Interactions ──────────────────────────────────────────────────────────────
client.on(Events.InteractionCreate, async (interaction: Interaction) => {

  // ════════════════════════════════════════════════════════════════════════════
  // BUTTONS
  // ════════════════════════════════════════════════════════════════════════════
  if (interaction.isButton()) {
    const { customId, guild } = interaction;

    // ── Annuler une action de confirmation ───────────────────────────────────
    if (customId === "cancel_confirm") {
      await interaction.update({
        embeds: [new EmbedBuilder().setColor(0x95a5a6).setDescription("❌ Action annulée.").setTimestamp()],
        components: [],
      });
      return;
    }

    // ── Bouton: Accepter le règlement ────────────────────────────────────────
    if (customId === "toggle_role_1483614179041738906") {
      if (!guild) {
        await interaction.reply({ embeds: [errEmbed("Cette action n'est pas disponible ici.")], ephemeral: true });
        return;
      }
      const role = guild.roles.cache.get(ROLE_ID!);
      if (!role) {
        await interaction.reply({ embeds: [errEmbed("Rôle introuvable. Vérifiez que ROLE_ID est correct.")], ephemeral: true });
        return;
      }
      const member = await guild.members.fetch(interaction.user.id);
      if (member.roles.cache.has(role.id)) {
        await member.roles.remove(role);
        await interaction.reply({
          embeds: [okEmbed("Rôle retiré", "Le rôle **Hiboux+** t'a été retiré.")],
          ephemeral: true,
        });
      } else {
        await member.roles.add(role);
        await interaction.reply({
          embeds: [okEmbed("Bienvenue chez Hiboux ! 🦉", "Le rôle **Hiboux+** t'a été attribué avec succès.")],
          ephemeral: true,
        });
      }
      return;
    }

    // ── Bouton: Ouvrir formulaire de déban ────────────────────────────────────
    if (customId === "open_ticket_deban") {
      const modal = new ModalBuilder()
        .setCustomId("modal_ticket_deban")
        .setTitle("📋 Demande de déban");

      const pseudoBan = new TextInputBuilder()
        .setCustomId("pseudo_ban")
        .setLabel("Ton Pseudo sur le site ?")
        .setPlaceholder("Ex: MonPseudo")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100);

      const modBan = new TextInputBuilder()
        .setCustomId("mod_ban")
        .setLabel("Qui t'a banni ? (pseudo du modérateur)")
        .setPlaceholder(`Ex: Admin#0001 ou "inconnu"`)
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100);

      const raisonBan = new TextInputBuilder()
        .setCustomId("raison_ban")
        .setLabel("Raison du ban indiquée")
        .setPlaceholder("Ex: Spam, insultes...")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(200);

      const justification = new TextInputBuilder()
        .setCustomId("justification")
        .setLabel("Pourquoi mérites-tu un déban ?")
        .setPlaceholder("Explique ta situation en détail...")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000);

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(pseudoBan),
        new ActionRowBuilder<TextInputBuilder>().addComponents(modBan),
        new ActionRowBuilder<TextInputBuilder>().addComponents(raisonBan),
        new ActionRowBuilder<TextInputBuilder>().addComponents(justification),
      );

      await interaction.showModal(modal);
      return;
    }

    // ── Bouton: Ouvrir formulaire de proposition de stream ────────────────────
    if (customId === "open_ticket_proposition") {
      const modal = new ModalBuilder()
        .setCustomId("modal_ticket_proposition")
        .setTitle("📺 Proposition d'ajout de stream");

      const nomRencontre = new TextInputBuilder()
        .setCustomId("nom_rencontre")
        .setLabel("Nom de la rencontre et de la compétition")
        .setPlaceholder("Ex: PSG vs Real Madrid — Ligue des Champions")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(150);

      const heure = new TextInputBuilder()
        .setCustomId("heure")
        .setLabel("Heure du coup d'envoi")
        .setPlaceholder("Ex: 21h00")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(20);

      const chaine = new TextInputBuilder()
        .setCustomId("chaine")
        .setLabel("Chaîne où la rencontre sera diffusée")
        .setPlaceholder("Ex: Canal+, beIN Sports 1...")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100);

      const sport = new TextInputBuilder()
        .setCustomId("sport")
        .setLabel("Sport")
        .setPlaceholder("Ex: Football, Basketball, Tennis...")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(50);

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(nomRencontre),
        new ActionRowBuilder<TextInputBuilder>().addComponents(heure),
        new ActionRowBuilder<TextInputBuilder>().addComponents(chaine),
        new ActionRowBuilder<TextInputBuilder>().addComponents(sport),
      );

      await interaction.showModal(modal);
      return;
    }

    // ── Bouton: Accepter la demande de déban (confirmation) ───────────────────
    if (customId.startsWith("ticket_accept_")) {
      if (!guild) return;
      if (!(await hasTicketAccess(guild, interaction.user.id))) {
        await interaction.reply({ embeds: [errEmbed("Tu n'as pas la permission d'accepter cette demande.")], ephemeral: true });
        return;
      }
      const channelId = customId.replace("ticket_accept_", "");
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0xf39c12)
          .setTitle("⚠️ Confirmation requise")
          .setDescription("Es-tu sûr(e) de vouloir **accepter** cette demande de déban ?\nCette action fermera le ticket.")
          .setTimestamp()],
        components: [confirmRow(`confirm_deban_accept_${channelId}`, "✅ Oui, accepter")],
        ephemeral: true,
      });
      return;
    }

    // ── Bouton: Refuser la demande de déban (confirmation) ────────────────────
    if (customId.startsWith("ticket_refuse_")) {
      if (!guild) return;
      if (!(await hasTicketAccess(guild, interaction.user.id))) {
        await interaction.reply({ embeds: [errEmbed("Tu n'as pas la permission de refuser cette demande.")], ephemeral: true });
        return;
      }
      const channelId = customId.replace("ticket_refuse_", "");
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0xf39c12)
          .setTitle("⚠️ Confirmation requise")
          .setDescription("Es-tu sûr(e) de vouloir **refuser** cette demande de déban ?\nCette action fermera le ticket.")
          .setTimestamp()],
        components: [confirmRow(`confirm_deban_refuse_${channelId}`, "❌ Oui, refuser")],
        ephemeral: true,
      });
      return;
    }

    // ── Bouton: Fermer le ticket (confirmation) ────────────────────────────────
    if (customId.startsWith("ticket_close_")) {
      if (!guild) return;
      if (!(await hasTicketAccess(guild, interaction.user.id))) {
        await interaction.reply({ embeds: [errEmbed("Seul le staff peut fermer ce ticket.")], ephemeral: true });
        return;
      }
      const channelId = customId.replace("ticket_close_", "");
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0xf39c12)
          .setTitle("⚠️ Confirmation requise")
          .setDescription("Es-tu sûr(e) de vouloir **fermer** ce ticket ?\nLe salon sera supprimé dans 5 secondes.")
          .setTimestamp()],
        components: [confirmRow(`confirm_close_${channelId}`, "🔒 Oui, fermer")],
        ephemeral: true,
      });
      return;
    }

    // ── Confirmer: Accepter déban ─────────────────────────────────────────────
    if (customId.startsWith("confirm_deban_accept_")) {
      if (!guild) return;
      const channel = interaction.channel as TextChannel;
      const acceptEmbed = new EmbedBuilder()
        .setTitle("✅ Demande acceptée")
        .setColor(0x2ecc71)
        .setDescription("La demande de déban a été **acceptée** par l'équipe de modération.\nUn modérateur procédera au déban manuellement.")
        .addFields({ name: "Accepté par", value: interaction.user.tag })
        .setTimestamp();
      await channel.send({ embeds: [acceptEmbed] });
      await interaction.update({
        embeds: [new EmbedBuilder().setColor(0x2ecc71).setDescription("✅ Demande acceptée. Le ticket va se fermer.").setTimestamp()],
        components: [],
      });
      await sendLog(guild, "⚙️・logs•tickets•demande-deban", new EmbedBuilder()
        .setTitle("✅ Demande de déban — Acceptée")
        .setColor(0x2ecc71)
        .addFields(
          { name: "Ticket", value: channel.name, inline: true },
          { name: "Décision prise par", value: interaction.user.tag, inline: true },
          { name: "Résultat", value: "✅ Acceptée", inline: true }
        ).setTimestamp());
      await closeTicket(channel, interaction.user.tag, "Demande acceptée");
      return;
    }

    // ── Confirmer: Refuser déban ──────────────────────────────────────────────
    if (customId.startsWith("confirm_deban_refuse_")) {
      if (!guild) return;
      const channel = interaction.channel as TextChannel;
      const refuseEmbed = new EmbedBuilder()
        .setTitle("❌ Demande refusée")
        .setColor(0xe74c3c)
        .setDescription("Ta demande de déban a été **refusée** par l'équipe de modération.")
        .addFields({ name: "Refusé par", value: interaction.user.tag })
        .setTimestamp();
      await channel.send({ embeds: [refuseEmbed] });
      await interaction.update({
        embeds: [new EmbedBuilder().setColor(0xe74c3c).setDescription("❌ Demande refusée. Le ticket va se fermer.").setTimestamp()],
        components: [],
      });
      await sendLog(guild, "⚙️・logs•tickets•demande-deban", new EmbedBuilder()
        .setTitle("❌ Demande de déban — Refusée")
        .setColor(0xe74c3c)
        .addFields(
          { name: "Ticket", value: channel.name, inline: true },
          { name: "Décision prise par", value: interaction.user.tag, inline: true },
          { name: "Résultat", value: "❌ Refusée", inline: true }
        ).setTimestamp());
      await closeTicket(channel, interaction.user.tag, "Demande refusée");
      return;
    }

    // ── Confirmer: Fermer ticket (déban ou proposition) ───────────────────────
    if (customId.startsWith("confirm_close_")) {
      if (!guild) return;
      const channel = interaction.channel as TextChannel;
      await interaction.update({
        embeds: [new EmbedBuilder().setColor(0x95a5a6).setDescription("🔒 Fermeture du ticket en cours...").setTimestamp()],
        components: [],
      });
      await closeTicket(channel, interaction.user.tag, "Ticket fermé manuellement");
      return;
    }

    // ── Bouton: Accepter proposition (confirmation) ───────────────────────────
    if (customId.startsWith("prop_accept_")) {
      if (!guild) return;
      if (!(await hasTicketAccess(guild, interaction.user.id))) {
        await interaction.reply({ embeds: [errEmbed("Tu n'as pas la permission d'accepter cette proposition.")], ephemeral: true });
        return;
      }
      const channelId = customId.replace("prop_accept_", "");
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0xf39c12)
          .setTitle("⚠️ Confirmation requise")
          .setDescription("Es-tu sûr(e) de vouloir **accepter** cette proposition ?\nLa proposition sera postée dans ✅・suggestions•validé et le ticket se fermera.")
          .setTimestamp()],
        components: [confirmRow(`confirm_prop_accept_${channelId}`, "✅ Oui, accepter")],
        ephemeral: true,
      });
      return;
    }

    // ── Bouton: Refuser proposition (confirmation) ────────────────────────────
    if (customId.startsWith("prop_refuse_")) {
      if (!guild) return;
      if (!(await hasTicketAccess(guild, interaction.user.id))) {
        await interaction.reply({ embeds: [errEmbed("Tu n'as pas la permission de refuser cette proposition.")], ephemeral: true });
        return;
      }
      const channelId = customId.replace("prop_refuse_", "");
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0xf39c12)
          .setTitle("⚠️ Confirmation requise")
          .setDescription("Es-tu sûr(e) de vouloir **refuser** cette proposition ?\nCette action fermera le ticket.")
          .setTimestamp()],
        components: [confirmRow(`confirm_prop_refuse_${channelId}`, "❌ Oui, refuser")],
        ephemeral: true,
      });
      return;
    }

    // ── Confirmer: Accepter proposition ──────────────────────────────────────
    if (customId.startsWith("confirm_prop_accept_")) {
      if (!guild) return;
      const channelId = customId.replace("confirm_prop_accept_", "");
      const channel = interaction.channel as TextChannel;
      const data = propositionCache.get(channelId);

      const acceptEmbed = new EmbedBuilder()
        .setTitle("✅ Proposition acceptée")
        .setColor(0x2ecc71)
        .setDescription("Ta proposition a été **acceptée** par l'équipe !")
        .addFields({ name: "Accepté par", value: interaction.user.tag })
        .setTimestamp();
      await channel.send({ embeds: [acceptEmbed] });
      await interaction.update({
        embeds: [new EmbedBuilder().setColor(0x2ecc71).setDescription("✅ Proposition acceptée et postée dans suggestions-validé. Le ticket va se fermer.").setTimestamp()],
        components: [],
      });

      // Poster dans ✅・suggestions•validé
      const validChannel = guild.channels.cache.find(
        (c) => c.name === "✅・suggestions•validé" && c instanceof TextChannel
      ) as TextChannel | undefined;

      if (validChannel && data) {
        const validEmbed = new EmbedBuilder()
          .setTitle("📺 Nouvelle proposition validée !")
          .setColor(0x2ecc71)
          .setThumbnail(data.userAvatar)
          .addFields(
            { name: "🏆 Rencontre / Compétition", value: data.nomRencontre, inline: false },
            { name: "⏰ Coup d'envoi", value: data.heure, inline: true },
            { name: "📡 Chaîne", value: data.chaine, inline: true },
            { name: "🏅 Sport", value: data.sport, inline: true },
            { name: "👤 Proposé par", value: `<@${data.userId}> (\`${data.userId}\`)`, inline: false }
          )
          .setFooter({ text: `Validé par ${interaction.user.tag}` })
          .setTimestamp();
        await validChannel.send({ embeds: [validEmbed] });
      }

      await sendLog(guild, "⚙️・logs・proposition・stream", new EmbedBuilder()
        .setTitle("✅ Proposition — Acceptée")
        .setColor(0x2ecc71)
        .addFields(
          { name: "Ticket", value: channel.name, inline: true },
          { name: "Décision prise par", value: interaction.user.tag, inline: true },
          { name: "Résultat", value: "✅ Acceptée", inline: true },
          ...(data ? [{ name: "Proposé par", value: `${data.userTag} (\`${data.userId}\`)`, inline: false }] : [])
        ).setTimestamp());
      propositionCache.delete(channelId);
      await closeTicket(channel, interaction.user.tag, "Proposition acceptée");
      return;
    }

    // ── Confirmer: Refuser proposition ───────────────────────────────────────
    if (customId.startsWith("confirm_prop_refuse_")) {
      if (!guild) return;
      const channelId = customId.replace("confirm_prop_refuse_", "");
      const channel = interaction.channel as TextChannel;
      const data = propositionCache.get(channelId);

      const refuseEmbed = new EmbedBuilder()
        .setTitle("❌ Proposition refusée")
        .setColor(0xe74c3c)
        .setDescription("Ta proposition a été **refusée** par l'équipe.")
        .addFields({ name: "Refusé par", value: interaction.user.tag })
        .setTimestamp();
      await channel.send({ embeds: [refuseEmbed] });
      await interaction.update({
        embeds: [new EmbedBuilder().setColor(0xe74c3c).setDescription("❌ Proposition refusée. Le ticket va se fermer.").setTimestamp()],
        components: [],
      });
      await sendLog(guild, "⚙️・logs・proposition・stream", new EmbedBuilder()
        .setTitle("❌ Proposition — Refusée")
        .setColor(0xe74c3c)
        .addFields(
          { name: "Ticket", value: channel.name, inline: true },
          { name: "Décision prise par", value: interaction.user.tag, inline: true },
          { name: "Résultat", value: "❌ Refusée", inline: true },
          ...(data ? [{ name: "Proposé par", value: `${data.userTag} (\`${data.userId}\`)`, inline: false }] : [])
        ).setTimestamp());
      propositionCache.delete(channelId);
      await closeTicket(channel, interaction.user.tag, "Proposition refusée");
      return;
    }

    return;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // MODAL SUBMIT
  // ════════════════════════════════════════════════════════════════════════════

  // ── Modal: Demande de déban ────────────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId === "modal_ticket_deban") {
    const { guild } = interaction;
    if (!guild) return;

    await interaction.deferReply({ ephemeral: true });

    const pseudoBan     = interaction.fields.getTextInputValue("pseudo_ban");
    const modBan        = interaction.fields.getTextInputValue("mod_ban");
    const raisonBan     = interaction.fields.getTextInputValue("raison_ban");
    const justification = interaction.fields.getTextInputValue("justification");

    const safeName = interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 20);
    const channelName = `ticket-deban-${safeName}`;

    const staffRoleNames = ["Modérateurs", "admin", "Acces Ticket"];
    const staffRoles = staffRoleNames
      .map((name) => guild.roles.cache.find((r) => r.name === name))
      .filter(Boolean);

    const permissionOverwrites: any[] = [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: interaction.user.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      },
    ];

    for (const role of staffRoles) {
      if (role) {
        permissionOverwrites.push({
          id: role.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages],
        });
      }
    }

    const category = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase().includes("ticket")
    );

    const ticketChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: category?.id ?? undefined,
      permissionOverwrites,
      topic: `Demande de déban de ${interaction.user.tag} — Pseudo site: ${pseudoBan}`,
    });

    const requestEmbed = new EmbedBuilder()
      .setTitle("📋 Nouvelle demande de déban")
      .setColor(0x5865f2)
      .setThumbnail(interaction.user.displayAvatarURL())
      .addFields(
        { name: "👤 Demandé par", value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: false },
        { name: "🏷️ Pseudo au moment du ban", value: pseudoBan, inline: true },
        { name: "🛡️ Modérateur ayant banni", value: modBan, inline: true },
        { name: "📄 Raison du ban indiquée", value: raisonBan, inline: false },
        { name: "💬 Justification", value: justification, inline: false }
      )
      .setFooter({ text: `Ticket créé le` })
      .setTimestamp();

    const acceptBtn = new ButtonBuilder()
      .setCustomId(`ticket_accept_${ticketChannel.id}`)
      .setLabel("✅ Accepter")
      .setStyle(ButtonStyle.Success);

    const refuseBtn = new ButtonBuilder()
      .setCustomId(`ticket_refuse_${ticketChannel.id}`)
      .setLabel("❌ Refuser")
      .setStyle(ButtonStyle.Danger);

    const closeBtn = new ButtonBuilder()
      .setCustomId(`ticket_close_${ticketChannel.id}`)
      .setLabel("🔒 Fermer")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(acceptBtn, refuseBtn, closeBtn);

    const welcomeEmbed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setDescription(
        `Bonjour <@${interaction.user.id}> ! 👋\n\nTa demande de déban a bien été reçue et sera traitée par notre équipe de modération dans les plus brefs délais.\n\nMerci de patienter et de ne pas envoyer de messages supplémentaires sauf si le staff te le demande.`
      );

    await ticketChannel.send({ embeds: [welcomeEmbed] });
    await ticketChannel.send({ embeds: [requestEmbed], components: [row] });

    const staffMentions = staffRoles.map((r) => `<@&${r!.id}>`).join(" ");
    if (staffMentions) {
      await ticketChannel.send({ content: `${staffMentions} — nouvelle demande de déban à traiter.` });
    }

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setTitle("✅ Demande envoyée !")
        .setColor(0x2ecc71)
        .setDescription(`Ton ticket a été créé : <#${ticketChannel.id}>\n\nL'équipe de modération va examiner ta demande.`)
        .setTimestamp()],
    });

    await sendLog(guild, "⚙️・logs•tickets•demande-deban", new EmbedBuilder()
      .setTitle("📋 Nouvelle demande de déban")
      .setColor(0x5865f2)
      .addFields(
        { name: "Demandé par", value: `${interaction.user.tag} (\`${interaction.user.id}\`)`, inline: true },
        { name: "Ticket", value: `<#${ticketChannel.id}>`, inline: true },
        { name: "Pseudo site à débannir", value: `\`${pseudoBan}\``, inline: true }
      ).setTimestamp());
    return;
  }

  // ── Modal: Proposition de stream ──────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId === "modal_ticket_proposition") {
    const { guild } = interaction;
    if (!guild) return;

    await interaction.deferReply({ ephemeral: true });

    const nomRencontre = interaction.fields.getTextInputValue("nom_rencontre");
    const heure        = interaction.fields.getTextInputValue("heure");
    const chaine       = interaction.fields.getTextInputValue("chaine");
    const sport        = interaction.fields.getTextInputValue("sport");

    const safeName = interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 20);
    const channelName = `prop-stream-${safeName}`;

    const staffRoleNames = ["Modérateurs", "admin", "Acces Ticket"];
    const staffRoles = staffRoleNames
      .map((name) => guild.roles.cache.find((r) => r.name === name))
      .filter(Boolean);

    const permissionOverwrites: any[] = [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: interaction.user.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      },
    ];

    for (const role of staffRoles) {
      if (role) {
        permissionOverwrites.push({
          id: role.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages],
        });
      }
    }

    const category = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase().includes("ticket")
    );

    const ticketChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: category?.id ?? undefined,
      permissionOverwrites,
      topic: `Proposition de stream de ${interaction.user.tag} — ${nomRencontre}`,
    });

    // Stocker les données en mémoire pour les utiliser lors de l'acceptation
    propositionCache.set(ticketChannel.id, {
      nomRencontre,
      heure,
      chaine,
      sport,
      userId: interaction.user.id,
      userTag: interaction.user.tag,
      userAvatar: interaction.user.displayAvatarURL(),
    });

    const requestEmbed = new EmbedBuilder()
      .setTitle("📺 Nouvelle proposition de stream")
      .setColor(0x5865f2)
      .setThumbnail(interaction.user.displayAvatarURL())
      .addFields(
        { name: "👤 Proposé par", value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: false },
        { name: "🏆 Rencontre / Compétition", value: nomRencontre, inline: false },
        { name: "⏰ Heure du coup d'envoi", value: heure, inline: true },
        { name: "📡 Chaîne de diffusion", value: chaine, inline: true },
        { name: "🏅 Sport", value: sport, inline: true },
      )
      .setFooter({ text: `Ticket créé le` })
      .setTimestamp();

    const acceptBtn = new ButtonBuilder()
      .setCustomId(`prop_accept_${ticketChannel.id}`)
      .setLabel("✅ Accepter")
      .setStyle(ButtonStyle.Success);

    const refuseBtn = new ButtonBuilder()
      .setCustomId(`prop_refuse_${ticketChannel.id}`)
      .setLabel("❌ Refuser")
      .setStyle(ButtonStyle.Danger);

    const closeBtn = new ButtonBuilder()
      .setCustomId(`ticket_close_${ticketChannel.id}`)
      .setLabel("🔒 Fermer")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(acceptBtn, refuseBtn, closeBtn);

    const welcomeEmbed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setDescription(
        `Bonjour <@${interaction.user.id}> ! 👋\n\nTa proposition a bien été reçue et sera examinée par notre équipe dans les plus brefs délais.\n\nMerci de patienter !`
      );

    await ticketChannel.send({ embeds: [welcomeEmbed] });
    await ticketChannel.send({ embeds: [requestEmbed], components: [row] });

    const staffMentions = staffRoles.map((r) => `<@&${r!.id}>`).join(" ");
    if (staffMentions) {
      await ticketChannel.send({ content: `${staffMentions} — nouvelle proposition de stream à examiner.` });
    }

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setTitle("✅ Proposition envoyée !")
        .setColor(0x2ecc71)
        .setDescription(`Ton ticket a été créé : <#${ticketChannel.id}>\n\nL'équipe va examiner ta proposition.`)
        .setTimestamp()],
    });

    await sendLog(guild, "⚙️・logs・proposition・stream", new EmbedBuilder()
      .setTitle("📺 Nouvelle proposition de stream")
      .setColor(0x5865f2)
      .addFields(
        { name: "Proposé par", value: `${interaction.user.tag} (\`${interaction.user.id}\`)`, inline: true },
        { name: "Ticket", value: `<#${ticketChannel.id}>`, inline: true },
        { name: "Rencontre", value: nomRencontre, inline: false },
        { name: "Heure", value: heure, inline: true },
        { name: "Chaîne", value: chaine, inline: true },
        { name: "Sport", value: sport, inline: true },
      ).setTimestamp());
    return;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SLASH COMMANDS
  // ════════════════════════════════════════════════════════════════════════════
  if (!interaction.isChatInputCommand()) return;

  const { commandName, guild } = interaction;

  // ── /help (tout le monde) ─────────────────────────────────────────────────
  if (commandName === "help") {
    const embed = new EmbedBuilder()
      .setTitle("📋 Liste des commandes")
      .setColor(3447003)
      .addFields(
        {
          name: "📚 Règlement",
          value: "`/règles` — Envoie l'embed des règlements avec le bouton d'acceptation *(admin)*",
        },
        {
          name: "🎫 Tickets",
          value: [
            "`/ticket-deban` — Poster le panel de demande de déban *(admin)*",
            "`/ticket-proposition` — Poster le panel de proposition d'ajout de stream *(admin)*",
          ].join("\n"),
        },
        {
          name: "🔨 Modération",
          value: [
            "`/ban @membre [raison]` — Bannir un membre *(Modérateurs+)*",
            "`/unban id` — Débannir un utilisateur par son ID *(Modérateurs+)*",
            "`/kick @membre [raison]` — Expulser un membre *(Modérateurs+)*",
            "`/mute @membre duree unite [raison]` — Timeout (secondes / minutes / heures / jours, max 28 j) *(helper+)*",
            "`/unmute @membre` — Retirer le timeout *(helper+)*",
          ].join("\n"),
        },
        {
          name: "🚫 Blacklist",
          value: [
            "`/bl @membre [raison]` — Blacklister et bannir *(admin)*",
            "`/unbl id` — Retirer de la blacklist *(admin)*",
            "`/blcheck` — Voir la liste des blacklistés *(admin)*",
          ].join("\n"),
        },
        {
          name: "🦉 Bouton interactif",
          value: "Cliquer sur **🦉・Accepter le règlement** donne ou retire le rôle Hiboux+",
        },
        {
          name: "ℹ️ Niveaux de permission",
          value: [
            "🟢 **helper** — mute / unmute",
            "🟡 **Modérateurs** — kick / ban / unban + gestion tickets (+ helper)",
            "🔴 **admin** — bl / unbl / blcheck / règles / ticket-deban / ticket-proposition (+ tous)",
          ].join("\n"),
        },
        {
          name: "⚙️ Salons de logs",
          value: [
            "`⚙️・logs•tickets•demande-deban` — Logs tickets déban",
            "`⚙️・logs・proposition・stream` — Logs tickets proposition",
            "`✅・suggestions•validé` — Propositions acceptées",
          ].join("\n"),
        }
      )
      .setFooter({ text: "Hiboux Bot • Les champs [optionnel] ne sont pas obligatoires" })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (!guild) return;

  const permLevel = await getPermLevel(guild, interaction.user.id);
  const noPerm = errEmbed("Tu n'as pas la permission d'utiliser cette commande.");

  // ── /ticket-deban (admin) ─────────────────────────────────────────────────
  if (commandName === "ticket-deban") {
    if (permLevel < 3) { await interaction.reply({ embeds: [noPerm], ephemeral: true }); return; }

    const embed = new EmbedBuilder()
      .setTitle("⚖️ Demande de déban")
      .setColor(0x5865f2)
      .setDescription(
        "Tu as été banni de notre site et tu penses que c'est injuste ?\n\n" +
        "Clique sur le bouton ci-dessous pour ouvrir un formulaire et soumettre ta demande de déban à l'équipe de modération.\n\n" +
        "**⚠️ Attention :**\n" +
        "• Sois honnête dans ta demande — les fausses informations seront sanctionnées.\n" +
        "• Le staff prendra sa décision de manière définitive.\n" +
        "• Ne crée pas plusieurs tickets pour la même demande."
      )
      .setFooter({ text: "Hiboux Bot • Système de tickets" })
      .setTimestamp();

    const btn = new ButtonBuilder()
      .setCustomId("open_ticket_deban")
      .setLabel("📋 Faire une demande de déban")
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(btn);
    await interaction.reply({ embeds: [embed], components: [row] });
    await interaction.followUp({ embeds: [okEmbed("Succès", "Le panel de demande de déban a été posté.")], ephemeral: true });
    return;
  }

  // ── /ticket-proposition (admin) ───────────────────────────────────────────
  if (commandName === "ticket-proposition") {
    if (permLevel < 3) { await interaction.reply({ embeds: [noPerm], ephemeral: true }); return; }

    const embed = new EmbedBuilder()
      .setTitle("📺 Proposition d'ajout de stream")
      .setColor(0x5865f2)
      .setDescription(
        "Tu souhaites proposer un match ou un événement sportif à streamer ?\n\n" +
        "Clique sur le bouton ci-dessous pour remplir le formulaire de proposition.\n\n" +
        "**⚠️ Attention :**\n" +
        "• Assure-toi que la rencontre n'est pas déjà proposée.\n" +
        "• Vérifie les informations avant d'envoyer (heure, chaîne, etc.).\n" +
        "• L'équipe étudiera ta proposition et te donnera une réponse."
      )
      .setFooter({ text: "Hiboux Bot • Système de propositions" })
      .setTimestamp();

    const btn = new ButtonBuilder()
      .setCustomId("open_ticket_proposition")
      .setLabel("📺 Faire une proposition")
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(btn);
    await interaction.reply({ embeds: [embed], components: [row] });
    await interaction.followUp({ embeds: [okEmbed("Succès", "Le panel de proposition de stream a été posté.")], ephemeral: true });
    return;
  }

  // ── /règles (admin) ───────────────────────────────────────────────────────
  if (commandName === "règles") {
    if (permLevel < 3) { await interaction.reply({ embeds: [noPerm], ephemeral: true }); return; }

    const embed = new EmbedBuilder()
      .setTitle("📚・règlements")
      .setDescription(
        `*Ceci est une liste non exauhstive, toutes ces règles sont logiques,\nsi un membre du staff remarque une dérive hors des règles, il peut tout de même intervenir*

**Règle 1 :**
 *Le spam, flood et spam mentions sont interdits.*

**Règle 2 :**
*Tout comportement inapproprié, incluant harcèlement, discrimination, provocation ou toxicité, est strictement interdit. Il en va de même pour les propos racistes, sexistes et blasphématoires*

**Règle 3 :**
*Tout contenu NSFW, gore, lié au piratage, aux scams, aux scripts malveillants ou aux discussions illégales est prohibé.*

**Règle 4 :**
*Aucune pub n'est autorisée, sauf dérogation spéciale du Staff . Il en va de même pour les pubs mp*

**Règle 5 :**
*Évitez le "ghost ping", c'est-à-dire mentionner quelqu'un puis supprimer le message. Il en va de même de mentionner des gens de façon aléatoire.*

**Règle 6 :**
*Si il y a un problème, contactez le staff immédiatement afin de ne pas empirer la situation.*

**Règle 7 :**
*Respectez le but des channels.*

** ⚠️・ Attention sachez ceci:**
*Tout manquement à ces règles sera sanctionné.
Le respect strict de ces règles est essentiel au bon fonctionnement du serveur, nous comptons sur votre sérieux et votre bons sens des responsabilités, merci 🙏*

**Veuillez cliquer sur le bouton ci-dessous pour accéder au serveur et pour recevoir le rôle Hiboux +**
🦉 - <@&${ROLE_ID}>`
      )
      .setColor(3447003);

    const button = new ButtonBuilder()
      .setCustomId("toggle_role_1483614179041738906")
      .setLabel("🦉・Accepter le règlement")
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);
    await interaction.reply({ embeds: [embed], components: [row] });
    await interaction.followUp({ embeds: [okEmbed("Succès", "Le règlement a été posté avec succès.")], ephemeral: true });
    return;
  }

  // ── /ban (Modérateurs+) ───────────────────────────────────────────────────
  if (commandName === "ban") {
    if (permLevel < 2) { await interaction.reply({ embeds: [noPerm], ephemeral: true }); return; }

    const target = interaction.options.getUser("membre", true);
    const raison = interaction.options.getString("raison") ?? "Aucune raison fournie";
    const member = await guild.members.fetch(target.id).catch(() => null);

    if (!member) { await interaction.reply({ embeds: [errEmbed("Membre introuvable sur ce serveur.")], ephemeral: true }); return; }
    if (!member.bannable) { await interaction.reply({ embeds: [errEmbed("Je ne peux pas bannir ce membre (permissions insuffisantes).")], ephemeral: true }); return; }

    await member.ban({ reason: raison });
    const banEmbed = new EmbedBuilder().setTitle("🔨 Membre banni").setColor(0xff0000)
      .addFields(
        { name: "Utilisateur", value: target.tag, inline: true },
        { name: "ID", value: `\`${target.id}\``, inline: true },
        { name: "Modérateur", value: interaction.user.tag, inline: true },
        { name: "Raison", value: raison }
      ).setTimestamp();
    await interaction.reply({ embeds: [successEmbed()], ephemeral: true });
    await sendLog(guild, "⚙️・logs•bans•deban", banEmbed);
    return;
  }

  // ── /unban (Modérateurs+) ─────────────────────────────────────────────────
  if (commandName === "unban") {
    if (permLevel < 2) { await interaction.reply({ embeds: [noPerm], ephemeral: true }); return; }

    const id = interaction.options.getString("id", true);
    let unbanned = false;
    await guild.bans.remove(id).then(() => { unbanned = true; }).catch(async () => {
      await interaction.reply({ embeds: [errEmbed("Impossible de débannir cet utilisateur. Vérifiez l'ID.")], ephemeral: true });
    });

    if (unbanned) {
      const unbanEmbed = new EmbedBuilder().setTitle("✅ Membre débanni").setColor(0x2ecc71)
        .addFields(
          { name: "ID", value: `\`${id}\``, inline: true },
          { name: "Modérateur", value: interaction.user.tag, inline: true }
        ).setTimestamp();
      await interaction.reply({ embeds: [successEmbed()], ephemeral: true });
      await sendLog(guild, "⚙️・logs•bans•deban", unbanEmbed);
    }
    return;
  }

  // ── /kick (Modérateurs+) ──────────────────────────────────────────────────
  if (commandName === "kick") {
    if (permLevel < 2) { await interaction.reply({ embeds: [noPerm], ephemeral: true }); return; }

    const target = interaction.options.getUser("membre", true);
    const raison = interaction.options.getString("raison") ?? "Aucune raison fournie";
    const member = await guild.members.fetch(target.id).catch(() => null);

    if (!member) { await interaction.reply({ embeds: [errEmbed("Membre introuvable sur ce serveur.")], ephemeral: true }); return; }
    if (!member.kickable) { await interaction.reply({ embeds: [errEmbed("Je ne peux pas expulser ce membre (permissions insuffisantes).")], ephemeral: true }); return; }

    await member.kick(raison);
    const kickEmbed = new EmbedBuilder().setTitle("👢 Membre expulsé").setColor(0xe67e22)
      .addFields(
        { name: "Utilisateur", value: target.tag, inline: true },
        { name: "ID", value: `\`${target.id}\``, inline: true },
        { name: "Modérateur", value: interaction.user.tag, inline: true },
        { name: "Raison", value: raison }
      ).setTimestamp();
    await interaction.reply({ embeds: [successEmbed()], ephemeral: true });
    await sendLog(guild, "⚙️・logs•bans•deban", kickEmbed);
    return;
  }

  // ── /mute (helper+) ───────────────────────────────────────────────────────
  if (commandName === "mute") {
    if (permLevel < 1) { await interaction.reply({ embeds: [noPerm], ephemeral: true }); return; }

    const target = interaction.options.getUser("membre", true);
    const dureeRaw = interaction.options.getString("duree", true);
    const unite = interaction.options.getString("unite", true);
    const raison = interaction.options.getString("raison") ?? "Aucune raison fournie";

    const valeur = parseInt(dureeRaw, 10);
    if (isNaN(valeur) || valeur < 1) {
      await interaction.reply({ embeds: [errEmbed("La durée doit être un nombre entier positif.")], ephemeral: true });
      return;
    }

    const msMap: Record<string, number> = {
      secondes: 1_000,
      minutes:  60_000,
      heures:   3_600_000,
      jours:    86_400_000,
    };
    const totalMs = valeur * msMap[unite];
    const maxMs = 28 * 24 * 3_600_000;

    if (totalMs > maxMs) {
      await interaction.reply({ embeds: [errEmbed("La durée maximale d'un timeout est de **28 jours**.")], ephemeral: true });
      return;
    }

    const dureeLabel = `${valeur} ${unite}`;
    const member = await guild.members.fetch(target.id).catch(() => null);

    if (!member) { await interaction.reply({ embeds: [errEmbed("Membre introuvable sur ce serveur.")], ephemeral: true }); return; }
    if (!member.moderatable) { await interaction.reply({ embeds: [errEmbed("Je ne peux pas muter ce membre (permissions insuffisantes).")], ephemeral: true }); return; }

    await member.timeout(totalMs, raison);
    const muteEmbed = new EmbedBuilder().setTitle("🔇 Membre muté").setColor(0xff9900)
      .addFields(
        { name: "Utilisateur", value: target.tag, inline: true },
        { name: "ID", value: `\`${target.id}\``, inline: true },
        { name: "Modérateur", value: interaction.user.tag, inline: true },
        { name: "Durée", value: dureeLabel, inline: true },
        { name: "Raison", value: raison }
      ).setTimestamp();
    await interaction.reply({ embeds: [successEmbed()], ephemeral: true });
    await sendLog(guild, "⚙️・logs•mute•unmute", muteEmbed);
    return;
  }

  // ── /unmute (helper+) ─────────────────────────────────────────────────────
  if (commandName === "unmute") {
    if (permLevel < 1) { await interaction.reply({ embeds: [noPerm], ephemeral: true }); return; }

    const target = interaction.options.getUser("membre", true);
    const member = await guild.members.fetch(target.id).catch(() => null);

    if (!member) { await interaction.reply({ embeds: [errEmbed("Membre introuvable sur ce serveur.")], ephemeral: true }); return; }

    await member.timeout(null);
    const unmuteEmbed = new EmbedBuilder().setTitle("🔊 Membre démuté").setColor(0x2ecc71)
      .addFields(
        { name: "Utilisateur", value: target.tag, inline: true },
        { name: "ID", value: `\`${target.id}\``, inline: true },
        { name: "Modérateur", value: interaction.user.tag, inline: true }
      ).setTimestamp();
    await interaction.reply({ embeds: [successEmbed()], ephemeral: true });
    await sendLog(guild, "⚙️・logs•mute•unmute", unmuteEmbed);
    return;
  }

  // ── /bl (admin) ───────────────────────────────────────────────────────────
  if (commandName === "bl") {
    if (permLevel < 3) { await interaction.reply({ embeds: [noPerm], ephemeral: true }); return; }

    const target = interaction.options.getUser("membre", true);
    const raison = interaction.options.getString("raison") ?? "Aucune raison fournie";

    addToBlacklist({ id: target.id, tag: target.tag, raison, addedAt: new Date().toISOString(), addedBy: interaction.user.tag });

    const member = await guild.members.fetch(target.id).catch(() => null);
    if (member?.bannable) await member.ban({ reason: `Blacklisté : ${raison}` });

    const blEmbed = new EmbedBuilder().setTitle("🚫 Utilisateur blacklisté").setColor(0x8b0000)
      .addFields(
        { name: "Utilisateur", value: target.tag, inline: true },
        { name: "ID", value: `\`${target.id}\``, inline: true },
        { name: "Modérateur", value: interaction.user.tag, inline: true },
        { name: "Raison", value: raison }
      ).setTimestamp();
    await interaction.reply({ embeds: [successEmbed()], ephemeral: true });
    await sendLog(guild, "⚙️・logs•bl", blEmbed);
    return;
  }

  // ── /unbl (admin) ─────────────────────────────────────────────────────────
  if (commandName === "unbl") {
    if (permLevel < 3) { await interaction.reply({ embeds: [noPerm], ephemeral: true }); return; }

    const id = interaction.options.getString("id", true);
    const removed = removeFromBlacklist(id);

    if (!removed) {
      await interaction.reply({ embeds: [errEmbed(`Aucun utilisateur avec l'ID \`${id}\` trouvé dans la blacklist.`)], ephemeral: true });
      return;
    }

    const unblEmbed = new EmbedBuilder().setTitle("✅ Utilisateur retiré de la blacklist").setColor(0x2ecc71)
      .addFields(
        { name: "ID", value: `\`${id}\``, inline: true },
        { name: "Modérateur", value: interaction.user.tag, inline: true }
      ).setTimestamp();
    await interaction.reply({ embeds: [successEmbed()], ephemeral: true });
    await sendLog(guild, "⚙️・logs•bl", unblEmbed);
    return;
  }

  // ── /blcheck (admin) ──────────────────────────────────────────────────────
  if (commandName === "blcheck") {
    if (permLevel < 3) { await interaction.reply({ embeds: [noPerm], ephemeral: true }); return; }

    const list = getBlacklist();
    if (list.length === 0) {
      await interaction.reply({ embeds: [okEmbed("🚫 Blacklist", "La blacklist est actuellement vide.")], ephemeral: true });
      return;
    }

    const embed = new EmbedBuilder().setTitle("🚫 Blacklist").setColor(0x8b0000)
      .setDescription(
        list.map((e, i) =>
          `**${i + 1}.** ${e.tag} (\`${e.id}\`)\n> Raison : ${e.raison}\n> Ajouté par : ${e.addedBy} le ${new Date(e.addedAt).toLocaleDateString("fr-FR")}`
        ).join("\n\n")
      )
      .setFooter({ text: `${list.length} utilisateur(s) blacklisté(s)` })
      .setTimestamp();
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }
});

client.login(TOKEN);
