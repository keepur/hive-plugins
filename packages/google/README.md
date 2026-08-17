# @keepur/hive-plugin-google

Gmail, Calendar, and Drive access for Hive agents via the [`gog`](https://github.com/dodi-hq/gog) CLI.

## Capabilities

- Gmail: search/read messages and threads, send, reply, forward messages, attachments, labels/tags, filters, forwarding addresses, auto-forwarding, and destructive batch deletes with confirmation.
- Calendar: list calendars, search events, create/update/delete events (incl. transparency, recurrence, all-day), and check free/busy.
- Drive: upload, download/export, and list files from a configured shared folder.

## Install

```
hive plugin add @keepur/hive-plugin-google
```

## Env vars

Add to `~/.hive/.env`:

```
GOG_ACCOUNTS=you@example.com,ops@example.com  # optional CSV; first account is default
GOG_ACCOUNT=you@example.com                   # legacy single-account fallback
GOG_CLIENT=personal                           # gog OAuth client name
DRIVE_SHARED_FOLDER=folder-id                 # optional shared Drive folder for Drive tools
```

## Prereqs

- `gog` CLI installed and authenticated (`gog auth login <account>`).
- Gmail scopes must cover the actions you expose to agents, especially settings/filter/forwarding management.
- Forwarding filters and auto-forwarding require verified Gmail forwarding addresses.

## Curation

This plugin is maintained by the Keepur team and distributed via the default
`keepur/hive-plugins` registry. Third-party plugins should use their own
registries.
