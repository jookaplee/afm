# JOOSONS dashboard server: the API, the built dashboard, the WhatsApp webhook
# and the AI agents. Keep /data on a persistent volume (SQLite database and the
# imported prospect list). Configuration is by environment variables (README).
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production \
    PORT=3001 \
    DB_PATH=/data/afm.db \
    DATASET_PATH=/data/import/crm-dataset.json
VOLUME /data
EXPOSE 3001
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.ts"]
