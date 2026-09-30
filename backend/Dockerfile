FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY src ./src
COPY tests ./tests

EXPOSE 4000

CMD ["node", "src/server.js"]
