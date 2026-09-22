FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .
# The seeds are not only the database container's init scripts: tenant.js
# replays db/*.sql into the `template` schema from inside this image, so
# they must be here at /app/db whatever .dockerignore comes to exclude.
COPY db ./db

EXPOSE 4011
CMD ["node", "server.js"]
