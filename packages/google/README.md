# @keepur/hive-plugin-google

Gmail + Calendar access for Hive agents via the [`gog`](https://github.com/dodi-hq/gog) CLI.

## Install

```
hive plugin add @keepur/hive-plugin-google
```

## Env vars

Add to `~/.hive/.env`:

```
GOG_ACCOUNT=you@example.com      # default Google account
GOG_CLIENT=personal              # gog OAuth client name
```

## Prereqs

- `gog` CLI installed and authenticated (`gog auth login <account>`).

## Curation

This plugin is maintained by the Keepur team and distributed via the default
`keepur/hive-plugins` registry. Third-party plugins should use their own
registries.
