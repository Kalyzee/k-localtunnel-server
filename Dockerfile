# ---------- STAGE 1 : BUILD ----------
FROM node:20 AS builder

# Création du répertoire de travail
WORKDIR /app

# Copier uniquement package.json et yarn.lock pour installer les deps
COPY package.json yarn.lock ./

# Installer toutes les dépendances (dev + prod) pour builder
RUN yarn install

# Copier tout le code source (TS + JS)
COPY . .

# Builder le projet
RUN yarn build

# ---------- STAGE 2 : IMAGE FINALE ----------
FROM node:20

# Créer le répertoire de travail
WORKDIR /app

# Copier uniquement les fichiers buildés depuis le stage builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/bin ./bin

# Installer uniquement les dépendances de production
RUN yarn install --production --frozen-lockfile && yarn cache clean

# Commande par défaut
CMD ["node", "./bin/server"]