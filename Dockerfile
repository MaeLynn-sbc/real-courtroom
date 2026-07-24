FROM node:lts-alpine
ENV NODE_ENV=production
# Every "date-only" value in this app assumes the process timezone is
# Asia/Manila (UTC+8, no DST) — see lib/env.ts's boot-time assertion and
# BUILD-SPEC.md §0. Set here so the image is correct by default, not
# dependent on an external .env file being present/correct on the host.
ENV TZ=Asia/Manila
WORKDIR /usr/src/app
COPY ["package.json", "package-lock.json*", "npm-shrinkwrap.json*", "./"]
RUN npm install --production --silent && mv node_modules ../
COPY . .
EXPOSE 3000
RUN chown -R node /usr/src/app
USER node
CMD ["npm", "start"]
