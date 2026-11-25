# House twin for Docker (works on a Raspberry Pi 4/5, arm64, and on amd64). No npm install needed.
FROM node:22-alpine
WORKDIR /app
COPY server ./server
COPY web ./web
COPY package.json LICENSE ./
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:8787/api/config >/dev/null || exit 1
CMD ["node", "server/node.js"]
