FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PATH="/usr/local/bin:$PATH"

# ⚡ Installer toutes les dépendances en une seule couche pour réduire les couches Docker
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      wget gnupg ca-certificates libgconf-2-4 \
      fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf \
      libxss1 libx11-xcb1 libxtst6 lsb-release \
      curl unzip git g++ cmake pkg-config libssl-dev python3 \
      build-essential patch ruby-dev zlib1g-dev liblzma-dev libxml2-dev libxslt1-dev \
      nodejs npm \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google.list \
    && apt-get update && apt-get install -y --no-install-recommends google-chrome-stable \
    && curl -fsSL https://deno.land/x/install/install.sh | DENO_INSTALL=/usr/local sh \
    && gem install licensed \
    && rm -rf /var/lib/apt/lists/*

# 📂 Préparer le dossier de travail
WORKDIR /metrics/source/app/action

# Copier les fichiers de l’app dans le container
COPY . .

# Rendre le script principal exécutable
RUN chmod +x index.mjs

# Installer les modules Node.js et builder l’app
RUN npm ci && npm run build
