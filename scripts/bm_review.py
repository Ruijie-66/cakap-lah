#!/usr/bin/env python3
"""Generate BM_REVIEW.md — every Bahasa Melayu line in the scenarios, flattened
for review. Re-run after editing any scenario JSON.

    python3 scripts/bm_review.py
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "content" / "scenarios"
OUT = ROOT / "BM_REVIEW.md"

SPOKEN = "🔊 spoken aloud by TTS"
SCREEN = "👁 shown on screen only"

lines = [
    "# BM Review Sheet — CAKAP LAH!",
    "",
    "**For:** Nezriq (BM content QA owner)  ",
    "**From:** generated from `content/scenarios/*.json` — re-run `python3 scripts/bm_review.py` after edits.",
    "",
    "Every Bahasa Melayu line in the game is below. The **structure and meaning targets are settled** —",
    "what needs your ear is whether each line sounds like a real Malaysian would say it, in the right register",
    "for that character. Mark anything that reads as textbook, stiff, or just wrong, and write the version you'd say.",
    "",
    f"- {SPOKEN} — the player hears this. Register matters most here.",
    f"- {SCREEN} — instruction text, never spoken.",
    "- **Sample answers** are examples given to the AI evaluator to show the *range* of acceptable replies.",
    "  They are never matched literally, so they mainly need to be *plausible*, not perfect.",
    "",
    "---",
    "",
]

for path in sorted(SRC.glob("*.json"), key=lambda p: json.load(open(p))["order"]):
    d = json.load(open(path))
    lines += [
        f"## {d['order']}. {d['title']}  ·  `{d['id']}`",
        "",
        f"**Scene:** {d['context']}  ",
        f"**Character:** {d['npc_name']} (voice `{d['voice_id']}`)",
        "",
        f"### Narrator intro — {SPOKEN}",
        "",
        "> " + d["intro"]["text"],
        "",
        "- [ ] Approved as-is  ",
        "- Correction: `________________________________________`",
        "",
        f"### Re-prompt line  ·  {d['npc_name']} — {SPOKEN}",
        "",
        "_Played when the generated reply had to be discarded — the character simply asks again._",
        "",
        "> " + d["npc_reprompt"],
        "",
        "- [ ] Approved  ·  Correction: `________________________________`",
        "",
    ]

    for i, s in enumerate(d["steps"], 1):
        who = s.get("npc_name", d["npc_name"])
        levels = "/".join(str(x) for x in s["levels"])
        lines += [
            f"### Step {i} — `{s['id']}`  ·  levels {levels}  ·  {who}",
            "",
            f"**{who} says** — {SPOKEN}",
            "",
            "> " + s["tts_prompt"],
            "",
            "- [ ] Approved  ·  Correction: `________________________________`",
            "",
        ]
        if s.get("npc_reprompt"):
            lines += [
                f"**{who}'s re-prompt line** — {SPOKEN}",
                "",
                "> " + s["npc_reprompt"],
                "",
                "- [ ] Approved  ·  Correction: `________________________________`",
                "",
            ]
        lines += [
            f"**Task hint (Malay, level 2)** — {SCREEN}",
            "",
            "> " + s["task_ms"],
            "",
            "- [ ] Approved  ·  Correction: `________________________________`",
            "",
            f"**Retry hint** — {SCREEN}",
            "",
            "> " + s["retry_hint"],
            "",
            "- [ ] Approved  ·  Correction: `________________________________`",
            "",
            "**Sample answers** — shown to the evaluator as examples of acceptable range:",
            "",
        ]
        for a in s["sample_answers"]:
            lines.append(f"- [ ] {a}")
        lines += [
            "",
            "- Would a real person say something else here? `________________________________`",
            "",
        ]

    # `complete` is one block, or a list of level-gated variants when the
    # closing speaker differs by level (mall_01 hands over to a second
    # character only at level 3).
    closings = d["complete"]
    if not isinstance(closings, list):
        closings = [closings]
    for c in closings:
        who = c.get("npc_name", d["npc_name"])
        levels = c.get("levels")
        scope = "  ·  levels " + "/".join(str(x) for x in levels) if levels else ""
        lines += [
            f"### Closing line{scope}  ·  {who} — {SPOKEN}",
            "",
            "> " + c["npc_line"],
            "",
            "- [ ] Approved  ·  Correction: `________________________________`",
            "",
        ]
    lines += [
        "---",
        "",
    ]

# Not from content/: the last-resort re-prompt in server/adapters/evaluator.js,
# used only if a scenario ever ships without its own `npc_reprompt`. Kept in
# this sheet because a player can hear it. Mirror any correction into
# DEFAULT_REPROMPT there.
lines += [
    "## Shared fallback line  ·  not tied to one character",
    "",
    f"**Last-resort re-prompt** (`DEFAULT_REPROMPT`, `server/adapters/evaluator.js`) — {SPOKEN}",
    "",
    "> Hah? Macam mana tu? Cuba cakap sekali lagi.",
    "",
    "- [ ] Approved  ·  Correction: `________________________________`",
    "",
    "---",
    "",
]

lines += [
    "## Specific things I'm unsure about",
    "",
    "These are the calls a non-native writer can't make confidently — worth a second look:",
    "",
    "1. **Mamak register** — is `Ya boss, nak minum apa?` how an abang mamak actually opens?",
    "   Is `sejuk-sejuk` natural for describing the Milo?",
    "2. **Makcik's register** (Mall Rescue, L3) — `Dik, dik. Sorry ya.` Does mixing `sorry` in read right",
    "   for an older speaker, or should it be fully BM?",
    "3. **Kak Ana as a manager** — does `Kak` read as *manager* or as *peer*? If she's the boss,",
    "   should `Wei, report semalam dah siap ke?` be softer, or is that exactly right for a Malaysian office?",
    "4. **`cover_me` step** (Office Panic, L3) — is asking a subordinate to cover a client call",
    "   a realistic Malaysian workplace ask, or does it need reframing?",
    "5. **Task hints in Malay** — these are instructions, not dialogue. Should they sound like a",
    "   game narrator or like a teacher? Currently written flat and neutral.",
    "",
]

OUT.write_text("\n".join(lines) + "\n")
print(f"wrote {OUT.relative_to(ROOT)}")
