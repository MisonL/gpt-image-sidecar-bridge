FROM node:20-alpine

WORKDIR /app

COPY package.json README.md ./
COPY src ./src

ENV HOST=0.0.0.0
ENV PORT=3099

EXPOSE 3099

USER node

CMD ["node", "src/server.mjs"]
