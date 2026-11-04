FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates curl unzip \
    && mkdir /tmp/usque \
    && cd /tmp/usque \
    && curl -fSL "https://github.com/Diniboy1123/usque/releases/download/v4.2.1/usque_4.2.1_linux_$(dpkg --print-architecture).zip" -O \
    && curl -fSL https://github.com/Diniboy1123/usque/releases/download/v4.2.1/checksums.txt -O \
    && sha256sum --check --ignore-missing checksums.txt \
    && unzip '*.zip' \
    && install -m 755 usque /usr/local/bin/usque \
    && rm -rf /var/lib/apt/lists/* /tmp/usque

COPY --from=oven/bun:1.3.14 /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .

ENTRYPOINT ["bash", "with-warp.sh"]
CMD ["bun", "run", "account-username.ts"]
