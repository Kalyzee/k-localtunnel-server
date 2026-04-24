# k-localtunnel-server

Serveur de tunnel auto-heberge permettant d'exposer des services locaux sur internet. Supporte trois modes de tunneling :

- **HTTP** : accessible via sous-domaine `<id>.tunnel.exemple.com`
- **TCP** : accessible via un port TCP public assigne
- **UDP** : accessible via un port UDP public assigne, avec framing par session

Les clients se connectent au serveur, et le serveur integre :
- un systeme d'**API keys** (stockees en base MongoDB, hashees en SHA-256)
- un systeme d'**autorisation par filtres regex** (persistes en Mongo ou en memoire) avec support d'**autorisation temporaire** (auto-revocation a une date donnee)
- une **interface d'administration web** (onglets Dashboard / API Keys)
- un mecanisme SSE pour controler en temps reel quels clients sont autorises a se connecter

## Prerequis

- Node.js >= 18
- Yarn
- Un domaine avec un wildcard DNS (`*.tunnel.example.com`) pointant vers le serveur
- Une instance MongoDB si `--auth-required` est active ou si tu veux persister les filtres

## Installation

```bash
git clone https://github.com/Kalyzee/k-localtunnel-server.git
cd k-localtunnel-server
yarn install
yarn build
```

## Demarrage

```bash
# Demarrage simple sans auth (filtres en memoire)
yarn start --port 3000 --domain tunnel.exemple.com

# Demarrage avec auth par API keys (Mongo requis)
yarn start \
  --port 3000 \
  --domain tunnel.exemple.com \
  --secure \
  --auth-required true \
  --mongo-uri "mongodb://user:pwd@localhost:27017/localtunnel?authSource=admin" \
  --admin-username admin \
  --admin-password secret \
  --default-filters '[{"pattern":"^device-","authorized":true,"priority":10}]' \
  --max-sockets 10

# Demarrage sans auth mais avec filtres persistes en Mongo
yarn start \
  --port 3000 \
  --domain tunnel.exemple.com \
  --mongo-uri "mongodb://localhost:27017/localtunnel" \
  --admin-username admin \
  --admin-password secret

# Mode developpement (hot-reload)
yarn dev
```

## Configuration

Toutes les options sont disponibles en CLI (`--option`) ou en variable d'environnement.

| CLI | Env | Default | Description |
|-----|-----|---------|-------------|
| `--port` | `PORT` | `80` | Port d'ecoute du serveur |
| `--address` | `ADDRESS` | `0.0.0.0` | Adresse IP de bind |
| `--domain` | `DOMAIN` | - | Domaine de base (requis pour le routage par sous-domaine) |
| `--secure` | `SECURE` | `false` | Indique que le serveur est derriere un proxy HTTPS |
| `--landing` | `LANDING` | - | URL de redirection pour la page d'accueil |
| `--auth-required` | `AUTH_REQUIRED` | `false` | Si `true`, les clients doivent presenter une API key valide via `x-lt-auth`. Necessite `--mongo-uri`. |
| `--mongo-uri` | `MONGO_URI` | - | URI de connexion MongoDB. Obligatoire si `--auth-required`. Si defini sans auth, les filtres sont quand meme persistes en Mongo. |
| `--admin-username` | `ADMIN_USERNAME` | - | Nom d'utilisateur pour l'interface admin (Basic Auth) |
| `--admin-password` | `ADMIN_PASSWORD` | - | Mot de passe pour l'interface admin (Basic Auth) |
| `--default-filters` | `DEFAULT_FILTERS` | - | Filtres d'autorisation par defaut (JSON, voir ci-dessous). En mode Mongo, uniquement seeds la collection si elle est vide. |
| `--max-sockets` | `MAX_SOCKETS` | `10` | Nombre maximum de sockets par client (fallback global) |
| `--max-http-sockets` | `MAX_HTTP_SOCKETS` | - | Limite de sockets pour les tunnels HTTP (sinon `max-sockets`) |
| `--max-tcp-sockets` | `MAX_TCP_SOCKETS` | - | Limite de sockets pour les tunnels TCP (sinon `max-sockets`) |
| `--max-udp-sockets` | `MAX_UDP_SOCKETS` | - | Limite de sockets pour les tunnels UDP (sinon `max-sockets`) |
| `--unique-port-tcp-server` | `UNIQUE_PORT_TCP_SERVER` | - | Port TCP unique partage (port dynamique par defaut) |

Le client peut aussi demander une limite via le parametre `max_conn` dans le handshake. La valeur effective est le minimum entre la demande du client et la limite serveur pour le type concerne.

## Types de tunnel

### HTTP (defaut)

Le client expose un service HTTP local. Le tunnel est accessible via un sous-domaine :
- Acces externe : `https://device-1.tunnel.exemple.com`
- Les sockets du pool sont recyclees apres chaque requete HTTP

### TCP

Le client expose un service TCP local (base de donnees, serveur custom, etc.). Le serveur ouvre un port TCP public :
- Acces externe : `tcp://tunnel.exemple.com:25000`
- Chaque connexion externe consomme une socket du pool pour toute sa duree
- Le port peut etre specifie par le client (`tcp_port`) ou assigne automatiquement par l'OS

### UDP

Le client expose un service UDP local (DNS, jeu, streaming, etc.). Le serveur ouvre un port UDP public :
- Acces externe : `udp://tunnel.exemple.com:25000`
- Les datagrams sont encapsules dans un protocole de framing sur le tunnel TCP : `[type:1][headerLen:2][payloadLen:2][header JSON][payload]`
- Chaque source IP:port externe cree une "session" qui consomme une socket du pool
- Les sessions expirent apres 30 secondes d'inactivite
- Le port peut etre specifie par le client (`udp_port`) ou assigne automatiquement par l'OS

## API Keys

Quand `--auth-required=true`, les clients doivent presenter une API key via le header `x-lt-auth`. Les cles sont gerees en base MongoDB.

### Format de cle

```
key_<objectId>_<data>
```

- `<objectId>` : ObjectId MongoDB (24 caracteres hex) identifiant le document
- `<data>` : 32 octets aleatoires encodes en base64url

Seul le hash SHA-256 de `<data>` est stocke en base. La comparaison est en temps constant (`crypto.timingSafeEqual`).

### Champs d'une cle

| Champ | Description |
|-------|-------------|
| `name` | Nom libre pour identifier la cle |
| `active` | Si `false`, la cle est refusee meme valide |
| `expiresAt` | Date d'expiration optionnelle (`null` = pas d'expiration) |
| `usageCount` | Nombre d'appels authentifies reussis |
| `lastUsedAt` | Horodatage du dernier appel authentifie |
| `lastIp` | IP du dernier appel (via `req.ip`) |

Les champs `usageCount`, `lastUsedAt`, `lastIp` sont mis a jour en fire-and-forget sur chaque requete authentifiee.

### Creation d'une cle

Via l'onglet **API Keys** de l'interface admin, ou en API :

```bash
curl -u admin:secret -X POST \
  -H "Content-Type: application/json" \
  -d '{"name":"device-1","expiresAt":"2026-12-31T23:59:00Z"}' \
  https://tunnel.exemple.com/api/keys
```

La reponse contient la cle en clair dans le champ `key` — **elle n'est jamais reaffichee** apres.

## Systeme d'autorisation par filtres

L'autorisation des tunnels repose sur des **filtres regex avec priorite**. Quand un client demande a ouvrir un tunnel, son ID est teste contre les filtres. Le premier filtre qui matche (priorite la plus haute en premier) determine si l'acces est autorise ou refuse. Si aucun filtre ne matche, l'acces est refuse.

Les filtres sont :
- Persistes en MongoDB quand `--mongo-uri` est defini
- Conserves en memoire sinon (perdus au restart)

Dans les deux cas, un cache en memoire est utilise pour `isIdAuthorized()` — le chemin chaud ne frappe pas la base.

### Filtres par defaut

Definis au demarrage via `--default-filters` ou `DEFAULT_FILTERS`. En mode Mongo, ils ne sont seeds que si la collection `filters` est vide (pour ne pas ecraser les modifications admin).

```bash
DEFAULT_FILTERS='[
  {"pattern": "^device-", "authorized": true, "priority": 10},
  {"pattern": ".*", "authorized": false, "priority": 0}
]'
```

Chaque filtre contient :
- `pattern` : expression reguliere testee contre l'ID du tunnel
- `authorized` : `true` pour autoriser, `false` pour refuser
- `priority` (optionnel, defaut `0`) : plus la valeur est grande, plus le filtre est evalue en premier. Supporte les decimaux.

### Autorisation temporaire (`allowUntil`)

Un filtre autorise peut etre marque comme **temporaire** via le champ `allowUntil` (ISO date). A l'echeance :
- Un `setTimeout` cote serveur bascule automatiquement le filtre en `authorized: false` et remet `allowUntil` a `null`
- Les tunnels actifs qui dependent de ce filtre sont fermes (via re-evaluation SSE)
- Les timers sont re-armes au redemarrage du serveur, donc un restart ne "perd" pas les expirations en cours

Utilisation typique : "autoriser `^device-42$` pendant 1 heure pour un debug".

Cote admin :
- Un clic sur le bouton `allow` d'un filtre `deny` ouvre une modal `[duree] [minutes/heures/jours]` + checkbox `Permanent`
- Une chip `⏱ 42m left (15h04:48)` affiche le temps restant a cote du badge `Allow`
- Cliquer sur la chip permet de prolonger ou de rendre permanent

### Gestion dynamique via API

Les filtres peuvent etre ajoutes, modifies et supprimes a chaud via l'API admin. Toute modification re-evalue immediatement tous les tunnels connectes : si un tunnel actif n'est plus autorise, il est coupe cote serveur.

## Interface d'administration

Accessible sur `/admin`, protegee par Basic Auth (`admin-username` / `admin-password`). Structuree en deux onglets :

### Onglet Dashboard

- **Filtres** : voir, ajouter, modifier (pattern, priorite, allow/deny, `allowUntil`), supprimer. Priorite et pattern editables au clic. Chip de compte a rebours pour les allow temporaires.
- **Tunnels** : voir en temps reel (polling 2s) les tunnels en attente/connectes avec leur ID, endpoint, target locale, type (HTTP/TCP/UDP), statut d'autorisation, statut de connexion et nombre de sockets. Champ de filtre regex avec compteur affiche/total.

### Onglet API Keys

- Formulaire de creation (nom + date d'expiration optionnelle)
- Modal de revelation one-shot avec bouton copier a la creation
- Liste des cles : nom (renommable au clic), statut (active/inactive/expiree), date d'expiration (editable au clic), compteur d'utilisation, last used (relatif), last IP, actions (activer/desactiver, supprimer)

## Flux de connexion

```
1. Le client se connecte en SSE au serveur avec ses IDs
   GET /api/sse?ids=device-1,device-2
   Header: x-lt-auth: key_<objectId>_<data>   (si --auth-required)

2. Le serveur :
   - Verifie l'API key via le hash stocke en Mongo (si requis)
   - Evalue chaque ID contre les filtres
   - Envoie un event SSE pour chaque ID :
     data: {"id":"device-1","authorized":true}
     data: {"id":"device-2","authorized":false}

3. Pour les IDs autorises, le client demande l'ouverture du tunnel :
   GET /?new
   Header: x-lt-client-id: device-1
   Header: x-lt-auth: <meme API key>

4. Le serveur verifie l'autorisation, cree le tunnel
   et retourne les informations de connexion TCP

5. Le client ouvre les sockets TCP vers le serveur
   - HTTP : accessible sur https://device-1.tunnel.exemple.com
   - TCP : accessible sur tcp://tunnel.exemple.com:<port>
   - UDP : accessible sur udp://tunnel.exemple.com:<port>

6. Si un admin modifie un filtre (via /admin ou API),
   ou si un allow temporaire expire automatiquement,
   les IDs sont re-evalues en temps reel :
   - Nouvelle autorisation → event SSE authorized:true
   - Revocation → event SSE authorized:false + tunnel coupe cote serveur
```

## API REST

### Endpoints client (proteges par `x-lt-auth` si `--auth-required`)

| Methode | Endpoint | Description |
|---------|----------|-------------|
| `GET` | `/?new` | Creer un tunnel HTTP. Header `x-lt-client-id` pour specifier l'ID |
| `GET` | `/?new&type=tcp&tcp_port=25000` | Creer un tunnel TCP (port optionnel) |
| `GET` | `/?new&type=udp&udp_port=25000` | Creer un tunnel UDP (port optionnel) |
| `GET` | `/api/sse?ids=id1,id2` | Connexion SSE pour recevoir les events d'autorisation |

### Endpoints admin (proteges par Basic Auth)

| Methode | Endpoint | Description |
|---------|----------|-------------|
| `GET` | `/admin` | Interface d'administration web |
| `GET` | `/api/filters` | Lister tous les filtres (tries par priorite) |
| `POST` | `/api/filters` | Ajouter un filtre `{pattern, authorized, priority?, allowUntil?}` |
| `PUT` | `/api/filters/:id` | Modifier un filtre `{pattern?, authorized?, priority?, allowUntil?}` |
| `DELETE` | `/api/filters/:id` | Supprimer un filtre |
| `GET` | `/api/tunnels/pending` | Lister les tunnels connectes en SSE avec leur statut |
| `GET` | `/api/keys` | Lister toutes les API keys (sans le hash ni la cle) |
| `POST` | `/api/keys` | Creer une API key `{name, expiresAt?}`. Retourne `{..., key}` en clair (une seule fois) |
| `PATCH` | `/api/keys/:id` | Modifier une API key `{name?, active?, expiresAt?}` |
| `DELETE` | `/api/keys/:id` | Supprimer une API key |

### Exemples curl

```bash
# Lister les filtres
curl -u admin:secret https://tunnel.exemple.com/api/filters

# Ajouter un filtre allow temporaire (1h)
curl -u admin:secret -X POST \
  -H "Content-Type: application/json" \
  -d "{\"pattern\":\"^test-\",\"authorized\":true,\"priority\":50,\"allowUntil\":\"$(date -u -d '+1 hour' +%FT%TZ)\"}" \
  https://tunnel.exemple.com/api/filters

# Modifier un filtre (ex: changer la priorite)
curl -u admin:secret -X PUT \
  -H "Content-Type: application/json" \
  -d '{"priority":99.5}' \
  https://tunnel.exemple.com/api/filters/<id>

# Creer une API key
curl -u admin:secret -X POST \
  -H "Content-Type: application/json" \
  -d '{"name":"device-1"}' \
  https://tunnel.exemple.com/api/keys
# → {"id":"...","name":"device-1","key":"key_<oid>_<data>",...}

# Desactiver une API key
curl -u admin:secret -X PATCH \
  -H "Content-Type: application/json" \
  -d '{"active":false}' \
  https://tunnel.exemple.com/api/keys/<id>

# Voir les tunnels en attente
curl -u admin:secret https://tunnel.exemple.com/api/tunnels/pending
```

## Docker

### Build

```bash
yarn docker-image-build
# ou
docker build -t k-localtunnel-server .
```

### Run

```bash
docker run -d \
  --restart always \
  --name localtunnel \
  --net host \
  -e PORT=3000 \
  -e DOMAIN=tunnel.exemple.com \
  -e SECURE=true \
  -e AUTH_REQUIRED=true \
  -e MONGO_URI="mongodb://user:pwd@mongo:27017/localtunnel?authSource=admin" \
  -e ADMIN_USERNAME=admin \
  -e ADMIN_PASSWORD=secret \
  -e DEFAULT_FILTERS='[{"pattern":"^device-","authorized":true,"priority":10}]' \
  k-localtunnel-server
```

## Utilisation programmatique

```js
import { createTunnelInstance } from 'k-localtunnel-server';

const instance = createTunnelInstance({
  domain: 'tunnel.exemple.com',
  secure: true,
  authRequired: true,
  mongoUri: 'mongodb://user:pwd@localhost:27017/localtunnel?authSource=admin',
  adminUsername: 'admin',
  adminPassword: 'secret',
  maxTcpSockets: 10,
  defaultFilters: [
    { pattern: '^device-', authorized: true, priority: 10 },
    { pattern: '.*', authorized: false, priority: 0 },
  ],
});

// `ready()` connecte Mongo (si necessaire) et initialise les stores.
// Doit etre appele avant server.listen().
await instance.ready();

instance.server.listen(3000, () => {
  console.log('Tunnel server listening on port 3000');
});
```

L'instance retournee expose :
- `server` : le `http.Server` a mettre en ecoute
- `getClients()` : liste des IDs de tunnels actuellement connectes
- `apiKeyStore` : instance de `ApiKeyStore` (ou `null` si `authRequired=false`)
- `filterStore` : instance de `FilterStore` (toujours present)
- `ready()` : a await avant `server.listen()`

## Scripts

| Script | Description |
|--------|-------------|
| `yarn start` | Demarrer le serveur |
| `yarn dev` | Demarrer en mode developpement (hot-reload) |
| `yarn build` | Compiler le TypeScript |
| `yarn clean` | Supprimer le dossier `dist/` |
| `yarn test` | Lancer les tests |
| `yarn docker-image-build` | Build l'image Docker |
| `yarn docker-image-push` | Push l'image Docker |
| `yarn docker-image-build-push` | Build + push |

## Licence

MIT
