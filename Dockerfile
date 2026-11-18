FROM node:24-bookworm-slim

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci && chown -R node:node /app

COPY --chown=node:node next.config.ts next-env.d.ts tsconfig.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
RUN mkdir .next && chown node:node .next

USER node
EXPOSE 3010
CMD ["node", "node_modules/next/dist/bin/next", "dev", "--hostname", "0.0.0.0", "--port", "3010"]
