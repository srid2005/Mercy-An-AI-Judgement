FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .
# tenant.js replays db/*.sql into the `template` schema at runtime (see
# /MULTIPLAYER.md): the seeds must ship in this image, not only in the
# database container's initdb mount.
COPY db ./db

EXPOSE 4008
CMD ["node", "server.js"]
