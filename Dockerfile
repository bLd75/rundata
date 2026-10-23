# The MCP server over stdio, as directories that run servers in a container (Glama) start it.
# The public server needs nothing of this: it runs on Cloudflare Workers at https://rundata.re/mcp.
# Optional: METEOFRANCE_APPLICATION_ID or METEOFRANCE_API_KEY adds the Météo-France stations, vigilance and radar.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
ENTRYPOINT ["node", "dist/bin/stdio.js"]
