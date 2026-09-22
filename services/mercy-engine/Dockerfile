FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .
# db/ must be in the image, next to server.js: the database container seeds
# `public` from it, but tenant.js replays it from /app/db into `template`
# for every participant's schema (see /MULTIPLAYER.md)
COPY db ./db

EXPOSE 4010
CMD ["node", "server.js"]
