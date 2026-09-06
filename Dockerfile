# CAKAP LAH! — production image.
#
# Deliberately boring: no build step, no bundler, no transpile. `npm ci` and
# `node server/index.js` is the whole thing, exactly as it runs locally.
#
# NO SECRETS LIVE HERE. REVOLAB_API_KEY / OPENAI_API_KEY are supplied by the
# platform's environment at run time. Never add an ENV line for a key, and
# never COPY .env — .dockerignore excludes it.

FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /app

# Dependencies first, so a code-only change reuses this layer.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Application code. .dockerignore keeps .env, node_modules, the art source
# files and the build docs out of the image.
COPY server ./server
COPY public ./public
COPY content ./content

# node:* images ship an unprivileged `node` user (uid 1000). Own the app
# directory as that user and drop to it — nothing here needs root.
RUN chown -R node:node /app
USER node

# Documentation only; the platform decides the real port and passes it in.
# server/config.js reads PORT from the environment and falls back to 3000,
# and binds HOST (default 0.0.0.0) so the mapped port is actually reachable.
ENV PORT=3000
EXPOSE 3000

# Node 24 has a healthcheck-friendly fetch built in; no curl in the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
