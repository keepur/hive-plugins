# @keepur/hive-plugin-linear

Linear issue tracking for Hive agents — teams, issues, workflow states, cycles.

## Install

```
hive plugin add @keepur/hive-plugin-linear
```

## Env vars

Add to `~/.hive/.env`:

```
LINEAR_API_KEY=lin_api_...   # required
LINEAR_TEAM_ID=...           # optional — agents can discover via linear_list_teams
```

## Curation

Maintained by the Keepur team and distributed via the default
`keepur/hive-plugins` registry. Third-party plugins should use their own
registries.
