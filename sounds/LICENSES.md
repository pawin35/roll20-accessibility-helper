# Sound asset provenance

| File | Source | Author | License |
|---|---|---|---|
| `roll.mp3` | [Wooden dice on wooden table roll](https://opengameart.org/content/wooden-dice-on-wodden-table-roll) (`Holzwürfel_auf_Holztisch_1.flac`) | Wuzzy | CC0 1.0 |
| `other-roll.mp3` | Same pack (`Holzwürfel_auf_Holztisch_2.flac`) | Wuzzy | CC0 1.0 |
| `natural-20.mp3` | [100 CC0 SFX](https://opengameart.org/content/100-cc0-sfx) (`bell_02.ogg`) | rubberduck | CC0 1.0 |
| `natural-1.mp3` | Same pack (`slam_03.ogg`) | rubberduck | CC0 1.0 |

All were converted to mono MP3 at 44.1 kHz and trimmed to under 600 ms, because every cue plays
while a screen reader may be speaking.

**Your own roll and someone else's must be tellable apart by ear alone**, so they differ in
timbre, not just volume. `other-roll` is pitch-shifted down about a fifth, low-passed at
1.8 kHz and normalised 6 dB quieter — dice landing on a different table, across the room.
Measured spectral centroid is 2770 Hz for `roll` against 1302 Hz for `other-roll`: less than
half, which is an unmistakable difference rather than the same rattle turned down.

## Why the ธรรมชาติ cues sit where they do

`natural-20` and `natural-1` are the only cues that do not play the moment they are asked for.
They are scheduled 575 ms out — the length of the rattle — so the dice settle and then the cue
lands on its own (docs/adr/0011), and they play at roughly twice the gain of every other cue.

| | centroid | duration | mean | above 500 Hz |
|---|---|---|---|---|
| `natural-20` (bell) | 4229 Hz | 575 ms | −23.9 dB | −23.9 dB |
| `roll` (own rattle) | 2770 Hz | 575 ms | −23.0 dB | −24.1 dB |
| `natural-1` (slam) | 1656 Hz | 549 ms | −23.3 dB | −27.8 dB |
| `other-roll` (their rattle) | 1302 Hz | — | −29.3 dB | — |

The last column is the one that decides a cue: it is what survives a laptop or phone speaker,
which reproduces very little below 500 Hz. An earlier `natural-1` was a wooden thud pitched down
to a 439 Hz centroid to stay clear of the rattle it was then mixed with; it lost **11.4 dB** in
that column and was effectively silent on a phone. Playing the cue after the rattle removed the
reason to push it that low, and the slam that replaced it loses only 4.5 dB.

Both are trimmed with a short fade rather than a hard cut, and levelled by *mean* rather than
peak — they are transients, and peak-matching would have made them dominate.

## Why the other cues are synthesised

`addDie`, `reset`, `toggleOn`, `toggleOff` and `error` have no files here and fall back to the
generated tones in `src/features/sound/sound.ts`. That is deliberate rather than unfinished
work: a dice rattle for "advantage turned on" would be actively confusing, and a blind player
needs each action to be distinguishable by ear alone. Distinct short tones do that better than
variations on the same recording.

To use recordings for those too, drop the file in here and add it to the `FILES` map in
`src/features/sound/sound.ts` — the map is the list of events that have a recording, so a file
sitting here unreferenced is never fetched. Add a row to the table above when you do.

The synthesised tone is a fallback for a missing or undecodable file, never a substitute for
one that is merely still downloading: a cue that is a rattle on the second roll and a beep on
the first is worse than either alone. Recordings are fetched when the room loads, and a roll
that arrives before the bytes do waits for them.
