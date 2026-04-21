FROM node:20-alpine

WORKDIR /app

# Copy package.json dan package-lock.json
COPY package*.json ./

# Tambahkan flag --legacy-peer-deps untuk mengatasi konflik versi Zod
RUN npm ci --omit=dev --legacy-peer-deps

# Salin source code
COPY src ./src



CMD ["node", "src/server.js"]