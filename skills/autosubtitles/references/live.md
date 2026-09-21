# live

A review window that stays open as a conversation. The user picks a style, checks captions, and types requests to you in the window ("make the captions bigger", "fix the speaker's name everywhere"). You apply each one while they watch the video update, then they click **Render video**.

## The contract

Execute in order.

1. **Start.** `npx autosubtitles review <video> --live --json`. It returns at once with `action: "started"`; the window is now open. Tell the user it has opened and that they can ask for changes in the box at the bottom. Add `--preset <id>` to start on a style, `--captions` to open at the captions step.
2. **Poll.** `npx autosubtitles poll --json`. It blocks until the user does something, up to 10 minutes. Run it again immediately after every event you handle.
3. **On `steer`:** do what `message` asks using `reply` (below), always passing `--steer <id>` and a `--message`. Then poll again.
4. **On `render`:** finished. `outputs.mp4` is the file, `preset` is the style they ended on, `edited` says whether captions changed. Tell the user. The session is over; do not poll again.
5. **On `cancel` or `timeout`:** nothing was rendered and the session is over. `timeout` means nobody touched the window for 10 minutes. Ask what they would like; do not reopen it unasked.
6. **On `waiting`:** the poll timed out with nothing to report. Poll again.
7. **To end it yourself:** `npx autosubtitles close --json`.

Harness policy:

- **Claude Code:** run `poll` as a background task with no short timeout. You are notified when it completes, so the conversation stays free while the user works in the window.
- **Codex, Cursor and others:** run `poll` in the foreground, one shot, and restart it after each event.
- If you cannot keep a command waiting at all, use the `review` command instead.

Chat is overhead while the window is open. No recaps between events: the `--message` in the window is where the user is looking.

## The steer event

```json
{ "type": "steer", "id": 3, "message": "make the captions yellow and move them up",
  "state": { "preset": "classic", "overrides": {}, "step": "style", "captionCount": 115,
             "currentTime": 36.9, "activeCaption": "Yeah, she moved in like a year ago.",
             "edited": false, "watermark": true } }
```

`state.activeCaption` and `currentTime` tell you what they were looking at when they asked, which resolves requests like "fix this one".

## reply

```bash
npx autosubtitles reply --steer 3 --set textColor=#ffe600 --set positionY=60 \
  --message "Made the captions yellow and moved them up." --json
```

| Flag | Meaning |
|---|---|
| `--steer <id>` | The request this answers. Unlocks the box in the window |
| `--message <text>` | One short sentence shown under the box: what you changed. Always send one |
| `--preset <id>` | Switch style |
| `--set key=value` | Override one style value. Repeatable. Merged over earlier overrides |
| `--reset` | Drop every override, back to the plain style |
| `--replace "find=>with"` | Find and replace across all captions. Repeatable |
| `--step style\|captions` | Show that step, e.g. `captions` after a text fix so they can check it |

The result is `{ ok, state, changedCaptions }`. If `ok` is false nothing was changed: `error` says why (an unknown preset or a bad value). Fix it and reply again with the same `--steer`.

`--replace` matches whole words and phrases, ignoring case, keeps punctuation around the match, and copies a leading capital onto the replacement ("She left" becomes "Female left"). Each word keeps its timing when the word count is unchanged. If `changedCaptions` is 0, tell the user nothing matched.

If a request is unclear, or is something you cannot do here (cutting the video, translating, adding music), say so in `--message` and change nothing. A style the user clicks themselves resets your overrides: that is intended.

## Values for --set

| Key | Values |
|---|---|
| `textColor`, `backgroundColor`, `textOutlineColor`, `textShadowColor`, `wordHighlightColor`, `wordHighlightTextColor` | Hex colour, e.g. `#ffe600` |
| `fontSizeMultiplier` | `0.4` to `2.5`. `1` is the style's own size. "Bigger" is about `1.25` |
| `positionX`, `positionY` | Percent of the frame, `0` to `100`. `positionY=70` is the lower third; smaller is higher |
| `fontFamily` | Montserrat, Poppins, Roboto, Inter, Open Sans, Lato, Raleway, Nunito, Rubik, Barlow, Bebas Neue, Oswald, Anton, Archivo Black, Russo One, Bangers, Righteous, Fredoka, Lilita One, Titan One, Concert One, Fugaz One, Chewy, Shrikhand, Changa, Bungee, Permanent Marker, Caveat, Kalam, Pacifico, Lobster, Alfa Slab One, Creepster, Playfair Display, Komika Axis |
| `fontWeight` | `normal`, `bold` |
| `fontStyle` | `normal`, `italic` |
| `textCasing` | `original`, `uppercase`, `lowercase`, `titlecase` |
| `textAlign` | `left`, `center`, `right` |
| `showBackground`, `textOutline`, `textShadow`, `randomRotateLines` | `true`, `false` |
| `backgroundOpacity` | `0` to `100` |
| `backgroundStyle` | `auto`, `full-width`, `per-line` |
| `textOutlineWidth`, `borderRadius`, `backgroundPaddingX`, `backgroundPaddingY` | Percent of the font size |
| `maxLines` | `1`, `2` or `3` |
| `useMaxWordsPerLine` with `maxWordsPerLine` | `true` with a number, for short punchy lines |
| `animation` | `none`, `fade`, `pop`, `slide-block`, `slide-up`, `float-down`, `drop-in`, `reveal`, `karaoke`, `word-highlight`, `word-scale`, `flip`, `rotate-flip`, `stomp`, `wave` |
| `autoEmojis` | `off`, `on`, `auto` |
| `emojiPosition` | `top`, `bottom` |

Prefer switching `--preset` when the user describes a whole look ("like MrBeast", "clean and corporate"), and `--set` for a single property.
