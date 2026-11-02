# djs-stream

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

Set `token` in the environment before running.

Live message events, member joins, and member updates are saved in arrival order
to `logs.json`. Member updates include the old and new member snapshots and update
the server's `members.json`. Archival-style
records are written under `output/<guild-id>/` (or `output/dms/`): messages by
channel, authors, mentioned users, all users, external invites, and server metadata.
Server metadata includes channels, threads, members, roles, emojis, stickers, and
templates, collected on startup. Message history and media files are not fetched.
Profiles are fetched only when processing message events; startup metadata uses
the user information already available without requesting profiles.

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
