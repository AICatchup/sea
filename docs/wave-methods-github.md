# 砕波の実装に使う外部資料

2026-10-23確認。READMEの「リアル」「物理的」といった説明だけでは採用せず、対象処理とSEAへの適用範囲を区別する。今回、外部ソースのコピーや依存追加はしていない。

| 一次資料 | 確認した方法 | SEAとの対応・限界 |
| --- | --- | --- |
| [Crest / UpdateFoam.compute](https://github.com/wave-harmonic/crest/blob/master/crest/Assets/Crest/Crest/Shaders/Resources/UpdateFoam.compute) | 前フレームの泡を速度で移流し、時間で減衰。圧縮と水深から発生源を作る | MarineSurfaceFieldの永続場を使用。今回、先端だけでなく後続の水の着水量も発生源に渡す。Crestを入れれば巻き込みまで解決するという意味ではない |
| [FLIP Fluids / diffuseparticlesimulation.cpp](https://github.com/rlguy/Blender-FLIP-Fluids/blob/master/src/engine/diffuseparticlesimulation.cpp) | 波頭の発生判定に曲率・速度と表面法線を使い、泡を速度場で運び、種類別に寿命を減らす | 「白い模様」ではなく発生・輸送・消失を別々に検証する。ゲームの低解像度場とFLIPの圧力計算は同等ではない |
| [SPlisHSPlasH](https://github.com/InteractiveComputerGraphics/SPlisHSPlasH) | 粒子流体、複数の圧力ソルバー、境界モデル、二次粒子 | Colabの粗いWCSPHについて圧力・境界・解像度を検証する比較対象。ブラウザへ重い流体計算を無条件に移植しない |
| [splashsurf](https://github.com/InteractiveComputerGraphics/splashsurf) / [Python API](https://github.com/InteractiveComputerGraphics/splashsurf/blob/main/pysplashsurf/pysplashsurf/docs/source/api.rst) | 粒子から等値面を再構成し、SPH法線と重み付き平滑化を使う | Colab粒子を水の体積として可視化する候補。粒子の点描を、そのまま実写の波の証拠にしない。未統合 |
| [NVIDIA Warp](https://github.com/NVIDIA/warp) / [SPH例](https://github.com/NVIDIA/warp/blob/v1.9.1/warp/examples/core/example_sph.py) | CUDAカーネルと近傍探索による粒子計算 | 既存Colab実験の実行基盤。ライブラリの利用自体は物理妥当性の検証ではない |
| [GodotOceanWaves](https://github.com/2Retr0/GodotOceanWaves) | 方向性スペクトルと逆FFTによる外洋の生成 | 外洋の波形・周波数表現の参考。巻き込み、着水、気泡の代わりにはならない |
| [Thüreyほか (2007)](https://matthias-research.github.io/pages/publications/breakingWaves.pdf) | 高さ場の砕波線から水のシートを出し、落下後に水面へ吸収、飛沫・泡へ受け渡す | ConnectedBreakerPoolの方式。今回、別のピークへの再接続を防ぎ、後続の水も着水時に泡場へ渡す。圧力を解く3D流体とは区別する |

## 今回の実装判断

- 波頭を毎フレーム広い範囲で探し直すと、別の波に飛び、隣接する時間の水が何メートルも離れる。波面と放出元の波頭を別々に追跡し、各線は共通の位相増分で移動させる。
- 初期の波頭検出でも、伝播方向に2.5m以上飛ぶ隣接列を同じシートに結ばない。
- 水を出した時刻と速度は履歴に固定する。後から波頭が動いても、既に飛んでいる水を引っ張らない。
- 最初の先端の着水で後続の水を消さない。後続の列の着水体積から泡・気泡・水面への入力を作る。着水した列は再出現させない。
- 泡は既存の世界座標の移流場で運び、泡と気泡で異なる寿命を持たせる。

これは運動学的な近似。水量の完全保存、空気の圧力、表面張力、砕波による外洋スペクトルのエネルギー損失を全て解いたものではない。大きい巻き込みと水面接合の品質は、複数角度の実画面で別途判定する。

## ライセンス

Crest、GodotOceanWaves、SPlisHSPlasH、splashsurfは各リポジトリのMIT表記を確認。WarpはApache-2.0。参照したFLIP FluidsのengineソースのヘッダーはMIT表記だが、アドオンや配布物全体へ一般化しない。今後コード・アセットを取り込む際は、そのファイルのライセンスと著作権表示を保持する。
