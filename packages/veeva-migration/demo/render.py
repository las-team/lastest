#!/usr/bin/env python3
"""
Render `demo-run.ts`'s timeline into an MP4 screencast with burned-in
subtitles, plus a standalone .srt sidecar.

    python3 demo/render.py timeline.jsonl out/veeva-migration-demo.mp4

Frames are drawn with Pillow and streamed raw into ffmpeg; only distinct
states are drawn (a still second costs one render, not thirty).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import textwrap
from dataclasses import dataclass, field

from PIL import Image, ImageDraw, ImageFont

W, H, FPS = 1920, 1080, 30

BG = (11, 15, 26)
PANEL = (16, 21, 34)
CHROME = (23, 30, 46)
BORDER = (38, 48, 70)
CAPTION_BG = (8, 11, 19)
CAPTION_FG = (238, 242, 250)

COLORS = {
    "cmd": (126, 231, 135),
    "out": (201, 209, 217),
    "ok": (86, 211, 100),
    "warn": (227, 179, 65),
    "dim": (110, 118, 129),
    "head": (121, 192, 255),
    "key": (210, 168, 255),
}
BOLD_STYLES = {"head", "key", "cmd"}

MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
MONO_B = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"
SANS = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
SANS_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

f_mono = ImageFont.truetype(MONO, 21)
f_mono_b = ImageFont.truetype(MONO_B, 21)
f_title = ImageFont.truetype(SANS_B, 22)
f_chapter = ImageFont.truetype(SANS_B, 24)
f_caption = ImageFont.truetype(SANS, 33)

TERM_X, TERM_Y = 56, 150
TERM_W, TERM_H = W - 2 * TERM_X, 700
LINE_H = 29
COLS = 132
ROWS = TERM_H // LINE_H

CPS_TYPE = 32.0          # typing speed, characters per second
CPS_READ = 17.0          # subtitle reading speed, characters per second
SUB_MIN, SUB_MAX = 1.9, 7.5
SUB_WIDTH, SUB_LINES = 62, 2
CAPTION_LEAD = 0.45      # share of a narration block that plays before the terminal moves on


@dataclass
class State:
    lines: tuple = ()
    chapter: str = ""
    caption: str = ""
    cursor: bool = False
    card: tuple = ()   # (title, subtitle, body lines) — a full-screen title card


@dataclass
class Sim:
    """Two tracks on one clock: terminal states, and subtitle cues that keep
    playing while the terminal carries on underneath them."""

    buf: list = field(default_factory=list)
    chapter: str = ""
    cursor: bool = False
    card: tuple = ()
    frames: list = field(default_factory=list)   # (start, State-without-caption)
    cues: list = field(default_factory=list)     # (start, end, text)
    t: float = 0.0

    def snap(self) -> State:
        return State(tuple(self.buf[-ROWS:]), self.chapter, "", self.cursor, self.card)

    def hold(self, dur: float) -> None:
        if dur <= 0:
            return
        self.frames.append((self.t, self.snap()))
        self.t += dur

    def say(self, text: str, hold: float) -> None:
        """Queue narration. Only `LEAD` of it blocks the terminal — the rest
        plays over whatever runs next, the way a voice-over would."""
        start = max(self.t, self.cues[-1][1] if self.cues else 0.0)
        spoken = 0.0
        for cue in wrap_caption(text):
            dur = min(SUB_MAX, max(SUB_MIN, len(cue) / CPS_READ))
            self.cues.append((start + spoken, start + spoken + dur, cue))
            spoken += dur
        lead = max(0.0, start - self.t) + spoken * CAPTION_LEAD
        self.hold(lead + hold)


def wrap_caption(text: str) -> list[str]:
    """Split narration into balanced subtitle cues, breaking at clause
    boundaries where there is one near the target length.

    A greedy fill leaves orphan cues holding two words, and a purely balanced
    split cuts phrases in half ("… ordered so" / "that every foreign key …").
    """
    words = text.split()
    if not words:
        return []
    limit = SUB_WIDTH * SUB_LINES
    for n in range(1, len(words) + 1):
        target = len(text) / n
        if target > limit:
            continue
        cues, cur, rest = [], [], list(words)
        while rest:
            cur.append(rest.pop(0))
            joined = " ".join(cur)
            if len(cues) == n - 1:
                continue
            if len(joined) < target * 0.65:
                continue
            # break here, unless the next word gets us closer to the target
            # or ends a clause within reach of it
            nxt = " ".join(cur + rest[:1]) if rest else joined
            here = abs(len(joined) - target) - (14 if cur[-1][-1] in ".,;:—" else 0)
            there = abs(len(nxt) - target) - (
                14 if rest and rest[0][-1] in ".,;:—" else 0
            )
            if there < here and len(nxt) <= limit:
                continue
            cues.append(joined)
            cur = []
        if cur:
            cues.append(" ".join(cur))
        if all(len(textwrap.wrap(c, SUB_WIDTH)) <= SUB_LINES for c in cues):
            return cues
    return [text]


def simulate(events: list[dict]) -> Sim:
    s = Sim()
    s.hold(1.2)
    for e in events:
        kind = e["t"]
        if kind == "chapter":
            # a real session scrolls; only a rule marks the new chapter
            s.chapter = e["text"]
            s.buf.append(("out", ""))
            s.buf.append(("head", f"── {e['text']} " + "─" * max(0, COLS - len(e["text"]) - 4)))
            s.hold(0.9)
        elif kind == "caption":
            s.say(e["text"], float(e.get("hold", 0)) or 0.2)
        elif kind == "line":
            style, text = e.get("style", "out"), e["text"]
            if e.get("type"):
                s.buf.append((style, ""))
                s.cursor = True
                for i in range(1, len(text) + 1):
                    s.buf[-1] = (style, text[:i])
                    s.hold(1.0 / CPS_TYPE)
                s.cursor = False
                s.hold(float(e.get("pause", 0)))
            else:
                s.buf.append((style, text))
                s.hold(float(e.get("pause", 0.05)))
        elif kind == "pause":
            s.hold(float(e["dur"]))
        elif kind == "card":
            s.card = (e["title"], e.get("subtitle", ""), tuple(e.get("lines", [])))
            s.hold(float(e.get("dur", 4.0)))
            s.card = ()
            s.hold(0.4)
    # let any narration still in flight finish before the picture ends
    tail = max((c[1] for c in s.cues), default=0.0)
    s.hold(max(1.4, tail - s.t + 1.0))
    return s


def compose(sim: Sim) -> list:
    """Merge both tracks into (State, duration) segments on frame boundaries."""
    marks = {round(t, 3) for t, _ in sim.frames}
    for start, end, _ in sim.cues:
        marks.add(round(start, 3))
        marks.add(round(end, 3))
    marks = sorted(m for m in marks if m < sim.t)
    segments = []
    for i, m in enumerate(marks):
        end = marks[i + 1] if i + 1 < len(marks) else sim.t
        state = [st for t, st in sim.frames if t <= m + 1e-6][-1]
        caption = next((c[2] for c in sim.cues if c[0] <= m + 1e-6 < c[1]), "")
        segments.append(
            (State(state.lines, state.chapter, caption, state.cursor, state.card), end - m)
        )
    return segments


f_card = ImageFont.truetype(SANS_B, 62)
f_card_sub = ImageFont.truetype(SANS, 32)
f_card_body = ImageFont.truetype(SANS, 26)


def draw_card(d: ImageDraw.ImageDraw, card: tuple) -> None:
    title, subtitle, body = card
    y = 380
    tw = d.textlength(title, font=f_card)
    d.text(((W - tw) / 2, y), title, font=f_card, fill=(238, 242, 250))
    y += 96
    if subtitle:
        sw = d.textlength(subtitle, font=f_card_sub)
        d.text(((W - sw) / 2, y), subtitle, font=f_card_sub, fill=(121, 192, 255))
        y += 74
    d.line((W / 2 - 220, y, W / 2 + 220, y), fill=BORDER, width=2)
    y += 40
    for ln in body:
        lw = d.textlength(ln, font=f_card_body)
        d.text(((W - lw) / 2, y), ln, font=f_card_body, fill=(150, 162, 184))
        y += 42


def draw(state: State) -> Image.Image:
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    if state.card:
        draw_card(d, state.card)
        return img

    # window
    d.rounded_rectangle((36, 96, W - 36, TERM_Y + TERM_H + 26), 14, fill=PANEL, outline=BORDER, width=1)
    d.rounded_rectangle((36, 96, W - 36, 140), 14, fill=CHROME)
    d.rectangle((36, 126, W - 36, 140), fill=CHROME)
    for i, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        d.ellipse((62 + i * 26, 111, 74 + i * 26, 123), fill=c)
    d.text((150, 106), "veeva-migration  ·  Veeva CRM (Salesforce) → Vault CRM", font=f_title, fill=(150, 162, 184))
    if state.chapter:
        w = d.textlength(state.chapter, font=f_chapter)
        d.text((W - 36 - 28 - w, 105), state.chapter, font=f_chapter, fill=(121, 192, 255))

    # terminal body
    y = TERM_Y
    for style, text in state.lines:
        font = f_mono_b if style in BOLD_STYLES else f_mono
        d.text((TERM_X + 24, y), text[:COLS], font=font, fill=COLORS.get(style, COLORS["out"]))
        y += LINE_H
    if state.cursor and state.lines:
        last = state.lines[-1][1][:COLS]
        cx = TERM_X + 24 + d.textlength(last, font=f_mono_b)
        d.rectangle((cx + 1, y - LINE_H + 3, cx + 11, y - 6), fill=(126, 231, 135))

    # caption band
    if state.caption:
        lines = textwrap.wrap(state.caption, SUB_WIDTH)
        band_h = 20 + len(lines) * 44
        top = H - 40 - band_h
        d.rounded_rectangle((W // 2 - 700, top, W // 2 + 700, top + band_h), 12, fill=CAPTION_BG)
        ty = top + 10
        for ln in lines:
            tw = d.textlength(ln, font=f_caption)
            d.text(((W - tw) / 2, ty), ln, font=f_caption, fill=CAPTION_FG)
            ty += 44
    return img


def srt_time(t: float) -> str:
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"


def write_srt(cues: list, path: str) -> None:
    out = []
    for i, (start, end, text) in enumerate(cues, 1):
        body = "\n".join(textwrap.wrap(text, SUB_WIDTH))
        out.append(f"{i}\n{srt_time(start)} --> {srt_time(end)}\n{body}\n")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(out))


def main() -> None:
    timeline, out_mp4 = sys.argv[1], sys.argv[2]
    events = [json.loads(l) for l in open(timeline) if l.strip()]
    sim = simulate(events)
    segments = compose(sim)
    total = sum(d for _, d in segments)
    print(f"{len(segments)} segments · {len(sim.cues)} subtitle cues · {total:.1f}s", file=sys.stderr)

    os.makedirs(os.path.dirname(out_mp4) or ".", exist_ok=True)
    write_srt(sim.cues, os.path.splitext(out_mp4)[0] + ".srt")

    import imageio_ffmpeg
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    proc = subprocess.Popen(
        [ff, "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
         "-i", "-", "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
         "-pix_fmt", "yuv420p", "-movflags", "+faststart", out_mp4],
        stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    emitted = 0
    elapsed = 0.0
    for state, dur in segments:
        elapsed += dur
        frames = max(1, int(round(elapsed * FPS)) - emitted)
        buf = draw(state).tobytes()
        for _ in range(frames):
            proc.stdin.write(buf)
        emitted += frames
    proc.stdin.close()
    proc.wait()
    print(f"{emitted} frames ({emitted / FPS:.1f}s) → {out_mp4}", file=sys.stderr)


if __name__ == "__main__":
    main()
