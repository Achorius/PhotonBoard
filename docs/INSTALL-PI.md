# PhotonBoard sur Raspberry Pi 5 — installation en 5 minutes

Une image toute prête : on l'écrit sur une carte microSD, on met la carte dans
le Pi, et PhotonBoard démarre tout seul en plein écran. Pas de terminal, pas
besoin d'Internet.

## Ce qu'il faut

- un Raspberry Pi 5 (4 Go ou plus conseillé) avec son alimentation officielle ;
- une carte microSD de **16 Go minimum** (32 Go conseillé) ;
- un écran (tactile ou non) branché en HDMI ;
- un ordinateur (Windows, Mac ou Linux) avec un lecteur de carte SD.

## Étapes

1. **Télécharger l'image** : sur la page des versions
   <https://github.com/Achorius/PhotonBoard/releases>, dans « Assets »,
   cliquez sur le fichier **`PhotonBoard-<version>-pi5.img.xz`**.
   (Ne le décompressez pas : Raspberry Pi Imager s'en charge.)
2. **Installer Raspberry Pi Imager** depuis
   <https://www.raspberrypi.com/software/> et l'ouvrir.
3. **Appareil** : choisissez *Raspberry Pi 5*.
4. **Système d'exploitation** : descendez tout en bas de la liste, choisissez
   **« Use custom »** (« Utiliser une image personnalisée »), puis
   sélectionnez le fichier `PhotonBoard-<version>-pi5.img.xz` téléchargé.
5. **Stockage** : choisissez la carte microSD. Attention, tout son contenu
   sera effacé.
6. Si Imager propose de **personnaliser** le système, répondez **Non** :
   l'image est déjà prête. (Les versions récentes d'Imager ne le proposent
   pas pour une image personnalisée.)
7. Cliquez sur **Écrire** et attendez la fin de l'écriture et de la
   vérification.
8. Mettez la carte dans le Pi, branchez l'écran puis l'alimentation.
   Le **premier démarrage** prend une à deux minutes (la carte est agrandie
   automatiquement) ; ensuite PhotonBoard s'ouvre en plein écran.

## Wi-Fi (facultatif)

Le câble Ethernet fonctionne sans rien régler. Pour le Wi-Fi, après
l'écriture de la carte (avant de la mettre dans le Pi) :

1. ressortez puis remettez la carte dans l'ordinateur : un disque nommé
   **`bootfs`** apparaît ;
2. ouvrez le fichier **`photonboard-wifi.txt`** avec le Bloc-notes
   (Windows) ou TextEdit (Mac) ;
3. écrivez le nom du réseau et le mot de passe entre les guillemets :

   ```
   WIFI_SSID="NomDuReseau"
   WIFI_PASSWORD="MotDePasse"
   WIFI_COUNTRY="FR"
   ```

4. enregistrez, éjectez la carte et démarrez le Pi. Le mot de passe est
   effacé du fichier une fois appliqué.

## Bon à savoir

| | |
|---|---|
| Identifiant / mot de passe | **`photonboard`** / **`photonboard`** (à changer si la console est sur un réseau partagé : `passwd`) |
| Télécommande / tablette | **http://photonboard.local:9091** depuis un navigateur sur le même réseau |
| API Companion | port 9090 (module Companion installé dans `/opt/companion-module-dev`) |
| Nom sur le réseau | `photonboard.local` |
| Fuseau horaire / clavier | Europe/Paris / AZERTY français |
| Spectacles | dossier `Documents/PhotonBoard` de l'utilisateur |
| Démos | `Documents/PhotonBoard/Démos` : trois shows fictifs (Club Night, Théâtre – soirée simple, Concert Pro) et, dans `Formats`, un fichier exemple par format importable (MVR, QLC+, USITT, CSV, GDTF, grandMA2/3 XML). Aussi dans PhotonBoard : *Fichier › Ouvrir une démo…* |
| SSH | **désactivé** par défaut. Pour l'activer : créez un fichier vide nommé `ssh` (sans extension) sur le disque `bootfs`, puis démarrez le Pi ; ensuite `ssh photonboard@photonboard.local` |

- Si `photonboard.local` ne répond pas (certains Windows ou réseaux), utilisez
  l'adresse IP du Pi, visible dans l'interface de votre box/routeur.
- Écrans tactiles inversés (deux écrans) : voir `/etc/photonboard/touch-map.conf`
  (`SWAP=1`).
- Mise à jour de PhotonBoard plus tard : réécrire la carte avec la nouvelle
  image (pensez à sauvegarder vos spectacles avant), ou, avec Internet et SSH,
  `curl -fsSL https://raw.githubusercontent.com/Achorius/PhotonBoard/main/scripts/pi-setup.sh | sudo bash`.

---

*Pour les développeurs* : l'image est construite automatiquement par GitHub
Actions (`.github/workflows/pi-image.yml`) à chaque publication d'une version,
à partir de Raspberry Pi OS Lite (arm64) et du `.deb` arm64 de la version, avec
`scripts/build-pi-image.sh` (qui exécute `scripts/pi-setup.sh --image-build`).
Elle peut aussi être relancée à la main (onglet *Actions* → *Raspberry Pi
image* → *Run workflow*, champ `tag`).

## Clés USB, manette, MIDI (1.1.1)

- **Clés USB** (FAT32, exFAT, NTFS) : montées automatiquement dans `/media/photonboard/<NOM>` dès qu'elles sont branchées
  (service `photonboard-usb-mount@…`), démontées quand on les retire. Dans PhotonBoard : *Fichier › Ouvrir depuis une clé USB…*
  (le show est copié dans le dossier des shows puis ouvert), *Enregistrer une copie sur la clé USB*, *Éjecter la clé USB*.
  Nécessite l'image 1.1.1 (ou de relancer `pi-setup.sh`).
- **Manette (poursuite)** : le module noyau `joydev` est chargé au démarrage (`/etc/modules-load.d/photonboard.conf`) et
  `/etc/udev/rules.d/70-photonboard-input.rules` rend les manettes lisibles par l'utilisateur du kiosque. Vérification :
  `ls -l /dev/input/js*` et `groups` (doit contenir `input`). Appuyez sur un bouton de la manette : le moteur Chromium ne
  montre une manette qu'après un appui.
- **MIDI** : le séquenceur ALSA (`snd-seq`) est chargé au démarrage ; un contrôleur branché après le démarrage apparaît
  seul en quelques secondes.

