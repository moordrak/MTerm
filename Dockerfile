FROM node:22-alpine

LABEL org.opencontainers.image.title="MTerm" \
      org.opencontainers.image.description="Web terminal (SSH) i upravitelj datoteka (SFTP, SCP, FTP, FTPS, WebDAV)" \
      org.opencontainers.image.source="https://github.com/moordrak/MTerm" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
    PORT=8080

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY server ./server
COPY public ./public

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:${PORT}/api/health || exit 1

CMD ["node", "server/index.js"]
