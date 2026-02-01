# Build stage
FROM node:20-alpine as build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Runtime stage
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001 \
    MQTT_BROKER_URL=mqtt://192.168.0.42 \
    MQTT_TOPIC=/irsensor/motion-detected \
    MQTT_STOP_TOPIC=/irsensor/motion-stopped \
    CAPTURE_DIR=/data/captured_images
RUN apk add --no-cache tini
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
RUN mkdir -p /data/captured_images
VOLUME ["/data"]
EXPOSE 3001
ENTRYPOINT ["/sbin/tini","--"]
CMD ["node","dist/server.js"]
