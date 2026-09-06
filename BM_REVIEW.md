# BM Review Sheet — CAKAP LAH!

**For:** Nezriq (BM content QA owner)  
**From:** generated from `content/scenarios/*.json` — re-run `python3 scripts/bm_review.py` after edits.

Every Bahasa Melayu line in the game is below. The **structure and meaning targets are settled** —
what needs your ear is whether each line sounds like a real Malaysian would say it, in the right register
for that character. Mark anything that reads as textbook, stiff, or just wrong, and write the version you'd say.

- 🔊 spoken aloud by TTS — the player hears this. Register matters most here.
- 👁 shown on screen only — instruction text, never spoken.
- **Sample answers** are examples given to the AI evaluator to show the *range* of acceptable replies.
  They are never matched literally, so they mainly need to be *plausible*, not perfect.

---

## 1. Mamak Mission  ·  `mamak_01`

**Scene:** It is 10pm. You are at a mamak with friends. You want a teh tarik — but less sweet.  
**Character:** Abang Mamak (voice `paan-f695215e`)

### Narrator intro — 🔊 spoken aloud by TTS

> Pukul sepuluh malam. Anda di mamak dengan kawan-kawan. Abang mamak datang ambil pesanan.

- [o] Approved as-is  
- Correction: `________________________________________`

### Re-prompt line  ·  Abang Mamak — 🔊 spoken aloud by TTS

_Played when the generated reply had to be discarded — the character simply asks again._

> Hah? Bang cakap apa tu? Sekali lagi.

- [o] Approved  ·  Correction: `________________________________`

### Step 1 — `order`  ·  levels 1/2/3  ·  Abang Mamak

**Abang Mamak says** — 🔊 spoken aloud by TTS

> Ya boss, nak minum apa?

- [o] Approved  ·  Correction: `________________________________`

**Task hint (Malay, level 2)** — 👁 shown on screen only

> Pesan satu teh tarik, dan minta kurang manis.

- [o] Approved  ·  Correction: `________________________________`

**Retry hint** — 👁 shown on screen only

> Sebut minuman yang anda mahu, dan cara anda mahu ia dibuat.

- [o] Approved  ·  Correction: `________________________________`

**Sample answers** — shown to the evaluator as examples of acceptable range:

- [o] Saya nak teh tarik satu, kurang manis.
- [o] Boleh bagi satu teh tarik kurang manis?
- [o] Teh tarik satu boss, jangan manis sangat.
- [o] Bang, teh tarik satu ya, kurang gula.

- Would a real person say something else here? `________________________________`

### Step 2 — `wrong_order`  ·  levels 1/2/3  ·  Abang Mamak

**Abang Mamak says** — 🔊 spoken aloud by TTS

> Ni dia! Milo ais satu, sejuk-sejuk.

- [o] Approved  ·  Correction: `________________________________`

**Task hint (Malay, level 2)** — 👁 shown on screen only

> Itu bukan pesanan anda. Beritahu dia dengan sopan, dan sebut semula apa yang anda pesan.

- [o] Approved  ·  Correction: `________________________________`

**Retry hint** — 👁 shown on screen only

> Beritahu abang tu minuman ini bukan yang anda pesan, kemudian sebut semula pesanan anda.

- [o] Approved  ·  Correction: `________________________________`

**Sample answers** — shown to the evaluator as examples of acceptable range:

- [o] Maaf boss, saya pesan teh tarik kurang manis tadi.
- [o] Eh bang, ini Milo. Saya minta teh tarik tadi.
- [o] Bang, ini bukan pesanan saya. Saya nak teh tarik.
- [o] Sorry boss, saya order teh tarik, bukan Milo.

- Would a real person say something else here? `________________________________`

### Step 3 — `upsell`  ·  levels 3  ·  Abang Mamak

**Abang Mamak says** — 🔊 spoken aloud by TTS

> Ha, dah betul. Nak tambah apa-apa tak? Roti telur? Cheese Naan?

- [o] Nezriq's correction — APPLIED 6 Sep 2026.

**Task hint (Malay, level 2)** — 👁 shown on screen only

> Anda tak nak apa-apa lagi. Tolak dengan sopan — jangan sekadar cakap tidak.

- [o] Approved  ·  Correction: `________________________________`

**Retry hint** — 👁 shown on screen only

> Cuba tolak dengan lembut — ucap terima kasih atau bagi sebab ringkas.

- [o] Approved  ·  Correction: `________________________________`

**Sample answers** — shown to the evaluator as examples of acceptable range:

- [o] Tak apa bang, terima kasih. Minum je cukup.
- [o] Lain kali lah bang, saya dah makan tadi.
- [o] Tak payah bang, teh tarik je. Terima kasih ya.
- [o] Cukup lah ni, terima kasih boss.

- Would a real person say something else here? `________________________________`

### Closing line  ·  Abang Mamak — 🔊 spoken aloud by TTS

> Aduh, salah meja tadi! Maaf ya boss. Datang lagi tau.

- [o] Approved  ·  Correction: `________________________________`

---

## 2. Mall Rescue  ·  `mall_01`

**Scene:** You are in a shopping mall and you cannot find the food court. Ask someone.  
**Character:** Abang Guard (voice `ali-13002bfa`)

### Narrator intro — 🔊 spoken aloud by TTS

> Anda di dalam sebuah mall yang besar. Dah pusing dua kali, food court masih tak jumpa. Ada seorang abang guard berdiri dekat eskalator.

- [o] Approved as-is  
- Correction: `________________________________________`

### Re-prompt line  ·  Abang Guard — 🔊 spoken aloud by TTS

_Played when the generated reply had to be discarded — the character simply asks again._

> Maaf encik, boleh ulang sekali lagi?

- [o] Approved  ·  Correction: `________________________________`

### Step 1 — `ask`  ·  levels 1/2/3  ·  Abang Guard

**Abang Guard says** — 🔊 spoken aloud by TTS

> Ya? Boleh saya tolong?

- [o] Approved  ·  Correction: `________________________________`

**Task hint (Malay, level 2)** — 👁 shown on screen only

> Tanya dia dengan sopan di mana food court.

- [o] Approved  ·  Correction: `________________________________`

**Retry hint** — 👁 shown on screen only

> Tanya di mana food court itu — cuba mula dengan 'Maaf bang' atau 'Tumpang tanya'.

- [o] Approved  ·  Correction: `________________________________`

**Sample answers** — shown to the evaluator as examples of acceptable range:

- [o] Maaf bang, food court kat mana ya?
- [o] Bang, macam mana nak pergi ke food court?
- [o] Excuse me, saya nak cari food court. Kat tingkat berapa ya?
- [o] Tumpang tanya bang, food court sebelah mana?

- Would a real person say something else here? `________________________________`

### Step 2 — `confirm`  ·  levels 1/2/3  ·  Abang Guard

**Abang Guard says** — 🔊 spoken aloud by TTS

> Oh, food court kat tingkat empat. Naik eskalator ni sampai atas, lepas tu belok kiri. Ada papan tanda besar, tak boleh miss punya.

- [o] Approved  ·  Correction: `________________________________`

**Task hint (Malay, level 2)** — 👁 shown on screen only

> Ulang semula arah tadi untuk pastikan anda faham — tingkat, eskalator, belok mana.

- [o] Approved  ·  Correction: `________________________________`

**Retry hint** — 👁 shown on screen only

> Sebut semula tiga perkara: tingkat berapa, naik apa, dan belok ke mana.

- [o] Approved  ·  Correction: `________________________________`

**Sample answers** — shown to the evaluator as examples of acceptable range:

- [o] Jadi naik eskalator sampai tingkat empat, lepas tu belok kiri?
- [o] Okay, tingkat empat, naik eskalator, belok kiri ya?
- [o] Naik atas tingkat empat, keluar eskalator belok kiri. Betul tak bang?
- [o] Tingkat empat, belok kiri lepas eskalator. Terima kasih bang.

- Would a real person say something else here? `________________________________`

### Step 3 — `give_directions`  ·  levels 3  ·  Makcik

**Makcik says** — 🔊 spoken aloud by TTS

> Dik, dik. Sorry ya. Makcik nak tanya, food court kat mana ek? Makcik dah pusing-pusing tak jumpa.

- [o] Approved  ·  Correction: `________________________________`

**Makcik's re-prompt line** — 🔊 spoken aloud by TTS

> Aduh, makcik tak berapa faham la dik. Cuba cakap sekali lagi?

- [o] Approved  ·  Correction: `________________________________`

**Task hint (Malay, level 2)** — 👁 shown on screen only

> Sekarang orang pula tanya anda. Bagi arah yang anda baru dapat tadi.

- [o] Approved  ·  Correction: `________________________________`

**Retry hint** — 👁 shown on screen only

> Bagi arah ikut turutan — naik apa dulu, ke tingkat berapa, lepas tu belok mana.

- [o] Approved  ·  Correction: `________________________________`

**Sample answers** — shown to the evaluator as examples of acceptable range:

- [o] Makcik naik eskalator ni sampai tingkat empat, lepas tu belok kiri. Ada papan tanda besar.
- [o] Tingkat empat makcik. Naik eskalator sana, keluar je belok kiri.
- [o] Senang je makcik — naik eskalator ni, tingkat empat, kemudian belok kiri terus nampak.
- [o] Makcik pergi tingkat empat naik eskalator tu, lepas tu kiri.

- Would a real person say something else here? `________________________________`

### Closing line  ·  levels 1/2  ·  Abang Guard — 🔊 spoken aloud by TTS

> Sama-sama! Kalau sesat lagi, cari abang tau.

- [o] Approved  ·  Correction: `________________________________`

### Closing line  ·  levels 3  ·  Makcik — 🔊 spoken aloud by TTS

> Terima kasih ya dik! Baik betul orang muda zaman sekarang.

- [o] Approved  ·  Correction: `________________________________`

---

## 3. Office Panic  ·  `office_01`

**Scene:** Your manager stops by your desk. The report from yesterday is not finished.  
**Character:** Kak Ana (voice `nur-b184422b`)

### Narrator intro — 🔊 spoken aloud by TTS

> Pagi Isnin. Anda baru sampai pejabat, kopi pun belum habis. Kak Ana berhenti depan meja anda.

- [o] Approved as-is  
- Correction: `________________________________________`

### Re-prompt line  ·  Kak Ana — 🔊 spoken aloud by TTS

_Played when the generated reply had to be discarded — the character simply asks again._

> Macam mana dengan report itu? Dah siap ke?

- [o] Nezriq's correction — APPLIED 6 Sep 2026.

### Step 1 — `status`  ·  levels 1/2/3  ·  Kak Ana

**Kak Ana says** — 🔊 spoken aloud by TTS

> Wei, report semalam dah siap ke?

- [o] Approved  ·  Correction: `________________________________`

**Task hint (Malay, level 2)** — 👁 shown on screen only

> Report belum siap. Beritahu dengan jujur, terangkan sampai mana, dan bagitahu bila anda akan hantar.

- [o] Approved  ·  Correction: `________________________________`

**Retry hint** — 👁 shown on screen only

> Cakap tiga perkara: belum siap, sampai mana anda dah buat, dan bila anda akan hantar.

- [o] Approved  ·  Correction: `________________________________`

**Sample answers** — shown to the evaluator as examples of acceptable range:

- [o] Belum siap lagi. Saya tengah buat sekarang, petang ni saya hantar.
- [o] Maaf kak, belum habis. Tinggal sikit je, nanti petang saya email.
- [o] Belum lagi kak. Saya dah buat separuh, hari ni juga saya siapkan.
- [o] Sorry kak, tak sempat semalam. Saya sambung pagi ni, petang ni siap.

- Would a real person say something else here? `________________________________`

### Step 2 — `pin_down`  ·  levels 1/2/3  ·  Kak Ana

**Kak Ana says** — 🔊 spoken aloud by TTS

> Petang ni tu pukul berapa? Saya ada meeting pukul empat, kena bawa report tu.

- [o] Approved  ·  Correction: `_"Hari ini to replace "petang ini"__`

**Task hint (Malay, level 2)** — 👁 shown on screen only

> Dia perlukan masa yang tepat. Bagi satu masa — dan pastikan ia sempat sebelum meeting pukul empat dia.

- [o] Approved  ·  Correction: `________________________________`

**Retry hint** — 👁 shown on screen only

> Bagi satu masa yang tepat, dan pastikan ia sebelum pukul empat.

- [o] Approved  ·  Correction: `________________________________`

**Sample answers** — shown to the evaluator as examples of acceptable range:

- [o] Boleh, sebelum pukul tiga saya hantar.
- [o] Pukul dua setengah kak, sempat lah untuk meeting.
- [o] Saya hantar sebelum pukul tiga, jadi kak ada masa nak baca dulu.
- [o] Confirm sebelum pukul tiga kak, saya email terus.

- Would a real person say something else here? `________________________________`

### Step 3 — `cover_me`  ·  levels 3  ·  Kak Ana

**Kak Ana says** — 🔊 spoken aloud by TTS

> Okay. Eh, satu lagi — client call pukul sebelas ni saya tak boleh masuk. Boleh tolong ambil alih tak?

- [o] Approved  ·  Correction: `________________________________`

**Task hint (Malay, level 2)** — 👁 shown on screen only

> Pagi anda dah padat. Sama ada terima dan beritahu apa yang anda tangguh, atau tolak dan tawarkan cara lain untuk membantu.

- [o] Approved  ·  Correction: `________________________________`

**Retry hint** — 👁 shown on screen only

> Bagi jawapan yang jelas — terima atau tolak — dan cakap kesannya pada report tadi.

- [o] Approved  ·  Correction: `________________________________`

**Sample answers** — shown to the evaluator as examples of acceptable range:

- [o] Boleh kak, tapi kalau macam tu report tu saya hantar pukul empat lah ya.
- [o] Aduh kak, kalau saya masuk call tu report lambat sikit. Boleh minta Aiman ganti?
- [o] Boleh je, tapi saya kena tangguh report sampai lepas lunch.
- [o] Saya rasa tak sempat kak. Macam mana kalau saya hantar nota untuk kak guna dalam call?

- Would a real person say something else here? `________________________________`

### Closing line  ·  Kak Ana — 🔊 spoken aloud by TTS

> Okay, pastikan report itu siap untuk saya semak sebelum meeting ya.

- [o] Nezriq's correction — APPLIED 6 Sep 2026.

---

## Shared fallback line  ·  not tied to one character

**Last-resort re-prompt** (`DEFAULT_REPROMPT`, `server/adapters/evaluator.js`) — 🔊 spoken aloud by TTS

> Hah? Macam mana tu? Cuba cakap sekali lagi.

- [o] Approved  ·  Correction: `________________________________`

---

## Specific things I'm unsure about

These are the calls a non-native writer can't make confidently — worth a second look:

1. **Mamak register** — is `Ya boss, nak minum apa?` how an abang mamak actually opens?
   Is `sejuk-sejuk` natural for describing the Milo?
2. **Makcik's register** (Mall Rescue, L3) — `Dik, dik. Sorry ya.` Does mixing `sorry` in read right
   for an older speaker, or should it be fully BM?
3. **Kak Ana as a manager** — does `Kak` read as *manager* or as *peer*? If she's the boss,
   should `Wei, report semalam dah siap ke?` be softer, or is that exactly right for a Malaysian office?
4. **`cover_me` step** (Office Panic, L3) — is asking a subordinate to cover a client call
   a realistic Malaysian workplace ask, or does it need reframing?
5. **Task hints in Malay** — these are instructions, not dialogue. Should they sound like a
   game narrator or like a teacher? Currently written flat and neutral.

