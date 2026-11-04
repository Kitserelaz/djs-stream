# djs-stream

To install dependencies:

```bash
bun install
```

To run the collector with WARP (inside the Docker image):

```bash
bash with-warp.sh bun run index.ts
```

Set `token` in the environment before running.

To start the userspace WARP proxy and run the username script through it:

```bash
bash with-warp.sh bun run account-username.ts
```

The Docker image installs [Usque v4.2.1](https://github.com/Diniboy1123/usque/releases/tag/v4.2.1),
an unofficial userspace WARP implementation, plus `curl`, Bash, and Bun. The wrapper
registers when needed, starts Usque's L4 HTTP proxy on `127.0.0.1:40000`, verifies
the tunnel, and exports HTTP proxy variables before starting the supplied command.
It stops if WARP cannot connect and forwards normal shutdown to the command before
stopping the proxy. After startup, it checks the tunnel every five seconds with a
five-second request timeout. If the proxy exits or verification fails, it force
terminates the command and its process group, which can interrupt pending writes.
Discord REST requests, gateway connections, OAuth, profile lookups, and WebDAV
requests explicitly require the local proxy and do not retry directly. This is
application-level protection, not a host firewall. This mode requires outbound UDP
for QUIC but no `NET_ADMIN` or TUN device. Render compatibility still needs verification.

Registration is stored at `/var/lib/usque/config.json`; mount `/var/lib/usque` to
persistent storage to reuse it across container replacements. Treat this file as
a secret.

The Dockerfile installs Usque automatically and prints the Discord account's
username after the wrapper verifies WARP:

```bash
docker build -t djs-stream-warp .
docker run --rm --env-file .env djs-stream-warp
```

Set `token` in `.env`. The default command exits after printing the username.
To run the ipify test instead, use
`docker run --rm djs-stream-warp bun run test-warp.ts`; it prints the public IP
returned by `https://api.ipify.org?format=json` and needs no Discord credentials.

For dashboard login, set `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, and
`MANAGER_USER_ID` to the Discord application credentials and the allowed user's ID.
In the application's Discord OAuth2 settings, register
`https://djs-stream.onrender.com/auth/discord/callback` as a redirect URL. For
local development, set `DISCORD_REDIRECT_URI` to
`http://localhost:3000/auth/discord/callback` and register that URL too. Dashboard
sessions expire after 24 hours or when the app restarts.

Live message events, member joins, and member updates are saved in arrival order
to `logs.json`. Member updates include the old and new member snapshots and update
the server's `members.json`. New member joins and updates are also recorded by
member in `output/<guild-id>/member-history/<member-id>.json`, with the capture
time and snapshots. This history starts when the feature is enabled; changes made
while the app is offline cannot be reconstructed. Archival-style
records are written under `output/<guild-id>/` (or `output/dms/`), with messages
stored by channel. Startup metadata collection and message enrichment are disabled.
Messages use their captured data without fetching users, profiles, invite details,
or reaction users. Media files are not downloaded.
At startup, accessible cached text channels are checked for messages missed since
the previous startup. Existing message archives set the initial boundary for their
channels; other channels begin tracking at startup. Deleted messages and past edits
cannot be recovered.

Unfinished events are saved under `output/checkpoints/events/` and resumed on
restart. Successful profile and metadata requests are cached in checkpoints;
failures are recorded in `output/failures.json`.

WebDAV credentials are read from `WEBDAV_URL`, `WEBDAV_USERNAME`, and
`WEBDAV_PASSWORD` in `.env`. Logs and archive JSON files are uploaded to the
`djs-stream/` folder at that URL. WebDAV is the permanent store; local files are
a temporary cache. On startup, the app downloads and validates the remote JSON
files, including checkpoints, before connecting to Discord. Recovery failure
stops startup without uploading local files. An empty remote archive is initialized
from the available local files.

New events are captured locally and uploaded as pending checkpoints before they
are processed. Checkpoints are removed remotely only after the resulting logs and
archive files have uploaded. Failed uploads pause processing and retry after 30
seconds. Unfinished events resume after a restart even if local files were cleared.
Run one instance per WebDAV archive to avoid concurrent writes.

With the app stopped, run `bun run download-data.ts` to replace the local cache
with the WebDAV archive, or `bun run clear-data.ts` to delete both copies.

`SIGINT` (Ctrl+C) and `SIGTERM` stop Discord collection, cancel active and queued
data requests, and wait for WebDAV uploads before exiting. Interrupted events keep
their remote checkpoints for the next run. Upload failures continue retrying during
shutdown, so exit waits until WebDAV is reachable again.

On hosting with temporary storage, set `token`, `WEBDAV_URL`, `WEBDAV_USERNAME`,
and `WEBDAV_PASSWORD` in the hosting environment; the local `.env` file will not
survive a reset. Events received while offline, or interrupted before their pending
checkpoint reaches WebDAV, cannot be recovered without message history collection.

This project was created using `bun init` in bun v1.3.14. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
