# Glossaire PhotonBoard — français

Référence commune des traducteurs. Point de vue : un régisseur / pupitreur lumière
français habitué à grandMA, ChamSys, Avolites et aux consoles de théâtre (ADB, Congo).
**Règle d'or : le terme qu'un technicien dit au plateau.** Les termes de pupitre
universels restent en anglais ; l'interface générique (fichiers, réglages, actions)
est en français courant.

Les mots déjà traduits dans `common.*` (Projecteur, Scène, Cue, Groupe, Univers,
Canal…) sont **à réutiliser** : `t('common.scene')`, `t('common.fixtureCount', { count })`.

---

## 1. Termes gardés en anglais

| Anglais | Dans l'UI FR | Genre | Pourquoi |
|---|---|---|---|
| Blackout | Blackout | le | Universel en régie, bouton physique sur toutes les consoles. |
| Blinder | Blinder | le | Nom du projecteur et de l'effet, aucun équivalent courant. |
| Strobe | Strobe | le | « Stroboscope » existe mais au pupitre on dit strobe. |
| Flash | Flash | le | Touche flash des consoles, mot français aussi. |
| GO / Back | GO / Retour | — | GO intouchable (touche physique). **Back → « Retour »** (bouton de restitution) : clair et court. |
| Stop | Stop | — | Identique en français. |
| Fader | Fader | le | « Potentiomètre » n'est utilisé par personne en régie lumière. |
| Grand Master (GM) | Grand Master | le | Nom de la commande sur toutes les consoles. |
| Master(s) | Masters | les | Section des masters (GM, Strobe, Blinder, Blackout). |
| Cue | Cue | **la** (« une cue », « la cue 3 ») | Usage grandMA en France. En prose théâtre on dirait « mémoire » : on garde *cue* pour coller aux consoles modernes. |
| Chase | Chase | **le** (« un chase ») | Terme de console ; « chenillard » est daté et réservé aux guirlandes. |
| Preset | Preset | le | Terme de console. |
| Patch | Patch (verbe : patcher, patché) | le | Universel. |
| Programmer | Programmer | le | Terme grandMA (« le programmer », « vider le programmer »). « Programmeur » désignerait une personne. |
| Clear | Clear (bouton) / « Vider le programmer » (phrases, infobulles) | — | Bouton de console ; en phrase on explique en français. Pour un champ de recherche : « Effacer ». |
| Release | Release (bouton) / « Relâcher » (phrases) | — | Même logique que Clear : « Relâcher toutes les scènes ». |
| Dimmer | Dimmer | le | Nom de l'attribut / du canal. L'**attribut** générique se dit « Intensité ». |
| Pan / Tilt | Pan / Tilt | le | Universels. |
| Gobo | Gobo | le | Universel. |
| Prism | **Prisme** | le | Mot français identique, compris de tous. |
| Zoom / Focus / Iris / Shutter | Zoom / Focus / Iris / Shutter | le | Attributs de console. (Shutter : on peut écrire « obturateur » dans une description longue.) |
| Frost | Frost | le | Usage plateau. |
| DMX, Art-Net, sACN, RDM | inchangés | — | Protocoles. |
| Node (Art-Net) | node | le | Usage réseau lumière. |
| Broadcast / Unicast | inchangés | — | Termes réseau. |
| MIDI, MIDI learn, MTC | MIDI, MIDI learn, timecode MIDI (MTC) | le | « Learn » sur le bouton ; « MIDI learn » dans les menus. |
| Mapping (MIDI) | mapping | le | « Un mapping MIDI » ; « affectation » acceptable dans une phrase. |
| Timecode | Timecode | le | Universel. |
| Timeline | Timeline | **la** | Usage logiciels audio/vidéo. |
| BPM, Tap tempo | inchangés | — | Universels. |
| Highlight, Locate, Blind, Park, Solo | inchangés | — | Fonctions grandMA, connues sous ce nom. |
| Stage (fenêtre / vue) | Stage | la (« la vue Stage ») | Nom de la surface de jeu (deuxième écran, téléphone). « Scène » est déjà pris par les scènes. |
| Live (bouton timeline) | Live | — | Court, parlant. |
| Pools | Pools | les | Onglet Pro (presets, groupes, macros, masters de vitesse) : nom grandMA. |
| MAtricks | MAtricks | les | Fonction grandMA (entrelacement, blocs, groupes, ailes). |
| Speed master | Master de vitesse (onglet) / speed master (cellule, ligne de commande) | le | « Speed » reste le mot-clé de la ligne de commande. |
| Macro | Macro | la | |
| Store / Update / Assign / Oops (ligne de commande) | inchangés | — | Mots-clés anglais de la ligne de commande ; les menus disent Mémoriser, Mettre à jour, Affecter, Annuler. |
| Locate, Flip, Full, Out | inchangés | — | Touches / fonctions de console (Full = plein feu dans une phrase). |
| TOG / TRIG / FLASH (modes de bouton) | inchangés **partout** (badges des cellules, grilles Stage, menus courts) | — | Badges de 4-5 lettres, identiques en FR et en EN (comme les autres badges de fonction : GO, GO-, OFF, SEL, SWAP, PAUSE, LEARN). Les noms longs des menus sont traduits : Bascule, Trigger, Flash ; la fonction Pro *temp* s'appelle « Trigger (temporaire) » (badge TRIG). |
| Fade in / Fade out / Delay | **Montée / Descente / Délai** dans les formulaires ; en-têtes de colonnes courts possibles : IN / OUT / DÉLAI | — | Vocabulaire des consoles françaises (temps de montée / descente). « Fondu » pour *fade* générique. |
| Follow (temps de cue) | Enchaînement | le | « Enchaînement auto après 2 s ». |
| Tracking | Tracking | le | Terme de console (valeurs suivies). |
| fps | fps | — | Compris de tous (i/s possible dans une phrase). |
| Companion, Stream Deck, OSC | inchangés | — | Noms de produits / protocoles. |

## 2. Termes traduits

| Anglais | Français | Remarque |
|---|---|---|
| Fixture | **Projecteur** (pl. projecteurs) | Choix principal : clair pour tous. « Fixture » reste dans la syntaxe de la ligne de commande (`Fixture 1 thru 4 at 80`) et dans « Open Fixture Library ». Machines asservies : « lyres » seulement dans des textes d'exemple. |
| Fixture type / definition | type de projecteur | |
| Fixture library | bibliothèque de projecteurs | |
| Manufacturer | fabricant | |
| Scene | Scène | |
| Step (chase) | Pas | « 8 pas », « pas suivant ». |
| Effect | Effet | |
| Group | Groupe | |
| Universe | Univers (invariable) | Abréviation : U1, U2. |
| Address | Adresse | Format `1.001` inchangé. |
| Channel | Canal / canaux | Abréviation : « can. ». |
| Intensity / Colour / Position / Beam | Intensité / Couleur / Position / Faisceau | Familles d'attributs. |
| Colour wheel / Gobo wheel | roue de couleurs / roue de gobos | |
| Executor(s), executor bar | Exécuteur(s), barre d'exécuteurs | Mot français équivalent, lisible par tous. |
| Record | **Mémoriser** | Pour différencier de « Enregistrer » (= sauvegarder le fichier). « Mémoriser la scène », « Mémoriser une cue ». |
| Update | Mettre à jour | |
| Save / Save as | Enregistrer / Enregistrer sous… | |
| Open / Open recent | Ouvrir… / Ouvrir un show récent | |
| New show | Nouveau show | « show » masculin. |
| Show (le fichier, le spectacle) | show | « le show », « dossier des shows ». |
| Settings | Réglages | |
| Display | Affichage | |
| Outputs | Sorties | « Sorties DMX ». |
| Remote access / web remote | Accès à distance / télécommande web | Appareil distant : « la télécommande », mode : « à distance ». |
| Console | console | |
| Density: Compact / Touch | Densité : Compacte / Tactile | |
| Undo / Redo | Annuler / Rétablir | Comme macOS / Windows en français. |
| Cancel | Annuler | Même mot qu'Undo : normal en français. |
| Delete / Remove | Supprimer (détruit) / Retirer (enlève d'une liste, d'un groupe) | |
| Duplicate / Rename | Dupliquer / Renommer | |
| Clear (champ, sélection) | Effacer | |
| Arrange (mode) | Organiser | |
| Levels (mode) | Niveaux | |
| Play (mode de la grille) | Jouer | Bouton lecture de transport : « Lecture ». |
| Follow spot | **Poursuite** | Terme français exact. |
| Gamepad | manette | |
| Stage layout (vue 2D) | **Plan de feu** (onglet : « Plan ») | Terme métier français. |
| 3D visualiser | Visualiseur 3D | |
| Truss | pont | « pont alu ». Nom par défaut : « Pont 1 ». |
| Rig (3D) | implantation | |
| Room | salle | |
| Track (timeline) | piste | |
| Clip / Marker / Zone | clip / repère / zone | |
| Playback (vue / section) | restitution | |
| Shortcut | raccourci | |
| Selected | sélectionné(s) | Accord en nombre via le pluriel. |
| Fixture « moving head » | **lyre** (admis comme terme) | « lyre » est le mot du plateau pour une tête mobile ; « projecteur » reste le terme générique de l'interface. |
| Stage left / right / upstage / downstage | **jardin / cour / lointain / face** | Directions de plateau françaises (jardin = gauche vu de la salle). « Nez de scène » = bord du plateau côté salle, « axe » = axe central, « plateau » = l'aire de jeu. |
| Hang / hanging position | **accroche** | « Point d'accroche », « hauteur d'accroche ». |
| Focus (position d'un faisceau) | **pointage** | Le *pointage* d'un projecteur ; l'attribut Focus garde son nom. |
| Beam angle / aperture | **ouverture** | « Ouverture du faisceau ». |
| Truss | **pont** | (voir plus haut) ; nom par défaut d'un pont créé : « Pont 1 », « Pont 2 »… |
| Offline catalog | **Catalogue (hors ligne)** | Catalogue de projecteurs embarqué (Pi sans réseau). |
| Merge mode (HTP / LTP) | **Fusion (HTP / LTP)** | HTP / LTP restent en anglais. |
| Pan / Tilt range | **Course pan / tilt** | « Course » = amplitude mécanique. |
| Spread / offset (patch, fan) | **Écart** | |
| User / Built-in (bibliothèque) | **Utilisateur / Intégré** | |
| Waveforms | Sinus, Triangle, Scie, Carré, Impulsion, Rebond, Paliers, Aléatoire, Perso, Maintien (constante) | Noms courts (boutons étroits). |
| Size / Spread / Phase (effets) | **Amplitude / Répartition / Déphasage** | |
| Once / Loop | **Une fois / Boucle** | |
| Forward / Backward / Bounce / Random | **Avant / Arrière / Aller-retour / Aléatoire** | Sens de lecture des chases et effets. |
| Crossfade / fade (générique) | **Fondu** | « Fondu de 2 s » ; les temps de cue restent Montée / Descente. X-fade (fader) : « fondu manuel ». |
| Beat | **temps** | « 4 temps », « Mesures » pour *bars* (timeline). |
| Hold | **Maintien** | Temps de maintien d'un pas. |
| Merge / Replace (mémoriser) | **Fusionner / Remplacer** | Pro : Overwrite = **Écraser**, Remove = **Retirer**, Cue only = **Cue seule**, Block = **Cue bloquante**. |
| Slot / row | **emplacement / rangée** | Cellules d'exécuteurs, pools. |
| Section (timeline) | **section** | |
| Snap / Free | **Magnétisme / Libre** | Timeline. |
| Follow timecode | **Suivre le timecode** | |
| Fine (réglage) | **« Précis »** | Mode fin d'un fader / encodeur. |
| Executor page | **page** (« Page 2 ») | Pages d'exécuteurs ; les onglets 2 colonnes du téléphone sont des « paires de colonnes ». |
| Stage page | **page Stage** | Pages de widgets tactiles. |
| Group master | **master de groupe** | |
| Programmer time | **temps du programmer** | Fondu / délai des nouvelles valeurs. |
| Align | **Aligner** (Non / < / > / <> / ><) | Sens des dégradés (fans). |
| Highlight / Blind / Park | inchangés ; verbes : « parker », « libérer » (unpark) | |
| Pickup (MIDI soft takeover) | **Rattrapage** | Le fader physique reprend la main en atteignant la valeur ; un repère en pointillés montre où il est. |

## 3. Style et typographie

- **Vouvoiement** dans les phrases (« Ajoutez des projecteurs… »), **infinitif** sur les boutons et menus (« Supprimer la scène », « Ouvrir MIDI »).
- **Majuscule** seulement au premier mot (« Barre d'exécuteurs », pas « Barre d'Exécuteurs ») ; les termes anglais gardés gardent leur casse (Grand Master, GO).
- **Guillemets français** « … » autour des noms : `'Supprimer la scène « {name} » ?'`.
- **Espaces insécables** : tapez des espaces normales avant `: ; ! ?` et à l'intérieur de `« »` — le dictionnaire français les convertit automatiquement au chargement (fine insécable avant `; ! ?`, insécable avant `:` et dans les guillemets). Une espace oubliée avant `:` ou `?` est ajoutée aussi. `...` devient `…`.
- **Apostrophe typographique** ’ (pas ') : `'Barre d’exécuteurs'`.
- **Nombres** : jamais formatés à la main. `formatSeconds`, `formatPercent`, `formatBpm`, `formatHz` (components/ui/format.ts) donnent « 2,5 s », « 50 % », « 92,5 BPM » en français ; `formatNumber()` / `formatDecimal()` (@renderer/i18n) pour le reste. Les nombres passés en paramètre à `t()` sont formatés automatiquement.
- **Pluriels** : objets `{ one, other }` (et `zero` si utile) — en français 0 et 1 sont au singulier (« 0 projecteur »). Jamais `projecteur(s)`.
- **Libellés de sélection** (suppression clavier, toast « Supprimé : … ») : groupe nominal **avec article** en français, tel qu'il se lit après « Supprimer … ? » : `'la scène « {name} »'`, `'le projecteur « {name} »'`, `'l’effet « {name} »'` ; au pluriel : `'{count} projecteurs'`. En anglais : `'scene “{name}”'`.
- **Longueur** : le français fait 20 à 30 % de plus. Sur les boutons étroits, préférer le mot court (« Effacer », « Retour ») ; une abréviation n'est acceptable que pour une unité (« can. », « U1 ») ; sinon vérifier que le texte tronque proprement (`truncate`) et que l'infobulle donne le texte complet.
- **Ligne de commande** : la syntaxe reste anglaise (Fixture, Thru, At, Full, Group, Go, Stop, Clear) comme sur grandMA ; seuls les retours sont traduits.
- **Noms propres et données** : noms de scènes, groupes, projecteurs (« Warm Wash », « Spots ») = données de l'utilisateur, jamais traduits.
