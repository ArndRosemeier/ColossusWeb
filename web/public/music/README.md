# Background music

Generated with Google Lyria 3 Pro (`google/lyria-3-pro-preview`) via OpenRouter on
2026-10-30, then re-encoded to 128 kbit/s MP3 with a 1.5 s fade-in and 3 s fade-out
(`ffmpeg -af "afade=t=in:d=1.5,afade=t=out:st=<duration-3>:d=3" -b:a 128k`).
Playlists live in `web/src/audio/musicPlayer.ts`.

| File | Scene | Prompt |
| --- | --- | --- |
| board-highlands.mp3 | Main board | Instrumental medieval fantasy board game background music, calm and adventurous, about two minutes. Wooden flute melody over plucked harp and lute arpeggios, soft strings and a gentle frame drum, D Dorian, 88 bpm. Warm, unobtrusive, loopable, steady energy without a big ending. No vocals. |
| board-shepherd.mp3 | Main board | Instrumental pastoral fantasy music for a strategy board game, about two minutes. Gentle waltz in 3/4, A minor, 76 bpm. Recorder and fiddle melody, nylon guitar and harp accompaniment, light hand percussion, soft cello. Peaceful, a little wistful, unobtrusive background, steady energy, no big ending. No vocals. |
| battle-clash.mp3 | Battle | Instrumental epic fantasy battle music for a strategy board game, about two minutes. E minor, 138 bpm. Driving staccato low strings ostinato, bold brass melody, taiko and snare drums, choir-free. Tense and heroic, steady intensity throughout, loopable, no big ending, no long quiet intro. No vocals. |
| battle-siege.mp3 | Battle | Instrumental dark fantasy siege battle music for a strategy board game, about two minutes. D minor, 120 bpm. Pounding war drums and taiko, ominous horns, low brass, tremolo strings, anvil hits. Menacing and relentless, steady intensity throughout, loopable, no big ending, no long quiet intro. No vocals. |
