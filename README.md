# Vesper-9

A first-person horror game set on a failing orbital relay station, built with Three.js in a single `index.html`.

Wake in crew quarters, recover three fuse cells, restart the reactor, and reach the escape pods while something stalks the ring.

## Play

Open `index.html` in a desktop or mobile browser (needs WebGL and a network connection for Three.js and fonts).

| Input | Action |
| --- | --- |
| WASD / arrows | Move |
| Mouse (click to capture) | Look |
| Shift | Run. The creature hears running |
| F | Flashlight. Hold the beam on the creature to drive it back |
| E | Use terminals, the reactor, and the pod |
| Esc / P | Pause |

On touch screens: drag on the left to move, drag on the right to look, and use the LIGHT / USE / RUN buttons.

## Mechanics

- **Oxygen** drains until the reactor is back online. Canisters refill it.
- **Flashlight battery** drains while the light is on, and faster while it burns the creature.
- **Motion tracker** pings every 1.4 s and shows the creature within 24 m.
- The creature patrols, hunts on sight or sound, loses you after 7 s out of sight, and flees from a sustained flashlight beam. After the reactor restarts it hunts nonstop.
- Five crew logs on terminals tell the story and hint at how to survive.

Everything (textures, the creature model, and audio) is generated procedurally at runtime; there are no asset files.
