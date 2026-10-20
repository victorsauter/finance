# syntax=docker/dockerfile:1

# Build the Vite application separately so the runtime image only contains
# static assets and Nginx.
FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# nginxinc/nginx-unprivileged listens on 8080 and runs as a non-root user.
FROM nginxinc/nginx-unprivileged:1.28-alpine

COPY --chown=nginx:nginx nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --chown=nginx:nginx --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

USER nginx
