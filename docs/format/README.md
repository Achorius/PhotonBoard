# The PhotonBoard show format (.pbshow) — open, documented, yours

*Français plus bas · [Version française](#le-format-de-show-photonboard-pbshow)*

A PhotonBoard show is a plain **UTF-8 JSON** file with the `.pbshow` extension. Nothing is
compressed, encrypted or binary: any program — another console, a visualiser, a paperwork tool,
a script — can read and write it. The format is described by a **JSON Schema**
([`photonboard-show.schema.json`](photonboard-show.schema.json), draft 2020-12) and implemented in
[`src/shared/show-format.ts`](../../src/shared/show-format.ts) (`normalizeShow()`), which is the
reference reader. Shows are never locked in: File › Export… also writes them to CSV and to the other
open formats PhotonBoard supports (see [docs/import-export.md](../import-export.md)).

## Versions

| `version` | PhotonBoard | What changed |
|---|---|---|
| `"1.0.0"` | ≤ 0.1 | first format (carried the DMX output settings, now ignored) |
| `"2"` | 1.0 | executor layout, timeline track names; outputs are machine settings |
| `"3"` | 1.1 + | pro programming: object numbers, preset scopes, cue timing per feature and parts, executor pages, macros, speed masters, stage pages, park, group masters |

Every v3 field is **optional**, and a v3 file keeps the v2 fields up to date (cue values hold the
resolved DMX value even when they reference a preset; `executor.grid` mirrors page 1), so
PhotonBoard 1.0 still plays a v3 show.

## Rules for readers and writers

- **Ignore unknown properties**, and keep them if you can (a newer PhotonBoard may have written them).
- **Missing property = default.** PhotonBoard fills every default (see `normalizeShow`); numbers are clamped
  to their range, malformed entries are dropped with a warning — a file is never rejected for a detail.
- **Ids** are strings, unique within their list (UUIDs in practice). References use ids:
  `Group.fixtureIds` → patch entries, `CueChannelValue.fixtureId` → patch entries,
  `CueChannelValue.presetId` → presets, `TimelineClip.cuelistId` → cuelists, executor cells → any object.
- **Object numbers** (`fid` of a fixture, `number` of groups, sequences, chases, effects, macros, speed masters,
  and presets *per family*) are positive integers, unique per list (per family for presets).
- **Runtime state is not content**: `isPlaying`, `currentCueIndex`, `flash`, `isRunning`… are written as
  stopped (`false`, `-1`) and ignored on load. Loading a show never starts anything.

## Units and conventions

| Value | Unit / range |
|---|---|
| `universe` | 0-based (0-15); the UI shows universe 1-16 |
| `address` | 1-512, the fixture's start address |
| DMX values (`value`, preset values, `faderLevel`, `depth`) | 0-255 integers (8-bit; fine channels are separate channels) |
| times (`fadeIn`, `fadeOut`, `delay`, `followTime`, `fade`) | seconds (`followTime: null` = manual GO) |
| `position3D` | metres; origin = stage centre at floor level; `x` left (−, the `wall-left` side) → right (+), `y` height, `z` downstage (−) → upstage (+) |
| `rotation3D` | radians; `mountingAngle`, `mountingPan`, `beamAngle`: degrees |
| `speed` (effects) | Hz; `bpm` (chases, speed masters): beats per minute |
| colours | CSS colours (`#rrggbb`) |

## Fixture types

A show does **not** embed fixture definitions: `PatchEntry.fixtureDefId` + `modeName` name a fixture type of the
library and one of its modes; channel names in cues and presets are that mode's channel names. Ids are
`ofl/<maker>/<model>` or `qlc/<maker>/<model>` (the offline catalog shipped with PhotonBoard, from the
[Open Fixture Library](https://open-fixture-library.org) and [QLC+](https://www.qlcplus.org)), `<maker>/<model>`
(OFL download) or user ids. When a show is opened on another machine, the fixture types it uses are installed
from the offline catalog automatically. Definitions follow the OFL model (see `FixtureDefinition` in
[`src/shared/types.ts`](../../src/shared/types.ts)).

## Top-level structure

| Property | Type | Content |
|---|---|---|
| `version`, `name`, `createdAt`, `modifiedAt` | string | format version, show name, ISO dates |
| `patch` | `PatchEntry[]` | patched fixtures: type, mode, universe, address, name, fixture ID, groups, 3D position / rotation / mounting |
| `groups` | `Group[]` | fixture selections (ordered), colour, number, parent group |
| `presets` | `Preset[]` | family (`intensity`, `color`, `position`, `gobo`, `beam`, `focus`, `control`, `full`), selective `values` (fixture → channel → DMX), global `typeValues` (fixture type → channel → DMX), `universal` values |
| `cuelists` | `Cuelist[]` | sequences ("scenes" in the UI): cues with values, fade in / out, delay, follow, per-feature timing, parts, block; tracking, MIB, rate, priority |
| `chases` | `Chase[]` | steps of values, BPM, fade %, direction |
| `effects` | `Effect[]` | waveform effects (single or compound channels), fixtures, fan, spatial mode |
| `midiMappings` | `MidiMapping[]` | MIDI source → target (scene GO / fader, chase, master, timeline…) |
| `timeline` | object | clips (sequences on tracks), markers, zones, length, loop, MIDI timecode settings |
| `executor` | object | v3 `pages` (8 × 4 cells: kind + id + button function, column faders) + v2 mirror of page 1 |
| `roomConfig` | object | 3D room size and truss bars (metres) |
| `stageLayout` | object | legacy 2D plot |
| `macros`, `speedMasters`, `stagePages` | arrays | command-line macros, tempo masters, touch pages |
| `parked`, `groupMasters` | array / object | parked channel values, group master levels |

The JSON Schema documents every property of every object.

## A minimal show

```json
{
  "version": "3",
  "name": "Minimal",
  "patch": [
    { "id": "par-1", "fixtureDefId": "generic/dimmer", "modeName": "1ch", "universe": 0, "address": 1, "name": "Par 1", "groupIds": [], "fid": 1 }
  ],
  "cuelists": [
    { "id": "seq-1", "name": "Look", "number": 1, "cues": [
      { "id": "cue-1", "name": "Full", "number": 1, "fadeIn": 3, "fadeOut": 3, "delay": 0, "followTime": null,
        "values": [ { "fixtureId": "par-1", "channelName": "Dimmer", "value": 255 } ] }
    ] }
  ]
}
```

## Validating a file

Any JSON Schema 2020-12 validator works, e.g. `npx ajv-cli validate --spec=draft2020 -s docs/format/photonboard-show.schema.json -d my.pbshow`.
PhotonBoard's own test (`src/shared/show-schema.test.ts`) checks that every show it writes validates.

---

# Le format de show PhotonBoard (.pbshow)

Un show PhotonBoard est un simple fichier **JSON UTF-8** d’extension `.pbshow`. Rien n’est compressé, chiffré ni
binaire : n’importe quel logiciel — une autre console, un visualiseur, un outil de paperasse, un script — peut le
lire et l’écrire. Le format est décrit par un **JSON Schema** ([`photonboard-show.schema.json`](photonboard-show.schema.json),
draft 2020-12) et implémenté dans [`src/shared/show-format.ts`](../../src/shared/show-format.ts) (`normalizeShow()`),
le lecteur de référence. Vos shows ne sont jamais prisonniers : Fichier › Exporter… les écrit aussi en CSV et dans
les autres formats ouverts pris en charge (voir [docs/import-export.md](../import-export.md)).

## Versions

| `version` | PhotonBoard | Changements |
|---|---|---|
| `"1.0.0"` | ≤ 0.1 | premier format (contenait les réglages de sortie DMX, désormais ignorés) |
| `"2"` | 1.0 | disposition des exécuteurs, noms des pistes de timeline ; les sorties sont des réglages de la machine |
| `"3"` | 1.1 et + | programmation pro : numéros d’objets, portées des presets, temps de cue par famille et parts, pages d’exécuteurs, macros, masters de vitesse, pages Stage, Park, masters de groupe |

Tous les champs v3 sont **facultatifs**, et un fichier v3 garde les champs v2 à jour (les valeurs des cues
contiennent la valeur DMX résolue même quand elles renvoient à un preset ; `executor.grid` reflète la page 1) :
PhotonBoard 1.0 joue encore un show v3.

## Règles pour lire et écrire

- **Ignorer les propriétés inconnues**, et les conserver si possible (un PhotonBoard plus récent a pu les écrire).
- **Propriété absente = valeur par défaut.** PhotonBoard remplit toutes les valeurs par défaut (voir `normalizeShow`),
  borne les nombres et écarte les entrées malformées avec un avertissement : un fichier n’est jamais refusé pour un détail.
- **Identifiants** : chaînes uniques dans leur liste (des UUID en pratique). Les références passent par ces identifiants
  (`Group.fixtureIds`, `CueChannelValue.fixtureId` → patch, `presetId` → presets, `cuelistId` → séquences, cellules d’exécuteurs → tout objet).
- **Numéros d’objets** (`fid` des projecteurs, `number` des groupes, séquences, chases, effets, macros, masters de vitesse,
  et des presets *par famille*) : entiers positifs, uniques par liste.
- **L’état d’exécution n’est pas du contenu** : `isPlaying`, `currentCueIndex`, `flash`, `isRunning`… sont écrits à l’arrêt
  et ignorés au chargement. Ouvrir un show ne lance jamais rien.

## Unités et conventions

| Valeur | Unité / plage |
|---|---|
| `universe` | à partir de 0 (0-15) ; l’interface affiche les univers 1-16 |
| `address` | 1-512, adresse de départ du projecteur |
| valeurs DMX | entiers 0-255 (8 bits ; les canaux fins sont des canaux à part) |
| temps (`fadeIn`, `fadeOut`, `delay`, `followTime`, `fade`) | secondes (`followTime: null` = GO manuel) |
| `position3D` | mètres ; origine = centre du plateau au sol ; `x` gauche (−, côté `wall-left`) → droite (+), `y` hauteur, `z` face (−) → lointain (+) |
| `rotation3D` | radians ; `mountingAngle`, `mountingPan`, `beamAngle` : degrés |
| `speed` (effets) | Hz ; `bpm` (chases, masters de vitesse) : battements par minute |
| couleurs | couleurs CSS (`#rrggbb`) |

## Types de projecteurs

Un show **n’embarque pas** les définitions : `PatchEntry.fixtureDefId` + `modeName` désignent un type de la
bibliothèque et l’un de ses modes ; les noms de canaux des cues et presets sont ceux de ce mode. Les identifiants
sont `ofl/<fabricant>/<modèle>` ou `qlc/<fabricant>/<modèle>` (bibliothèque hors ligne livrée avec PhotonBoard, issue
de l’[Open Fixture Library](https://open-fixture-library.org) et de [QLC+](https://www.qlcplus.org)), `<fabricant>/<modèle>`
(téléchargement OFL) ou des identifiants utilisateur. Sur une autre machine, les types utilisés sont installés
automatiquement depuis la bibliothèque hors ligne.

## Structure

Voir le tableau « Top-level structure » ci-dessus (mêmes propriétés) et le JSON Schema, qui documente chaque
propriété de chaque objet. L’exemple minimal ci-dessus est un show valide.

## Valider un fichier

N’importe quel validateur JSON Schema 2020-12 convient, par ex.
`npx ajv-cli validate --spec=draft2020 -s docs/format/photonboard-show.schema.json -d mon-show.pbshow`.
Le test `src/shared/show-schema.test.ts` vérifie que tout show écrit par PhotonBoard est valide.
