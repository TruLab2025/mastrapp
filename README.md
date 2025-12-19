# Audio Metrics (lokalnie)

Mała web-apka do analizy bounce’ów z DAW (stereo) lokalnie w przeglądarce: przeciągasz plik → dostajesz JSON.

W UI możesz wrzucić 1 lub 2 pliki:
- **A (analizowany)** — obowiązkowy
- **REF (referencja)** — opcjonalny

Wynik ma dwa „poziomy”:
- **Kopiuj JSON**: krótki `summary` do GPT (dla 1 pliku albo dla porównania A vs REF).
- Pobrania FULL:
	- **Pobierz FULL A**
	- **Pobierz FULL REF**
	- **Pobierz FULL PORÓWNANIE** (zawiera pełne A, pełne REF i sekcję `compare`)

## Co liczy

- Energia w pasmach częstotliwości (kilka pasm + low/mid/high)
- Spectral: centroid, rolloff, flatness
- Spectral: flux + HFC (High Frequency Content)
- RMS w czasie (okno 400 ms, krok 100 ms)
- LUFS w czasie (momentary 400 ms, short-term 3 s) + integrated (z bramkowaniem)
- Transienty / onsets (peak-picking na krzywej „band-flux”)

Uwaga: LUFS jest „przybliżone” (K-weighting przez biquady RBJ) — do porównań między eksportami jest OK, ale nie jest to bit-exact EBU R128.

## Uruchomienie (zalecane: Vite + npm)

Wymagany Node 18+.

```bash
npm install
npm run dev
```

Otwórz: http://localhost:5174

## Uruchomienie (legacy: bez bundlera)

1) Wejdź do katalogu projektu.
2) Uruchom prosty serwer statyczny.

### Opcja A: Python

```bash
python3 -m http.server 5173
```

Otwórz: http://localhost:5173

### Opcja B: Node

```bash
npx serve .
```

## Testy

```bash
npm test
```

## Essentia.js

Domyślnie Essentia jest ładowana z npm (`essentia.js`) przez Vite.

Jeśli z jakiegoś powodu chcesz tryb no-bundler (offline/portable), nadal możesz wgrać pliki do `vendor/essentia/` i loader spróbuje je wykryć.

## Notatki praktyczne

- Najbardziej stabilne wyniki: WAV/AIFF (bez strat).
- Długie pliki mogą chwilę liczyć (FFT + loudness to O(n)).
- Jeśli chcesz wersję „pro” z Web Workerem (żeby UI nie przycinało), mogę dopisać.
