FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl xvfb xauth x11vnc tini gosu \
    && curl -fsSL https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o /tmp/chrome.deb \
    && apt-get install -y --no-install-recommends /tmp/chrome.deb \
    && rm /tmp/chrome.deb && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts
COPY scripts/container-entrypoint.sh /usr/local/bin/ebay-entrypoint
RUN chmod +x /usr/local/bin/ebay-entrypoint && mkdir /data && chown node:node /data
ENV HOST=0.0.0.0 PORT=3001 EBAY_CHROME_EXECUTABLE=/usr/bin/google-chrome EBAY_CHROME_PROFILE=/data/chrome DISPLAY=:99
EXPOSE 3001 5900
ENTRYPOINT ["/usr/bin/tini", "-s", "--", "/usr/local/bin/ebay-entrypoint"]
CMD ["node", "dist/main.js"]
