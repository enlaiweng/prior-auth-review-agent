#!/usr/bin/env python3
"""Normalize a visit note to plain text, so no note stands out by its characters (Amendment 2, held-out notes).

Usage (from the repository root):
  python3 eval/tools/normalize_note.py data/golden/case_08/note.md   rewrites that note in place
  python3 eval/tools/normalize_note.py --check                       checks every golden note; changes nothing

Text pasted from a chat app often carries curly quotes, long dashes, non-breaking spaces, bullets, and markdown
markers. If the three restyled notes kept them, the held-out cases could be told apart by their characters
rather than by their writing style. This tool changes typography only, never words:
  curly quotes to straight quotes; long and short dashes to a hyphen; non-breaking and other odd spaces to a space;
  an ellipsis character to three dots; bullet characters to a hyphen; markdown bold, italic, and heading markers
  removed; trailing spaces removed; a labeled section line ("HPI:", "Exam:", "Plan:", up to four words before the
  colon) starts its own paragraph, so a template-style note keeps citable paragraphs; a heading alone on its line
  in capitals ("PLAN", "HISTORY OF PRESENT ILLNESS:") stays in one paragraph with the lines under it, so no
  paragraph is a bare heading; paragraphs separated by exactly one blank line; one final newline.
Anything else outside plain ASCII is reported and the tool stops, so a person decides what it should be.
--check fails if any golden note would change or holds a character outside plain ASCII.
"""
import glob, re, sys

SWAPS = {
    "‘": "'", "’": "'", "‚": "'", "′": "'",
    "“": '"', "”": '"', "„": '"', "″": '"',
    "–": "-", "—": "-", "‒": "-", "−": "-", "‐": "-", "‑": "-",
    " ": " ", " ": " ", " ": " ", " ": " ", "​": "",
    "…": "...", "•": "-", "·": "-",
}


def normalize(text):
    for a, b in SWAPS.items():
        text = text.replace(a, b)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"(?m)^#{1,6}\s*", "", text)          # heading markers
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)         # bold
    text = re.sub(r"(?<!\w)\*(\S.*?\S|\S)\*(?!\w)", r"\1", text)  # italic
    text = re.sub(r"(?m)^\s*[*]\s+", "- ", text)         # star bullets
    text = re.sub(r"[ \t]+$", "", text, flags=re.M)      # trailing spaces
    text = re.sub(r"(?m)(?<=\S)\n(?=[A-Z][A-Za-z/&]*(?: [A-Za-z/&]+){0,3}:\s)", "\n\n", text)  # sections
    text = re.sub(r"(?m)^([A-Z][A-Z /&-]{2,}:?)\n\n+(?=\S)", r"\1\n", text)  # a heading keeps its text
    text = re.sub(r"\n{3,}", "\n\n", text.strip()) + "\n"
    return text


def bad_chars(text):
    return sorted({c for c in text if ord(c) > 126 or (ord(c) < 32 and c != "\n")})


def main(argv):
    if argv == ["--check"]:
        problems = 0
        for path in sorted(glob.glob("data/golden/case_*/note.md")):
            text = open(path, encoding="utf-8").read()
            if normalize(text) != text or bad_chars(text):
                problems += 1
                print(f"{path}: not normalized; run python3 eval/tools/normalize_note.py {path}")
        print("all notes are plain text" if not problems else f"{problems} note(s) need normalizing")
        return 1 if problems else 0
    if len(argv) != 1:
        print(__doc__)
        return 1
    path = argv[0]
    text = normalize(open(path, encoding="utf-8").read())
    left = bad_chars(text)
    if left:
        print(f"{path}: characters outside plain ASCII remain: {' '.join(repr(c) for c in left)}. Edit them by hand.")
        return 1
    open(path, "w", encoding="utf-8").write(text)
    paras = [p for p in text.split("\n\n") if p.strip()]
    print(f"{path}: normalized, {len(paras)} paragraphs")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
