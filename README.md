# k-localtunnel-server

Serveur de tunnel auto-heberge permettant d'exposer des services locaux sur internet. Supporte trois modes de tunneling :

- **HTTP** : accessible via sous-domaine `<id>.tunnel.exemple.com`
- **TCP** : accessible via un port TCP public assigne
- **UDP** : accessible via un port UDP public assigne, avec framing par session

Les clients se connectent au serveur, et le serveur integre un systeme d'autorisation par filtres regex, une interface d'administration web, et un mecanisme SSE pour controler en temps reel quels clients sont autorises a se connecter.

## Prerequis

- Node.js >= 18
- Yarn
- Un domaine avec un wildcard DNS (`*.tunnel.example.com`) pointant vers le serveur

## Installation

```bash
git clone https://github.com/Kalyzee/k-localtunnel-server.git
cd k-localtunnel-server
yarn install
yarn build
```

## Demarrage

```bash
# Demarrage simple
yarn start --port 3000 --domain tunnel.exemple.com

# Demarrage avec toutes les options
yarn start \
  --port 3000 \
  --domain tunnel.exemple.com \
  --secure \
  --auth-key "ma-cle-client" \
  --admin-username admin \
  --admin-password secret \
  --default-filters '[{"pattern":"^device-","authorized":true,"priority":10}]' \
  --max-sockets 5

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
| `--auth-key` | `AUTH_KEY` | - | Cle d'authentification pour les clients. Si non definie, pas d'auth requise |
| `--admin-username` | `ADMIN_USERNAME` | - | Nom d'utilisateur pour l'interface admin (Basic Auth) |
| `--admin-password` | `ADMIN_PASSWORD` | - | Mot de passe pour l'interface admin (Basic Auth) |
| `--default-filters` | `DEFAULT_FILTERS` | - | Filtres d'autorisation par defaut (JSON, voir ci-dessous) |
| `--max-sockets` | `MAX_SOCKETS` | `2` | Nombre maximum de sockets TCP par client |
| `--unique-port-tcp-server` | `UNIQUE_PORT_TCP_SERVER` | - | Port TCP unique partage (port dynamique par defaut) |

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

## Systeme d'autorisation

L'autorisation des tunnels repose sur des **filtres regex avec priorite**. Quand un client demande a ouvrir un tunnel, son ID est teste contre les filtres. Le premier filtre qui matche (priorite la plus haute en premier) determine si l'acces est autorise ou refuse. Si aucun filtre ne matche, l'acces est refuse.

### Filtres par defaut

Definis au demarrage via `--default-filters` ou `DEFAULT_FILTERS` :

```bash
# Autoriser tous les IDs commencant par "device-", refuser le reste
DEFAULT_FILTERS='[
  {"pattern": "^device-", "authorized": true, "priority": 10},
  {"pattern": ".*", "authorized": false, "priority": 0}
]'

# Autoriser tout le monde
DEFAULT_FILTERS='[{"pattern": ".*", "authorized": true}]'
```

Chaque filtre contient :
- `pattern` : expression reguliere testee contre l'ID du tunnel
- `authorized` : `true` pour autoriser, `false` pour refuser
- `priority` (optionnel, defaut `0`) : plus la valeur est grande, plus le filtre est evalue en premier. Supporte les decimaux.

### Gestion dynamique via API

Les filtres peuvent etre ajoutes, modifies et supprimes a chaud via l'API admin. Toute modification re-evalue immediatement tous les tunnels connectes : si un tunnel actif n'est plus autorise, il est coupe cote serveur.

## Interface d'administration

Accessible sur `/admin`, protegee par Basic Auth (`admin-username` / `admin-password`).

Fonctionnalites :
- **Filtres** : voir, ajouter, modifier (pattern, priorite, allow/deny), supprimer les filtres d'autorisation. Priorite et pattern editables en cliquant dessus.
- **Tunnels** : voir en temps reel (polling 2s) les tunnels en attente/connectes avec leur ID, endpoint, target locale, type (HTTP/TCP/UDP), statut d'autorisation, statut de connexion et nombre de sockets. Pour les tunnels TCP : connexions externes/sockets. Pour les tunnels UDP : sessions actives/sockets.

## Flux de connexion

```
1. Le client se connecte en SSE au serveur avec ses IDs
   GET /api/sse?ids=device-1,device-2
   Header: x-lt-auth: <auth-key>

2. Le serveur evalue chaque ID contre les filtres
   et envoie un event SSE pour chaque ID :
   data: {"id":"device-1","authorized":true}
   data: {"id":"device-2","authorized":false}

3. Pour les IDs autorises, le client demande l'ouverture du tunnel :
   GET /?new
   Header: x-lt-client-id: device-1

4. Le serveur verifie l'autorisation, cree le tunnel
   et retourne les informations de connexion TCP

5. Le client ouvre les sockets TCP vers le serveur
   - HTTP : accessible sur https://device-1.tunnel.exemple.com
   - TCP : accessible sur tcp://tunnel.exemple.com:<port>
   - UDP : accessible sur udp://tunnel.exemple.com:<port>

6. Si un admin modifie un filtre (via /admin ou API),
   les IDs sont re-evalues en temps reel :
   - Nouvelle autorisation → event SSE authorized:true
   - Revocation → event SSE authorized:false + tunnel coupe cote serveur
```

## API REST

### Endpoints client (proteges par `x-lt-auth`)

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
| `POST` | `/api/filters` | Ajouter un filtre `{pattern, authorized, priority}` |
| `PUT` | `/api/filters/:id` | Modifier un filtre `{pattern?, authorized?, priority?}` |
| `DELETE` | `/api/filters/:id` | Supprimer un filtre |
| `GET` | `/api/tunnels/pending` | Lister les tunnels connectes en SSE avec leur statut |

### Exemples curl

```bash
# Lister les filtres
curl -u admin:secret https://tunnel.exemple.com/api/filters

# Ajouter un filtre
curl -u admin:secret -X POST \
  -H "Content-Type: application/json" \
  -d '{"pattern":"^test-","authorized":true,"priority":50}' \
  https://tunnel.exemple.com/api/filters

# Modifier un filtre (ex: changer la priorite)
curl -u admin:secret -X PUT \
  -H "Content-Type: application/json" \
  -d '{"priority":99.5}' \
  https://tunnel.exemple.com/api/filters/1

# Supprimer un filtre
curl -u admin:secret -X DELETE \
  https://tunnel.exemple.com/api/filters/1

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
  -e AUTH_KEY=ma-cle-client \
  -e ADMIN_USERNAME=admin \
  -e ADMIN_PASSWORD=secret \
  -e DEFAULT_FILTERS='[{"pattern":".*","authorized":true}]' \
  k-localtunnel-server
```

## Utilisation programmatique

```js
import { createTunnelInstance } from 'k-localtunnel-server';

const { server, getClients } = createTunnelInstance({
  domain: 'tunnel.exemple.com',
  secure: true,
  authKey: 'ma-cle-client',
  adminUsername: 'admin',
  adminPassword: 'secret',
  maxTcpSockets: 10,
  defaultFilters: [
    { pattern: '^device-', authorized: true, priority: 10 },
    { pattern: '.*', authorized: false, priority: 0 },
  ],
});

server.listen(3000, () => {
  console.log('Tunnel server listening on port 3000');
});
```

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
