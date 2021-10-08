FROM node:14-alpine

LABEL version="1.0"
LABEL description="Base docker image for LatestEarthquakesPH back-end"
LABEL maintainer=["cpsanchez@science.upd.edu.ph"]

RUN apk add dumb-init
ENV NODE_ENV production
WORKDIR /app
COPY --chown=node:node package*.json ./
RUN npm ci --only=production
COPY --chown=node:node . ./

EXPOSE 5000

USER node
CMD ["dumb-init", "node", "index.js"]




