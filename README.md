# newest-whatsapp-proto

**`proto-fetcher`** — zero-dependency CLI, um die **neueste WhatsApp-Proto**-Definition zu holen, die mit
[WhiskeySockets/Baileys](https://github.com/WhiskeySockets/Baileys) ausgeliefert wird — z. B. um ein älteres
Baileys (etwa `v7.0.0-rc14`) mit der aktuellsten Proto zu patchen.

## Warum gibt es das?

Baileys' eigenes `proto-extract`-Tool liest die Proto-Definition **live aus dem WhatsApp-Web-JS** aus. Ein
täglicher GitHub-Action-Bot aktualisiert damit den `master`-Branch (`WAProto/WAProto.proto` + generiertes
`index.js`/`index.d.ts`). Releases (z. B. `v7.0.0-rc14`) einfrieren diesen Stand aber oft für Wochen.

```
master (täglich aktuell)  ──>  Release-Tag (z. B. v7.0.0-rc14)  ──>  npm (@whiskeysockets/baileys)
        ▲                                ▲
        └── hier ist die NEUESTE proto   └── hier ist die eingefrorene
```

`proto-fetcher` holt die Proto von **beiden** Quellen und patcht deine Installation auf Wunsch direkt.

## Setup

```bash
npm i -g .        # optional: als globales binary
# oder direkt:
node bin/proto-fetcher.js <command>
```

Node ≥ 18. Keine Abhängigkeiten.

## Commands

### `list` — was gibt es?

```bash
proto-fetcher list -n 10
```

Zeigt npm dist-tags (`latest`, `legacy`) + die neuesten GitHub-Tags.

### `info` — was ist drin?

```bash
proto-fetcher info 7.0.0-rc14     # npm-Release
proto-fetcher info master         # täglich aktueller Stand
proto-fetcher info latest         # npm dist-tag "latest"
proto-fetcher info bb0a87e0326c   # beliebiger Commit
```

Zeigt WhatsApp-Version (aus dem Proto-Header), Anzahl Messages/Enums, Größe, sha256.

### `get` — Proto (und Artefakte) laden

```bash
proto-fetcher get 7.0.0-rc14 --all          # .proto + index.js + index.d.ts
proto-fetcher get master                    # nur die .proto (frischeste!)
proto-fetcher get latest -o ./my-protos
```

Landet unter `protos/<version>/` inkl. `meta.json` (Quelle, Ref, Commit, sha256, WA-Version).

### `diff` — was hat sich geändert?

```bash
proto-fetcher diff 6.7.24 7.0.0-rc14
proto-fetcher diff 7.0.0-rc14            # default Ziel: master
```

Zeigt WA-Version-Delta und hinzugefügte/entfernte/geänderte Top-Level-`message`/`enum`-Definitionen.
Z. B. 6.7.24 → 7.0.0-rc14: **+36 messages** (AI-Rich-Response, Bot-Message-Origin, …).

### `update` — Baileys die neueste Proto geben ⭐

```bash
# node_modules-Install patchen (z. B. dein Projekt):
proto-fetcher update ./my-project/node_modules/@whiskeysockets/baileys

# oder ein Baileys-Checkout:
proto-fetcher update ./Baileys

# nur anschauen:
proto-fetcher update ./Baileys --dry-run

# Quelle wählen (default: master = neueste proto):
proto-fetcher update ./Baileys --source 7.0.0-rc14
proto-fetcher update ./Baileys --source latest
```

Überschreibt `WAProto/WAProto.proto`, `WAProto/index.js`, `WAProto/index.d.ts` mit den Artefakten der
gewählten Quelle und legt vorher ein Backup unter `.proto-fetcher-backup-<timestamp>/` an
(`--no-backup` zum Deaktivieren). Standardquelle `master` ist die **neueste** Proto inklusive der dort
von Baileys' eigener Pipeline gebauten Artefakte — du brauchst keine protobuf-Toolchain.

Mit `--rebuild` werden `index.js`/`index.d.ts` stattdessen aus der geladenen `.proto` neu generiert
(pbjs/pbts via `protobufjs-cli@1.2.0` + Baileys' eigenes `fix-imports.js` — identisch zu deren
`GenerateStatics.sh`). Nützlich, wenn du die `.proto` von Hand anpassen willst.

## Ref-Auflösung

| Eingabe | Quelle |
|---|---|
| `7.0.0-rc14`, `v7.0.0-rc.9`, `6.7.24` | npm-Paket (Tarball, keine Rate-Limits) |
| `latest` / `legacy` | npm dist-tags |
| `master`, `newest` | GitHub `master`-Branch (frischeste Proto, täglicher Bot) |
| jeder GitHub-Tag (`v7.0.0-rc10`, …) | GitHub-Tag-Tarball |
| Commit-SHA (7–40 hex) | GitHub-Snapshot |

Tag-Namen werden normalisiert (`rc14` ↔ `rc.14`) und unbekannte Refs bekommen Vorschläge („Did you mean…?“).

## Hinweise

- **Kompatibilität:** Eine neuere Proto kann Felder umbenennen/entfernen, die dein Code oder deine
  Baileys-Version benutzt → kann brechen. Das Backup ist dein Freund; `diff` vorher schadet nie.
- **TLS/Proxies:** In Netzwerken mit TLS-Interception (Corporate Proxy) weicht der Fetcher automatisch auf
  das OS-CA-Bundle aus.
- **GitHub-API:** `list`/Auflösung nutzen wenige unauthentifizierte API-Calls (~60/h Limit). Downloads
  laufen über Tarballs (npm/codeload) ohne API-Limit.

## Tests

```bash
npm test    # node --test (Tar-Parser, Proto-Parser, Diff, Arg-Parsing, Tag-Sortierung)
```

## License

MIT — siehe [LICENSE](LICENSE).
