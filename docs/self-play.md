# Self-play training

## Cykl uczenia

1. **Start:** Załaduj model z dysku (lub losowe wagi jeśli brak)
2. **Gra:** AI vs AI — pełna rozgrywka
3. **Zbieranie danych:** Każdy ruch → zapisz do replay buffer
4. **Wynik:** Określ zwycięzcę (+1 / -1 / 0)
5. **Szkolenie:** Naucz sieć na danych z bufora
6. **Update:** Aktualizuj wagi modelu
7. **Zapisz:** Auto-zapis modelu na dysk
8. **Powtórz:** Kolejna gra od kroku 2

## Wybór ruchu (podczas gry)

- Losowo z rozkładu prawdopodobieństw (policy head)
- Temperatura: na początku wysoka (eksploracja), potem niska (exploit)
- Przez pierwsze 10 ruchów: temperatura = 1.0 (pełna losowość)
- Po 10 ruchach: temperatura = 0.5 (preferuj najlepsze)
- Ostatnie 5 ruchów: temperatura = 0.1 (prawie deterministyczne)

## Replay buffer

- FIFO, max 10k wpisów
- Wpis = {stan, ruch, wynik_gry}
- Przy przepełnieniu: najstarszy wpis wypada
- Auto-zapis na dysk co 10 minut (binarny)

## Szkolenie na danych

- Losowy mini-batch z bufora (256 próbek)
- 5 epok na batch
- Aktualizacja wag po każdej grze
- Loss: policy cross-entropy + value MSE

## Czas

- Jedna gra: ~1-5 sekund (zależy od głębokości)
- Szkolenie: ~0.5-2 sekund na batch
- Cykl: gra + szkolenie = ~2-7 sekund
- 100 gier: ~3-12 minut
