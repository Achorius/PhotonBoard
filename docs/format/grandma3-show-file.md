# grandMA3 / grandMA2 `.show` files

## English

**PhotonBoard does not open grandMA `.show` files.** The grandMA3 and grandMA2 show
files are a proprietary, undocumented format of MA Lighting. PhotonBoard recognises
them (a grandMA3 show starts with the bytes `GMA3`) and explains how to export the
data instead. Everything a lighting designer needs can be brought over through the
open exports that grandMA3 and grandMA2 offer, on the console or in the free onPC
software (open the show in grandMA3 onPC if you only have the file).

### Recommended workflow — grandMA3 (console or onPC, v2.x)

1. **Patch, fixture types, positions → MVR**
   - v2.4 and later: *Menu → Patch → Export…*, keep **MVR** (default), whole patch.
     The file goes to `gma3_library/mvr` on the selected drive.
   - v2.0 – v2.3: *Menu → Patch → Export MVR*.
   - Command line: `Export Fixture Thru /File "rig" /MVR`.
   - In PhotonBoard: *File → Import…* → the `.mvr` file (fixture types come as GDTF).
2. **Sequences, presets, groups, macros → grandMA3 XML**
   On the command line (or with the pool's *Export* button), one file per object or
   a range per file:
   ```
   Export Sequence 1 "Act1"
   Export Preset 4.1 Thru 4.50 "Colors"
   Export Preset 2.1 Thru 2.50 "Positions"
   Export Group 1 Thru 100 "Groups"
   Export Macro 1 Thru 100 "Macros"
   ```
   Files land in `gma3_library/datapools/…` (sequences, presets, groups, macros).
   v2.4+ can also export the patch as grandMA3 XML (*Patch → Export… → grandMA3*,
   `gma3_library/patch`).
3. **Bring them in together**: zip the `gma3_library` folder (or just the XML files
   and, if you have it, the patch XML) and import the `.zip` in PhotonBoard. Files of
   one zip are read together, so cues find their fixtures by fixture ID (FID).
   Importing the MVR first and the sequence XML afterwards (*merge*) works too: the
   fixtures referenced by FID are matched with the patched ones.

### grandMA2 (console, onPC, dot2)

Export from the command line to the `importexport` folder of the USB drive, zip
the XML files and import the `.zip`:
```
cd EditSetup ; cd Layers ; Export 1 Thru "patch" ; cd /     (fixture layers = patch + 3D positions)
Export Sequence 1 Thru 20 "sequences"
Export Preset 1.1 Thru 7.999 "presets"
Export Group 1 Thru 999 "groups"
Export Effect 1 Thru 999 "effects"
Export Macro 1 Thru 999 "macros"
```
Command syntax varies a little between software versions: when a command is
refused, use the pool / menu *Export* buttons (same files).

grandMA2 and Eos-family consoles can also exchange **USITT ASCII** (patch, cues,
groups — intensity only), which PhotonBoard reads and writes.

### What comes over

| grandMA object | PhotonBoard | Notes |
|---|---|---|
| Patch (MVR / MA2 layers / MA3 patch XML) | fixtures, patch, FID, 3D positions | fixture types: file → library / catalogue → generic type (warned) |
| Sequence, cues, parts | cuelist, cues, cue parts | fade, out fade, delay, per-preset-type fades, Follow / Time triggers |
| Cue values | values per channel | percent → DMX (16-bit when the mode has a fine channel), pan/tilt degrees → DMX |
| Presets 1–7 (Dimmer … Control) | preset pools 1–7 | selective and universal; global stored as selective |
| Groups | groups | selection order kept |
| Macros | macros | command text kept (grandMA syntax, review it) |
| grandMA2 effects | effects | approximated (form → waveform, low/high → depth) |
| Phasers, MAtricks, executors / pages, layouts, timecode, plugins | — | listed in the import warnings |

## Français

**PhotonBoard n'ouvre pas les fichiers `.show` grandMA.** Les fichiers de show
grandMA3 et grandMA2 sont un format propriétaire et non documenté de MA Lighting.
PhotonBoard les reconnaît (un show grandMA3 commence par les octets `GMA3`) et
explique comment exporter les données à la place. Tout ce dont un éclairagiste a
besoin passe par les exports ouverts de grandMA3 et grandMA2, sur la console ou
dans le logiciel gratuit onPC (ouvrez le show dans grandMA3 onPC si vous n'avez que
le fichier).

### Méthode conseillée — grandMA3 (console ou onPC, v2.x)

1. **Patch, types de projecteurs, positions → MVR**
   - v2.4 et suivantes : *Menu → Patch → Export…*, garder **MVR** (par défaut),
     tout le patch. Le fichier est écrit dans `gma3_library/mvr`.
   - v2.0 à v2.3 : *Menu → Patch → Export MVR*.
   - Ligne de commande : `Export Fixture Thru /File "rig" /MVR`.
   - Dans PhotonBoard : *Fichier → Importer…* → le fichier `.mvr`.
2. **Séquences, presets, groupes, macros → XML grandMA3**
   ```
   Export Sequence 1 "Acte1"
   Export Preset 4.1 Thru 4.50 "Couleurs"
   Export Preset 2.1 Thru 2.50 "Positions"
   Export Group 1 Thru 100 "Groupes"
   Export Macro 1 Thru 100 "Macros"
   ```
   Les fichiers sont dans `gma3_library/datapools/…`. En v2.4+, le patch peut aussi
   être exporté en XML grandMA3 (*Patch → Export… → grandMA3*).
3. **Tout importer ensemble** : compresser le dossier `gma3_library` (ou seulement
   les XML) en `.zip` et importer le `.zip` dans PhotonBoard. Les fichiers d'un même
   zip sont lus ensemble : les mémoires retrouvent leurs projecteurs par numéro de
   fixture (FID). Importer d'abord le MVR puis les séquences en *fusion* marche aussi.

### grandMA2 (console, onPC, dot2)

Exporter depuis la ligne de commande vers le dossier `importexport` de la clé USB,
zipper les XML et importer le `.zip` (commandes ci-dessus, section anglaise ; la
syntaxe varie un peu selon les versions : à défaut, utiliser les boutons *Export*
des pools / menus). Les
consoles grandMA2 et ETC Eos échangent aussi l'**ASCII USITT** (patch, mémoires,
groupes — intensités seulement), que PhotonBoard lit et écrit.

Le tableau « What comes over » ci-dessus résume ce qui est repris : patch et
positions, séquences / mémoires / parts avec leurs temps, valeurs (pourcentages →
DMX, degrés pan/tilt → DMX), presets 1 à 7, groupes (ordre de sélection), macros
(texte grandMA conservé), effets grandMA2 (approchés). Les phasers, MAtricks, pages
d'exécuteurs, layouts, timecode et plugins sont signalés dans les avertissements.
