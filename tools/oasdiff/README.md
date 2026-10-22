# tools/oasdiff

`oasdiff.sh` runs [oasdiff](https://github.com/oasdiff/oasdiff) at a pinned version via `go run`,
so no binary is committed and no unofficial npm repackaging is used. Requires Go on PATH
(GitHub's `ubuntu-latest` runners have it).

```sh
tools/oasdiff/oasdiff.sh breaking <base.yaml> <revision.yaml> --fail-on ERR
```
