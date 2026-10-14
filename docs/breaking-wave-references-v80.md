# 砕波の外部実装確認 — 2026-10-14

## Storm Breakers

https://github.com/Stormrider31/Storm-Breakers

公開表示はCC0-1.0。`3-Scripts/Ocean.cs` の OceanDeformation を読んだ。波群、水平・鉛直変位を同じ位相から作り、水深で鉛直振幅を制限し、砕波の速度も算出する。Unity 2021+/URP/VFX Graph用で、SEAへのそのままの移植ではない。今回コードの直接コピーはしていない。

## Crest

https://github.com/wave-harmonic/crest/blob/master/LINKS.md
https://github.com/wave-harmonic/crest/blob/master/docs/user/shallows-and-shorelines.rst

水深を浅瀬の波と泡へ共通に使用する設計を参照。Crestだけで巻き込む自由表面をそのまま得られる、とは判断しない。

## Real-time Breaking Waves for Shallow Water Simulations

https://matthias-research.github.io/pages/publications/breakingWaves.pdf

波面線を現在の高さ・勾配へ投影して追跡し、波頭から放出した粒子を初速と重力で進める。高さ場との重なり、閉じた表面、接触検出が重要。論文自身も厳密な体積輸送の限界を記している。

## 今回の実装差分

- 現在の海面を予測点の前後1mで探索する波頭根元の補正。
- 波頭から放出した水の出生位置を履歴として保持し、初速と重力で進める時間方向33列のシート。後から根元が動いても放出済みの水を引っ張らない。
- 支えの波が下がった場合、空中の水を同じ位置・速度の飛沫へ一度だけ渡す。水面下の点は放出しない。
- 白水の薄い不透明な切り抜きを、厚みを保って密度を減らす透過表現へ変更。
- 固定時間の検証ではGPUの海面読戻し完了を待つ。単なる待ち時間0のyieldでは短い収録間隔で古い高さを参照するため、短い区間の末尾でも待つ。

これは参照論文の完全実装でも流体体積保存モデルでもない。Storm Breakersのコードを直接移植したものでもない。

## 受入状態

**未完了・通常表示には未昇格。** `?breakinglips=1` の候補を修正した。海面・波高を下げて隠す方針ではない。

8秒・81画像を実描画し、全画像で要求時刻と実計算時刻の一致、GPU読戻しの完了を検証。静止画の比較では以前の青い帯と白い板の一部を改善したが、実写のような大きい巻き込みと、波本体への完全な接続はまだ受入できない。固定刻みの映像は実時間FPSの証拠ではない。

検証: 関連122テスト、TypeScript確認。映像はローカル `outputs/breaking-waves-v80-candidate/`。不採用の初期候補は代表画像と時刻記録を残し、一時フレームを整理した。

次の受入作業: 波本体と自由表面の接続を統一し、正面・斜めの連続映像で大波が崩れる形を確認する。見た目の受入前に写実性を宣言しない。
