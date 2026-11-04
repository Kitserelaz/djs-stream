FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates curl gnupg \
    && curl -fsS https://pkg.cloudflareclient.com/pubkey.gpg -o /tmp/cloudflare-warp.gpg \
    && gpg --batch --dearmor -o /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg /tmp/cloudflare-warp.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg] https://pkg.cloudflareclient.com/ bookworm main" > /etc/apt/sources.list.d/cloudflare-client.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends cloudflare-warp \
    && rm -rf /var/lib/apt/lists/* /tmp/cloudflare-warp.gpg

COPY --from=oven/bun:1.3.14 /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .

ENTRYPOINT ["bash", "with-warp.sh"]
CMD ["bun", "run", "test-warp.ts"]
