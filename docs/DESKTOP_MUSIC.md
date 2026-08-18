# Driving the mascot from a desktop music app

The Spotify Web API cannot do this. Since February 2026 a newly created app is
limited to five people, each added by hand in the dashboard by the email on
their Spotify account, and lifting that limit requires a legally registered
business with at least 250,000 monthly active users. The endpoints that carried
tempo were closed to new apps in November 2024, so even within those five it
would only ever have supplied a title.

None of that stands in the way locally. The macOS Spotify and Music apps have
answered AppleScript for years. There is no account, no quota, no client id, and
nothing a network can block.

There are two separate things to get from the app, and they arrive by different
routes.

## The title: run the helper

```
node tools/desktop-music.mjs            # Spotify
node tools/desktop-music.mjs --app Music  # Apple Music
```

Then open **http://127.0.0.1:7476/#dj**.

The helper serves the site as well as the feed. That is not a convenience: an
https page cannot fetch a plain http address, and loopback is not the exception
the specification implies. The deployed site fetching `127.0.0.1` was measured
failing in Chrome even with the private-network header in place. Serving both
from one origin leaves nothing to block, no CORS, and no certificate to arrange.

The first request makes macOS ask whether the terminal may control Spotify. Say
yes once. If it was refused, it is in System Settings, Privacy and Security,
Automation.

What arrives: title, artist, album, elapsed and remaining, refreshed every few
seconds, filling the ticker and marking matching requests as played.

## The beat: route the audio

The helper reports what is playing. It does not carry audio, so on its own the
mascot moves at an assumed tempo. Three ways to give it the real one, best
first.

### Play the track in the page

The **Play a track** button. The file is decoded in the page and fed straight to
the analyser, so onsets land on the actual transients. Nothing to install, and
the cleanest signal available. Measured 117 BPM against a 120 BPM loop.

### A loopback audio device

To keep using Spotify itself while the page hears it properly, install
[BlackHole](https://existential.audio/blackhole/), a free 2-channel virtual
audio device.

1. Open **Audio MIDI Setup**, click **+**, choose **Create Multi-Output Device**
2. Tick both your speakers and **BlackHole 2ch**
3. Set that Multi-Output Device as the system output, so sound still reaches the
   speakers as well as BlackHole
4. Press **Microphone** on the page and choose **BlackHole 2ch** as the input

The page now hears the app's output directly: no room noise, no speaker
colouring, and the real beat. Pair it with the helper above and you have the
title and the beat together.

### The microphone

Point it at the speakers. Always available, works with any source in the room
including a phone or a PA, and copes with a noisy room better than expected. It
is the fallback the whole design assumes.

## What this does not do

The helper reads. It does not skip, pause, or change anything in the music app,
and it binds to `127.0.0.1`, so nothing off this machine can reach it.
