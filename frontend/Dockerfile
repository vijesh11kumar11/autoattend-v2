# syntax=docker/dockerfile:1.7
# ──────────────────────────────────────────────────────────────────────
# AutoAttend AI — web frontend (Vite + React)
# Multi-stage: build with Node, serve static assets with nginx.
# ──────────────────────────────────────────────────────────────────────
# Build:  docker build -t autoattend-frontend ./frontend
# Run:    docker run --rm -p 8080:80 autoattend-frontend
#   VITE_API_BASE_URL can be baked at build:
#   docker build --build-arg VITE_API_BASE_URL=https://api.example.com ...
# ──────────────────────────────────────────────────────────────────────

FROM node:20-alpine AS builder
WORKDIR /app

ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# ── runtime stage ─────────────────────────────────────────────────────
FROM nginx:1.27-alpine

# SPA-friendly default: route everything to index.html so React Router works.
RUN printf 'server {\n\
  listen 80;\n\
  server_name _;\n\
  root /usr/share/nginx/html;\n\
  index index.html;\n\
  location / { try_files $uri $uri/ /index.html; }\n\
  location ~* \\.(?:js|css|woff2?|ttf|otf|eot|svg|png|jpg|jpeg|gif|ico|webp)$ {\n\
    expires 30d;\n\
    add_header Cache-Control "public, max-age=2592000, immutable";\n\
  }\n\
}\n' > /etc/nginx/conf.d/default.conf

COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q -O- http://127.0.0.1/ >/dev/null || exit 1
