# Import / export — bring your show, take it with you

*Français plus bas · [Version française](#import--export--amenez-votre-show-repartez-avec)*

PhotonBoard reads the files of other lighting software and writes open formats, so a designer coming from
grandMA, Eos, MagicQ, Avolites, QLC+… finds their patch, positions, groups, presets and cues, and every show can
leave PhotonBoard at any time. The exact list on your machine is in **Settings › Show › Supported formats**
(and Settings › About).

## Importing

**File › Import…** (Mod+I), **drop a file on the window**, or **USB stick › Import from this stick…**
No file at hand? The wizard's first step has **Try with an example file**: one file per format, shipped with the
app (`resources/demos/formats`, made from the demo shows of **File › Open a demo…**).

1. PhotonBoard detects the format (content first, extension second) and reads the file.
2. The wizard shows what it found: fixture types (and where each comes from: *your library*, the *offline
   library* of 2,200+ fixtures, *the file* itself — GDTF / QLC+ definitions embedded in it — or *generic, created*
   from the channel count when nothing matched, so nothing is lost), patched fixtures, universes, groups, presets,
   sequences and cues, chases, effects, executor pages, timeline, MIDI, macros, and every remark of the reader.
3. Options:
   - **Import into the current show** (one undo step: Mod+Z removes the whole import, a toast offers *Undo*) or
     **a new show** (you are asked to save the current one; the new show is unsaved, Save asks for its name);
   - **what to import** (each kind can be left out — e.g. only the presets and sequences of another show, applied to
     your rig: fixtures are matched by address and fixture ID);
   - **address conflicts**: move imported fixtures to the next free addresses / keep them overlapping / skip them
     (keep yours — when yours is the same type, the imported presets and cues drive it);
   - **universe offset**.
4. **Import.** Fixture types the file brings are added to your library (a definition that differs from the one
   already in your library under the same id is added beside it, never over it). Object numbers (fixture IDs,
   groups, sequences, preset slots) are kept when free, else the next free numbers are used.

### Formats

| Format | Import | Export |
|---|---|---|
| **PhotonBoard show** (.pbshow) — [documented, JSON Schema](format/README.md) | everything (= merge parts of another show) | everything |
| **CSV patch** (.csv / .tsv / .txt) — any console, Lightwright, Vectorworks, Excel… | fixture types, patch, positions, groups | patch, positions, groups (comma, or "Excel" with `;` and decimal comma) |
| MVR, GDTF, QLC+ workspace / fixtures, grandMA2 / grandMA3 XML exports, USITT ASCII | see Settings › Supported formats (format modules) | idem |

### CSV patch

One row per fixture. Column names are recognised in English, French and the wordings of the usual consoles and
paperwork tools (`Fixture ID`, `Channel`, `Unit#`, `N° Projo`, `Name`, `Label`, `Manufacturer`, `Fabricant`, `Model`,
`Fixture Type`, `Instrument Type`, `Mode`, `Personality`, `Universe`, `Univers`, `Address`, `Patch`, `DMX`, `X`/`Y`/`Z`
(with `(m)`, `(mm)`, `(cm)`, `(ft)` units), `Rotation`, `Group`, `Layer`, `Position`, `Perche`…). Addresses may be
written `1.001`, `1/1`, `1:1`, `2-017`, as an absolute address (`513` = universe 2, address 1), or as an address with a
universe column. Separators `,` `;` and tab, UTF-8 (with or without BOM) and Windows-1252 (French Excel) are detected.
Fixture types are looked up by manufacturer + model (aliases: *ADJ* = *American DJ*, *Martin Professional* = *Martin*,
*Robe lighting* = *Robe*… ; small typos tolerated; the mode with the given channel count is preferred).
Positions use CAD axes (X left → right, Y depth, Z height). When the columns are unclear, the wizard asks you to map
them (and you can always correct them with *Edit columns*).

### Closed console formats

Show files of grandMA2 / grandMA3 (`.show`, `.show.gz`), ChamSys MagicQ (`.shw`), ETC Eos (`.esf`, `.esf3d`) and
Cobalt (`.csf`), Obsidian Onyx (`.ONYXShow`), Lightkey (`.lightkeyproj`), Sunlite / Daslight profiles (`.ssl2`),
console backups (`.tgz`), CAD drawings (`.vwx`, `.wyg`, `.c2p`) and spreadsheets (`.xlsx`, `.ods`, `.numbers`) are
proprietary or not text. PhotonBoard recognises them and explains, step by step, how to export the data from the
original software into a format it reads (MVR, grandMA XML, GDTF, USITT ASCII, CSV).

## Exporting

**File › Export…** (Mod+Shift+E): choose a format; each one says what it carries and which software reads it.
Your .pbshow file is not touched.

## On the web remote

Import and export work from a browser too. **Decision:** the browser reads the chosen (or dropped) file and sends its
bytes to the console (max **14 MB**: one WebSocket message), the console's importer parses it and returns the preview;
the merge runs on the remote's copy of the show and reaches the console as a normal remote edit (one undo step on the
remote). *A new show* is uploaded to the console, which adopts it (like a .pbshow upload). Exports come back to the
browser as a download. Fixture types the import adds go into the console's library. Larger files (MVR with many GDTF
and 3D models) must be imported on the console itself; the remote says so.

## For developers: adding a format

The contract is [`src/shared/interchange.ts`](../src/shared/interchange.ts) (`Importer`, `Exporter`,
`ImportedShowFragment`, `ImportContext`, `UnsupportedFormatGuidance`). A format module lives in
`src/main/interchange/<format>/index.ts`, calls `registerImporter` / `registerExporter`
([`registry.ts`](../src/main/interchange/registry.ts)) and is listed in
[`formats.ts`](../src/main/interchange/formats.ts). Importers are pure (no Electron), never throw for malformed data
(they return what they could plus `ImportWarning`s — codes are translated under `interchange.warnings.*` in
`src/renderer/i18n/*/interchange.ts`, with the English `message` as fallback), and resolve fixture types through
`ctx.findFixture(manufacturer, model, channelCount)` (library, then offline catalog), `ctx.parseGdtf`, `ctx.parseQxf`.
The host ([`src/main/interchange/index.ts`](../src/main/interchange/index.ts)) detects the format, runs the importer,
recognises closed formats ([`unsupported.ts`](../src/main/interchange/unsupported.ts)) and runs exporters; the
renderer merges the fragment ([`lib/interchange-merge.ts`](../src/renderer/lib/interchange-merge.ts)).

---

# Import / export — amenez votre show, repartez avec

PhotonBoard lit les fichiers des autres logiciels lumière et écrit des formats ouverts : un concepteur qui vient de
grandMA, Eos, MagicQ, Avolites, QLC+… retrouve son patch, ses positions, groupes, presets et cues, et chaque show
peut quitter PhotonBoard à tout moment. La liste exacte est dans **Réglages › Show › Formats pris en charge**
(et Réglages › À propos).

## Importer

**Fichier › Importer…** (Mod+I), **déposer un fichier sur la fenêtre**, ou **Clé USB › Importer depuis cette clé…**
Pas de fichier sous la main ? La première étape de l’assistant propose **Essayer avec un fichier exemple** : un fichier
par format, livré avec l’application (`resources/demos/formats`, fait à partir des démos de **Fichier › Ouvrir une démo…**).

1. PhotonBoard détecte le format (d’abord le contenu, puis l’extension) et lit le fichier.
2. L’assistant montre ce qu’il a trouvé : types de projecteurs (et leur provenance : *votre bibliothèque*, la
   *bibliothèque hors ligne* de plus de 2 200 projecteurs, *le fichier* lui-même — définitions GDTF / QLC+ incluses — ou
   *générique, créé* d’après le nombre de canaux quand rien ne correspond : rien n’est perdu), projecteurs patchés,
   univers, groupes, presets, séquences et cues, chases, effets, pages d’exécuteurs, timeline, MIDI, macros, et toutes
   les remarques de la lecture.
3. Options :
   - **importer dans le show actuel** (une seule annulation : Mod+Z retire tout l’import, une notification propose
     *Annuler*) ou **dans un nouveau show** (on vous propose d’enregistrer le show actuel ; le nouveau show n’est pas
     enregistré, Enregistrer demande son nom) ;
   - **quoi importer** (chaque type de contenu peut être écarté — par ex. seulement les presets et séquences d’un autre
     show, appliqués à votre implantation : les projecteurs sont reconnus par adresse et numéro) ;
   - **conflits d’adresses** : adresses libres suivantes / garder (chevauchement) / ignorer (garder les vôtres — si le
     vôtre est du même type, les presets et cues importés l’utilisent) ;
   - **décalage d’univers**.
4. **Importer.** Les types de projecteurs apportés par le fichier sont ajoutés à votre bibliothèque (une définition
   différente de celle que vous avez sous le même identifiant est ajoutée à côté, jamais par-dessus). Les numéros
   d’objets sont conservés s’ils sont libres, sinon les suivants libres sont utilisés.

### Formats

| Format | Import | Export |
|---|---|---|
| **Show PhotonBoard** (.pbshow) — [documenté, JSON Schema](format/README.md) | tout (= fusionner des parties d’un autre show) | tout |
| **CSV patch** (.csv / .tsv / .txt) — toute console, Lightwright, Vectorworks, Excel… | types, patch, positions, groupes | patch, positions, groupes (virgule, ou « Excel » avec `;` et virgule décimale) |
| MVR, GDTF, espace de travail / projecteurs QLC+, exports XML grandMA2 / grandMA3, USITT ASCII | voir Réglages › Formats pris en charge (modules de formats) | idem |

### CSV patch

Une ligne par projecteur. Les noms de colonnes sont reconnus en anglais, en français et dans le vocabulaire des
consoles et outils de paperasse (`Fixture ID`, `Channel`, `N° Projo`, `Nom`, `Fabricant`, `Modèle`, `Fixture Type`,
`Mode`, `Univers`, `Adresse`, `Patch`, `DMX`, `X`/`Y`/`Z` avec unités `(m)`, `(mm)`, `(cm)`, `(ft)`, `Groupe`, `Calque`,
`Perche`, `Position`…). Adresses : `1.001`, `1/1`, `1:1`, `2-017`, adresse absolue (`513` = univers 2, adresse 1) ou
adresse + colonne d’univers. Séparateurs `,` `;` et tabulation, UTF-8 (avec ou sans BOM) et Windows-1252 (Excel
français) sont détectés. Les types sont cherchés par fabricant + modèle (alias : *ADJ* = *American DJ*, *Martin
Professional* = *Martin*, *Robe lighting* = *Robe*… ; petites fautes tolérées ; le mode au bon nombre de canaux est
préféré). Positions en axes CAO (X gauche → droite, Y profondeur, Z hauteur). Si les colonnes sont ambiguës,
l’assistant vous demande de les indiquer (*Modifier les colonnes* reste toujours possible).

### Formats fermés des consoles

Les shows grandMA2 / grandMA3 (`.show`, `.show.gz`), ChamSys MagicQ (`.shw`), ETC Eos (`.esf`, `.esf3d`) et Cobalt
(`.csf`), Obsidian Onyx (`.ONYXShow`), Lightkey (`.lightkeyproj`), les profils Sunlite / Daslight (`.ssl2`), les
sauvegardes de console (`.tgz`), les plans CAO (`.vwx`, `.wyg`, `.c2p`) et les tableurs (`.xlsx`, `.ods`, `.numbers`)
sont propriétaires ou non textuels. PhotonBoard les reconnaît et explique pas à pas comment exporter les données du
logiciel d’origine dans un format qu’il lit (MVR, XML grandMA, GDTF, USITT ASCII, CSV).

## Exporter

**Fichier › Exporter…** (Mod+Maj+E) : choisissez un format ; chacun indique ce qu’il contient et quels logiciels le
lisent. Votre fichier .pbshow n’est pas modifié.

## Sur la télécommande web

L’import et l’export fonctionnent aussi depuis un navigateur. **Choix retenu :** le navigateur lit le fichier choisi
(ou déposé) et en envoie le contenu à la console (**14 Mo** maximum : un seul message WebSocket) ; le lecteur de la
console l’analyse et renvoie l’aperçu ; la fusion se fait sur la copie du show de la télécommande et arrive à la
console comme une modification à distance ordinaire (une annulation côté télécommande). *Un nouveau show* est envoyé à
la console, qui l’adopte (comme l’envoi d’un .pbshow). Les exports reviennent au navigateur en téléchargement. Les types
de projecteurs ajoutés vont dans la bibliothèque de la console. Les fichiers plus gros (MVR avec beaucoup de GDTF et de
modèles 3D) s’importent sur la console elle-même ; la télécommande le signale.
