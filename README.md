# keepur/hive-plugins

Default plugin registry for [Hive](https://github.com/keepur/hive) — monorepo.

## Packages

| Package | Path | Description |
|---------|------|-------------|
| [`@keepur/hive-plugin-google`](packages/google) | `packages/google` | Gmail + Calendar + Drive via the gog CLI |
| [`@keepur/hive-plugin-linear`](packages/linear) | `packages/linear` | Linear issue tracking |
| [`@keepur/hive-plugin-github`](packages/github) | `packages/github` | GitHub Issues tracking via the gh CLI |

## Install

End users install individual plugins through Hive:

```
hive plugin add @keepur/hive-plugin-google
hive plugin add @keepur/hive-plugin-linear
hive plugin add @keepur/hive-plugin-github
```

See each package's README for required env vars.

## Development

```
npm install                # install all workspaces
npm run build              # build every package
npm run typecheck          # typecheck every package
```

## Publishing

Each package publishes independently to npm under the `@keepur` scope.

- `v<major>.<minor>.<patch>` tags publish **all** packages at the tagged version
- `<package>-v<major>.<minor>.<patch>` tags (e.g. `google-v0.1.1`) publish only that package

CI runs on tag push and uses `NPM_TOKEN` repo secret.

## Curation

This is a **write-gated** registry — only Keepur / dodi-hq maintainers push here.
Third-party plugins should use their own registries or raw-URL dev-mode install;
they will not land here. See the hive CLAUDE.md security posture for rationale.
