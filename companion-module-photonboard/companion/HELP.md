# PhotonBoard Companion Module

Control PhotonBoard DMX lighting software from Bitfocus Companion.

## Setup

1. Make sure PhotonBoard is running on your network
2. In Companion, add the **PhotonBoard** module
3. Enter the **IP address** of the machine running PhotonBoard (default port: 9090)
4. If remote access is protected by a PIN in PhotonBoard, enter the same **Access PIN**
5. The module will auto-connect and discover your scenes

A wrong or missing PIN shows the connection as "Bad configuration"; the module
then retries every 30 seconds (PhotonBoard briefly locks out repeated wrong PINs).

## Actions

- **Go Scene** — Start a cuelist/scene (same as pressing GO)
- **Go Back Scene** — Step a scene back to its previous cue
- **Stop Scene** / **Toggle Scene** — Stop, or GO/STOP a scene
- **Set Scene Fader** — Set the fader level for a scene (0-100%)
- **Release All** — Stop every scene and chase
- **Toggle Blackout** / **Set Blackout** — Toggle, or force blackout on/off
- **Toggle Blinder** / **Toggle Strobe**
- **Set Grand Master** — Set the grand master level (0-100%)
- **Tap Tempo** — Tap the tempo of the playing chases
- **Clear Programmer** — Release all manual overrides
- **Toggle Live/Timeline** — Start or stop timeline playback

## Feedbacks

- **Scene Active** — Changes button color when a scene is playing
- **Blackout Active**, **Blinder Active**, **Strobe Active**, **Timeline Playing**

## Variables

- `grand_master`, `blackout`, `show_name`, `fixture_count`, `scene_count`
- Per scene N: `scene_N_name`, `scene_N_active`, `scene_N_fader`, `scene_N_cue`

## Presets

Pre-configured buttons are available for each scene and common controls. They
are rebuilt automatically when scenes are added, removed or renamed.
