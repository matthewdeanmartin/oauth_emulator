FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
# Run with tsx (dev dep) — install it explicitly for the runtime.
RUN npm install tsx
EXPOSE 9000
CMD ["npx", "tsx", "src/server.ts"]
