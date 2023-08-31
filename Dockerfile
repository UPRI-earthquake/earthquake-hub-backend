# Stage 1: base, minimal setup for dev, shall contain non-js deps.
#          To be bind-mounted to local dev files (includint node_modules)
FROM node:18-alpine as base

EXPOSE 5000

WORKDIR /app

# add non-js deps (for deps other than node_modules)
RUN apk add --no-cache python3 make g++

# Stage 2: prod, inherits base, adds src code, pre-installs js deps
# TODO: Test for production build
FROM base as prod

RUN apk add dumb-init

# install node modules
ENV NODE_ENV production
COPY --chown=node:node package*.json ./
RUN npm ci --only=production --loglevel=verbose

# copy codebase
COPY --chown=node:node ./src ./src

USER node
CMD ["dumb-init", "npm", "run", "start"]

LABEL org.opencontainers.image.source="https://github.com/UPRI-earthquake/earthquake-hub-backend"
LABEL org.opencontainers.image.description="Base docker image for EarthquakeHub backend"
LABEL org.opencontainers.image.authors="earthquake@science.upd.edu.ph"


