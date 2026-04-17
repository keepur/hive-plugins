# @keepur/hive-plugin-github

GitHub Issues tracking for Hive agents via the [`gh`](https://cli.github.com) CLI.

## Install

```
hive plugin add @keepur/hive-plugin-github
```

## Env vars

Add to `~/.hive/.env`:

```
GITHUB_REPO=owner/repo   # required (e.g., "keepur/hive")
GH_TOKEN=ghp_...         # optional if the gh CLI is already authed locally
```

## Prereqs

- `gh` CLI installed and authenticated (`gh auth login`), OR `GH_TOKEN` set.

## Curation

Maintained by the Keepur team and distributed via the default
`keepur/hive-plugins` registry. Third-party plugins should use their own
registries.
