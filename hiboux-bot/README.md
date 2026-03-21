# 🦉 Hiboux Bot

Bot Discord de modération pour le serveur Hiboux.

## Variables d'environnement requises

| Variable | Description |
|---|---|
| `DISCORD_BOT_TOKEN` | Le token de ton bot Discord |
| `ROLE_ID` | L'ID du rôle Hiboux+ |

## Démarrage local

```bash
npm install
npm run dev
```

## Déploiement 24h/24 sur Railway (gratuit)

1. Va sur [railway.app](https://railway.app) et connecte-toi avec ton compte GitHub
2. Clique sur **"New Project"** → **"Deploy from GitHub repo"**
3. Sélectionne ton dépôt `hiboux-bot`
4. Une fois déployé, va dans l'onglet **"Variables"** et ajoute :
   - `DISCORD_BOT_TOKEN` = ton token Discord
   - `ROLE_ID` = l'ID du rôle Hiboux+
5. Railway redémarre automatiquement le bot — il sera en ligne 24h/24 !

## Commandes

| Commande | Permission | Description |
|---|---|---|
| `/help` | Tout le monde | Liste des commandes |
| `/règles` | admin | Poste le règlement avec bouton |
| `/ticket-deban` | admin | Poste le panel de demande de déban |
| `/ticket-proposition` | admin | Poste le panel de proposition de stream |
| `/ban @membre [raison]` | Modérateurs+ | Bannir un membre |
| `/unban id [raison]` | Modérateurs+ | Débannir par ID |
| `/kick @membre [raison]` | Modérateurs+ | Expulser un membre |
| `/mute @membre durée unité [raison]` | helper+ | Muter un membre (max 28j) |
| `/unmute @membre` | helper+ | Démuter un membre |
| `/bl @membre [raison]` | admin | Blacklister et bannir |
| `/unbl id` | admin | Retirer de la blacklist |
| `/blcheck` | admin | Voir la blacklist |

## Salons requis sur Discord

| Salon | Usage |
|---|---|
| `⚙️・logs•bans•deban` | Logs des bans/debans/kicks |
| `⚙️・logs•mute•unmute` | Logs des mutes/unmutes |
| `⚙️・logs•bl` | Logs de la blacklist |
| `⚙️・logs•tickets•demande-deban` | Logs des tickets de déban |
| `⚙️・logs・proposition・stream` | Logs des tickets de proposition |
| `✅・suggestions•validé` | Propositions acceptées |

## Niveaux de permission

- 🟢 **helper** — mute / unmute
- 🟡 **Modérateurs** — kick / ban / unban + gestion tickets
- 🔴 **admin** — tout (bl, règles, ticket-deban, ticket-proposition, etc.)
