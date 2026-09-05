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

- [ ] Approved as-is  
- Correction: `________________________________________`

### Re-prompt line  ·  Abang Mamak — 🔊 spoken aloud by TTS

_Played when the generated reply had to be discarded — the character simply asks again._

> Hah? Bang cakap apa tu? Sekali lagi.

- [ ] Approved  ·  Correction: `________________________________`

### Step 1 — `order`  ·  levels 1/2/3  ·  Abang Mamak

**Abang Mamak says** — 🔊 spoken aloud by TTS

> Ya boss, nak minum apa?

- [ ] Approved  ·  Correction: `________________________________`

**Task hint (Malay, level 2)** — 👁 shown on screen only

> Pesan satu teh tarik, dan minta kurang manis.

- [ ] Approved  ·  Correction: `________________________________`

**Retry hint** — 👁 shown on screen only

> Sebut minuman yang anda mahu, dan cara anda mahu ia dibuat.

- [ ] Approved  ·  Correction: `________________________________`

**Sample answers** — shown to the evaluator as examples of acceptable range:

- [ ] Saya nak teh tarik satu, kurang manis.
- [ ] Boleh bagi satu teh tarik kurang manis?
- [ ] Teh tarik satu boss, jangan manis sangat.
- [ ] Bang, teh tarik satu ya, kurang gula.

- Would a real person say something else here? `________________________________`

### Step 2 — `wrong_order`  ·  levels 1/2/3  ·  Abang Mamak

**Abang Mamak says** — 🔊 spoken aloud by TTS

> Ni dia! Milo ais satu, sejuk-sejuk.

- [ ] Approved  ·  Correction: `________________________________`

**Task hint (Malay, level 2)** — 👁 shown on screen only

> Itu bukan pesanan anda. Beritahu dia dengan sopan, dan sebut semula apa yang anda pesan.

- [ ] Approved  ·  Correction: `________________________________`

**Retry hint** — 👁 shown on screen only

> Beritahu abang tu minuman ini bukan yang anda pesan, kemudian sebut semula pesanan anda.

- [ ] Approved  ·  Correction: `________________________________`

**Sample answers** — shown to the evaluator as examples of acceptable range:

- [ ] Maaf boss, saya pesan teh tarik kurang manis tadi.
- [ ] Eh bang, ini Milo. Saya minta teh tarik tadi.
- [ ] Bang, ini bukan pesanan saya. Saya nak teh tarik.
- [ ] Sorry boss, saya order teh tarik, bukan Milo.

- Would a real person say something else here? `________________________________`

### Step 3 — `upsell`  ·  levels 3  ·  Abang Mamak

**Abang Mamak says** — 🔊 spoken aloud by TTS

> Ha, dah betul. Nak tambah apa-apa tak? Roti canai baru masak ni, panas-panas.

- [ ] Approved  ·  Correction: `________________________________`

**Task hint (Malay, level 2)** — 👁 shown on screen only

> Anda tak nak apa-apa lagi. Tolak dengan sopan — jangan sekadar cakap tidak.

- [ ] Approved  ·  Correction: `________________________________`

**Retry hint** — 👁 shown on screen only

> Cuba tolak dengan lembut — ucap terima kasih atau bagi sebab ringkas.

- [ ] Approved  ·  Correction: `________________________________`

**Sample answers** — shown to the evaluator as examples of acceptable range:

- [ ] Tak apa bang, terima kasih. Minum je cukup.
- [ ] Lain kali lah bang, saya dah makan tadi.
- [ ] Tak payah bang, teh tarik je. Terima kasih ya.
- [ ] Cukup lah ni, terima kasih boss.

- Would a real person say something else here? `________________________________`

### Closing line  ·  Abang Mamak — 🔊 spoken aloud by TTS

> Aduh, salah meja tadi! Maaf ya boss. Datang lagi tau.

- [ ] Approved  ·  Correction: `________________________________`

---

## 2. Mall Rescue  ·  `mall_01`

**Scene:** You are in a shopping mall and you cannot find the food court. Ask someone.  
**Character:** Abang Guard (voice `ali-13002bfa`)

### Narrator intro — 🔊 spoken aloud by TTS

> Anda di dalam sebuah mall yang besar. Dah pusing dua kali, food court masih tak jumpa. Ada seorang abang guard berdiri dekat eskalator.

- [ ] Approved as-is  
- Correction: `________________________________________`

### Re-prompt line  ·  Abang Guard — 🔊 spoken aloud by TTS

_Played when the generated reply had to be discarded — the character simply asks again._

> Maaf encik, boleh ulang sekali lagi?

- [ ] Approved  ·  Correction: `________________________________`

### Step 1 — `ask`  ·  levels 1/2/3  ·  Abang Guard

**Abang Guard says** — 🔊 spoken aloud by TTS

> Ya? Boleh saya tolong?

- [ ] Approved  ·  Correction: `________________________________`

**Task hint (Malay, level 2)** — 👁 shown on screen only

> Tanya dia dengan sopan di mana food court.

- [ ] Approved  ·  Correction: `________________________________`

**Retry hint** — 👁 shown on screen only

> Tanya di mana food court itu — cuba mula dengan 'Maaf bang' atau 'Tumpang tanya'.

- [ ] Approved  ·  Correction: `________________________________`

**Sample answers** — shown to the evaluator as examples of acceptable range:

- [ ] Maaf bang, food court kat mana ya?
- [ ] Bang, macam mana nak pergi ke food court?
- [ ] Excuse me, saya nak cari food court. Kat tingkat berapa ya?
- [ ] Tumpang tanya bang, food court sebelah mana?

- Would a real person say something else here? `________________________________`

### Step 2 — `confirm`  ·  levels 1/2/3  ·  Abang Guard

**Abang Guard says** — 🔊 spoken aloud by TTS

> Oh, food court kat tingkat empat. Naik eskalator ni sampai atas, lepas tu belok kiri. Ada papan tanda besar, tak boleh miss punya.

- [ ] Approved  ·  Correction: `________________________________`

**Task hint (Malay, level 2)** — 👁 shown on screen only

> Ulang semula arah tadi untuk pastikan anda faham — tingkat, eskalator, belok mana.

- [ ] Approved  ·  Correction: `________________________________`

**Retry hint** — 👁 shown on screen only

> Sebut semula tiga perkara: tingkat berapa, naik apa, dan belok ke mana.

- [ ] Approved  ·  Correction: `________________________________`

**Sample answers** — shown to the evaluator as examples of acceptable range:

- [ ] Jadi naik eskalator sampai tingkat empat, lepas tu belok kiri?
- [ ] Okay, tingkat empat, naik eskalator, belok kiri ya?
- [ ] Naik atas tingkat empat, keluar eskalator belok kiri. Betul tak bang?
- [ ] Tingkat empat, belok kiri lepas eskalator. Terima kasih bang.

- Would a real person say something else here? `________________________________`

### Step 3 — `give_directions`  ·  levels 3  ·  Makcik

**Makcik says** — 🔊 spoken aloud by TTS

> Dik, dik. Sorry ya. Makcik nak tanya, food court kat mana ek? Makcik dah pusing-pusing tak jumpa.

- [ ] Approved  ·  Correction: `________________________________`

**Makcik's re-prompt line** — 🔊 spoken aloud by TTS

> Aduh, makcik tak berapa faham la dik. Cuba cakap sekali lagi?

- [ ] Approved  ·  Correction: `________________________________`

**Task hint (Malay, level 2)** — 👁 shown on screen only

> Sekarang orang pula tanya anda. Bagi arah yang anda baru dapat tadi.

- [ ] Approved  ·  Correction: `________________________________`

**Retry hint** — 👁 shown on screen only

> Bagi arah ikut turutan — naik apa dulu, ke tingkat berapa, lepas tu belok mana.

- [ ] Approved  ·  Correction: `________________________________`

**Sample answers** — shown to the evaluator as examples of acceptable range:

- [ ] Makcik naik eskalator ni sampai tingkat empat, lepas tu belok kiri. Ada papan tanda besar.
- [ ] Tingkat empat makcik. Naik eskalator sana, keluar je belok kiri.
- [ ] Senang je makcik — naik eskalator ni, tingkat empat, kemudian belok kiri terus nampak.
- [ ] Makcik pergi tingkat empat naik eskalator tu, lepas tu kiri.

- Would a real person say something else here? `________________________________`

### Closing line  ·  levels 1/2  ·  Abang Guard — 🔊 spoken aloud by TTS

> Sama-sama! Kalau sesat lagi, cari abang tau.

- [ ] Approved  ·  Correction: `________________________________`

### Closing line  ·  levels 3  ·  Makcik — 🔊 spoken aloud by TTS

> Terima kasih ya dik! Baik betul orang muda zaman sekarang.

- [ ] Approved  ·  Correction: `________________________________`

---

## 3. Office Panic  ·  `office_01`

**Scene:** Your manager stops by your desk. The report from yesterday is not finished.  
**Character:** Kak Ana (voice `nur-b184422b`)

### Narrator intro — 🔊 spoken aloud by TTS

> Pagi Isnin. Anda baru sampai pejabat, kopi pun belum habis. Kak Ana berhenti depan meja anda.

- [ ] Approved as-is  
- Correction: `________________________________________`

### Re-prompt line  ·  Kak Ana — 🔊 spoken aloud by TTS

_Played when the generated reply had to be discarded — the character simply asks again._

> Kejap. Kamu maksud macam mana ni?

- [ ] Approved  ·  Correction: `________________________________`

### Step 1 — `status`  ·  levels 1/2/3  ·  Kak Ana

**Kak Ana says** — 🔊 spoken aloud by TTS

> Wei, report semalam dah siap ke?

- [ ] Approved  ·  Correction: `________________________________`

**Task hint (Malay, level 2)** — 👁 shown on screen only

> Report belum siap. Beritahu dengan jujur, terangkan sampai mana, dan bagitahu bila anda akan hantar.

- [ ] Approved  ·  Correction: `________________________________`

**Retry hint** — 👁 shown on screen only

> Cakap tiga perkara: belum siap, sampai mana anda dah buat, dan bila anda akan hantar.

- [ ] Approved  ·  Correction: `________________________________`

**Sample answers** — shown to the evaluator as examples of acceptable range:

- [ ] Belum siap lagi. Saya tengah buat sekarang, petang ni saya hantar.
- [ ] Maaf kak, belum habis. Tinggal sikit je, nanti petang saya email.
- [ ] Belum lagi kak. Saya dah buat separuh, hari ni juga saya siapkan.
- [ ] Sorry kak, tak sempat semalam. Saya sambung pagi ni, petang ni siap.

- Would a real person say something else here? `________________________________`

### Step 2 — `pin_down`  ·  levels 1/2/3  ·  Kak Ana

**Kak Ana says** — 🔊 spoken aloud by TTS

> Petang ni tu pukul berapa? Saya ada meeting pukul empat, kena bawa report tu.

- [ ] Approved  ·  Correction: `________________________________`

**Task hint (Malay, level 2)** — 👁 shown on screen only

> Dia perlukan masa yang tepat. Bagi satu masa — dan pastikan ia sempat sebelum meeting pukul empat dia.

- [ ] Approved  ·  Correction: `________________________________`

**Retry hint** — 👁 shown on screen only

> Bagi satu masa yang tepat, dan pastikan ia sebelum pukul empat.

- [ ] Approved  ·  Correction: `________________________________`

**Sample answers** — shown to the evaluator as examples of acceptable range:

- [ ] Boleh, sebelum pukul tiga saya hantar.
- [ ] Pukul dua setengah kak, sempat lah untuk meeting.
- [ ] Saya hantar sebelum pukul tiga, jadi kak ada masa nak baca dulu.
- [ ] Confirm sebelum pukul tiga kak, saya email terus.

- Would a real person say something else here? `________________________________`

### Step 3 — `cover_me`  ·  levels 3  ·  Kak Ana

**Kak Ana says** — 🔊 spoken aloud by TTS

> Okay. Eh, satu lagi — client call pukul sebelas ni saya tak boleh masuk. Boleh tolong ambil alih tak?

- [ ] Approved  ·  Correction: `________________________________`

**Task hint (Malay, level 2)** — 👁 shown on screen only

> Pagi anda dah padat. Sama ada terima dan beritahu apa yang anda tangguh, atau tolak dan tawarkan cara lain untuk membantu.

- [ ] Approved  ·  Correction: `________________________________`

**Retry hint** — 👁 shown on screen only

> Bagi jawapan yang jelas — terima atau tolak — dan cakap kesannya pada report tadi.

- [ ] Approved  ·  Correction: `________________________________`

**Sample answers** — shown to the evaluator as examples of acceptable range:

- [ ] Boleh kak, tapi kalau macam tu report tu saya hantar pukul empat lah ya.
- [ ] Aduh kak, kalau saya masuk call tu report lambat sikit. Boleh minta Aiman ganti?
- [ ] Boleh je, tapi saya kena tangguh report sampai lepas lunch.
- [ ] Saya rasa tak sempat kak. Macam mana kalau saya hantar nota untuk kak guna dalam call?

- Would a real person say something else here? `________________________________`

### Closing line  ·  Kak Ana — 🔊 spoken aloud by TTS

> Okay, saya pegang janji ni tau. Jangan esok pula.

- [ ] Approved  ·  Correction: `________________________________`

---

## Shared fallback line  ·  not tied to one character

**Last-resort re-prompt** (`DEFAULT_REPROMPT`, `server/adapters/evaluator.js`) — 🔊 spoken aloud by TTS

> Hah? Macam mana tu? Cuba cakap sekali lagi.

- [ ] Approved  ·  Correction: `________________________________`

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

