# 海・波・海岸の外部GitHub手法調査

この文書は実装前の調査記録です。採用した方法と検証範囲は [V74の実装](../graphics-v74.md) に記載しています。

調査日: 2026-10-14

目的: SEAの海・波打ち際・船の航跡・海岸地形を、既存の外部実装から学び、現在の「波が崩れて泡へ移る動きが弱い」という問題と、その周辺の改善順を整理する。

ここではリポジトリのREADMEだけにある「photoreal」「production-quality」などの形容を品質の証拠として扱わない。実装範囲、ライセンス、コードの成熟度、公開テスト・計測が分かる範囲を併記する。以下は手法の調査であり、外部コード・画像・モデルをSEAへコピーしたり、GitHubへ反映したりしていない。

## 優先して読む先

| 優先 | リポジトリ・資料 | 参考にできる手法 | SEAでの使い道と限界 |
|---|---|---|---|
| 最優先 | [Thürey et al., Real-time Breaking Waves for Shallow Water Simulations](https://matthias-research.github.io/pages/publications/breakingWaves.pdf) | 高さ場で急な波面を検出し、連結した粒子シートを生成・移流し、水面への衝突でシートを吸収して飛沫・泡を発生させる。 | 「波頭が前に倒れる→着水する→泡と飛沫になる」という不足部分に最も直接的。論文自身も完全な乱流再現ではなく視覚特徴の近似だと限定している。水面から離れた白い板を置くだけではなく、波面・速度と連続させることが重要。 |
| 最優先・実装比較 | [siliconjungle/inkwell-webgpu-water](https://github.com/siliconjungle/inkwell-webgpu-water) と [設計・失敗記録](https://github.com/siliconjungle/inkwell-webgpu-water/blob/main/docs/research.md) | 遠洋の3つの周波数帯と、浅瀬の水位・運動量・泡を持つ有限体積状態を組み合わせる。砕波イベントを圧縮と浅水条件から作り、イベントを保持しながら泡を流速で逆追跡する。 | 沿岸波と泡を一つの時空間状態に結ぶ設計が近い。作者は独立した波頭シートが「離れた泡の棒」に見えたため外したと記録しており、避けるべき失敗例も有用。リポジトリは新しく1コミットで、公開された性能値は作者のApple/Metal環境での自己計測。SEAで再計測する必要がある。ベンチマークJSONは[ここ](https://github.com/siliconjungle/inkwell-webgpu-water/blob/main/benchmarks/webgpu-water-latest.json)。MIT。 |
| 最優先・設計の参考 | [wave-harmonic/crest](https://github.com/wave-harmonic/crest)、[泡の設計](https://docs.crest.waveharmonic.com/Manual/Appearance/Foam.html)、[浅水シミュレーション](https://docs.crest.waveharmonic.com/Packages/ShallowWater/Manual.html) | 泡を砕波頂部・浅い海岸・船の航跡など複数の発生源から作り、更新ごとに減衰させる。浅水側は水位・泡・流れを注入する。海岸の形状が狙う波を作るよう調整すること、時間安定性と岸際のジッターにも注意している。 | 大規模で成熟したUnity実装（MIT、GitHub表示3.9k stars / 5,356 commits）。泡の寿命・上限・岸際を独立調整する発想が使える。一方、公式READMEはWebGLをサポートしないと明記しており、Unityプラグインをそのままブラウザ版へ入れる候補ではない。 |
| 船の航跡 | [markaren/threepp](https://github.com/markaren/threepp)、[2026-10-11 release の海・航跡設計](https://github.com/markaren/threepp/releases) | 世界座標に固定した航跡場の各セルに泡・水中気泡・乱れ・短波の減衰・水流を保持し、船を動くカプセル源として記録する。船体・推進器の影響を同じ場へ加える。 | ボート航跡が固定V字模様に見える問題を避けるデータ設計に有用。MITのC++20ライブラリだが、同プロジェクトの高度なOceanはVulkan用で、SEAのThree.js/WebGLにそのまま移せる実装ではない。記事中の性能値も記載GPUでの作者計測。 |
| 地形・物理検証 | [wrenteria/CelerisAi](https://github.com/wrenteria/CelerisAi)、[Celerisの元実装](https://github.com/SasanTV/Celeris)、[Celeris論文](https://arxiv.org/abs/1611.05984) | CelerisAiはPython-Taichiで浅海波を解く研究用ソルバー。CelerisはGPU Boussinesq方程式で波の伝播・砕波を扱い、論文では標準波ケースとの検証を報告する。 | 画面品質を上げるためにコードを直接移すより、深さに対する波高・遡上・砕波位置の比較基準として使う。CelerisAiはMITだが小規模な研究コード。旧CelerisはGPL-3.0で、Visual Studio 2008/DirectX SDK前提の古い実装なので、コード移植候補からは外し、数値手法と検証ケースだけを参照する。 |
| Three.jsの光学比較 | [achrefelouafi/WaterThreeJS](https://github.com/achrefelouafi/WaterThreeJS)、[実装説明](https://github.com/achrefelouafi/WaterThreeJS#foam) | 波の圧縮、白波、深さによる岸泡、船・浮遊物との接触泡を一つのエネルギー場に合成し、風向きに伸びたノイズでほどいて減衰させる。フレネル反射、GGXの太陽反射、Beer–Lambert吸収も説明している。 | Three.js/WebGL2で読みやすい小規模実装（MIT、11コミット）。泡の統合と光学シェーダの比較に使う。READMEの品質表現は検証済み品質の証明ではない。 |
| Three.jsの波面比較 | [achrefelouafi/OceanThreejs](https://github.com/achrefelouafi/OceanThreejs) | FFT波とGerstnerうねりの合成、複数スペクトル、ヤコビアン由来の泡、GGX・HDR反射・屈折を分けた小さなWebGL2実装。 | MITで2コミット。対象が海面レンダラー単体で、地形・砕波の巻き込み・ゲーム動作は含まない。パラメータやシェーダの比較材料に限定する。 |
| WebGPU比較 | [baditaflorin/threejs-water-free](https://github.com/baditaflorin/threejs-water-free) | JONSWAP/FFT、多段波、ヤコビアン泡、浅瀬吸収・屈折・浮力をThree.js TSLでまとめる。 | MIT。README上はWebGPU/TSL中心で、WebGL2フォールバックも記載。5コミットの小規模実験なので、描画結果と対象ブラウザを実際に確認する。 |
| 波乗りゲームの結合 | [kylefriesmarketing/shorebreak](https://github.com/kylefriesmarketing/shorebreak) | 傾斜海底上の浅水流体場をサーフボードの浮力・揚力・抵抗・トルクへつなぎ、飛沫・泡に同じ流れの速度を渡す。 | 活動・物理・水面描画を別々の疑似演出にしない設計を読む。小規模な実験で、GitHub上でライセンス表示を確認できないためコード・アセットをコピーせず、設計観察だけにとどめる。 |

## 岩・崖・実景形状の参考

- [COLMAP](https://github.com/colmap/colmap) は写真群からカメラ位置と疎な形状を復元し、Multi-View Stereoで密な点群・メッシュ・撮影写真由来のテクスチャへ進む。複数位置から重なりのある写真を撮り、物体が最低3枚以上に写るよう推奨している。メッシュを簡略化して形状を保つ工程もある。BSD系ライセンス。崖の固定形状や岩塊には向くが、反射・移動する海面は復元を壊すので対象から分ける。
- [OpenDroneMap/ODM](https://github.com/OpenDroneMap/ODM) は航空写真から点群、テクスチャ付き3Dモデル、オルソ画像、標高モデルを生成するパイプライン。航空写真など利用権のある入力が揃う場合に、島の全景と地形を統一する参照先になる。
- [CesiumGS/3d-tiles](https://github.com/CesiumGS/3d-tiles) の3D Tiles標準は、写真測量・点群・地形など大量の地理データを階層LODで配信する。SEAで採る価値があるのはこの「遠景は軽く、接近時だけ細部を読む」発想。現在のゲームへCesium全体を組み込むことを意味しない。

写真測量は、写真の解像度・距離・角度・縮尺基準に制約される。これだけで「1 cm精度」を保証するものではない。実景写真から復元した高密度形状は、近景用メッシュとゲーム用簡略メッシュを分けて使う。

## SEAへつなぐ実装案

1. **まず砕波イベントを連続した波頭として追う。** 岸に沿った一つの砕波イベントにID・進行方向・波頭の連続位置を持たせ、左右同時に崩れる人工的な弧ではなく、海底の深さと局所波形に応じて崩れ始める場所・時刻をずらす。
2. **波頭の巻き込みと水面衝突を分けて作る。** 波面の移動する水を持ち上げ、面に沿う厚みのあるリップをつくり、衝突後は水面へ連続して戻す。単独の白い帯を水面から離して置かない。十分な表面反転を作れない箇所だけ、Thürey式の連結シート/粒子を短時間の補助に使う。
3. **衝突時の運動量を泡・飛沫へ引き継ぐ。** 衝突位置・速度・衝突量を同じイベントから発生させ、泡は浅水流の移流と引き波で流し、時間をかけて細かく崩して消す。飛沫は重力と風で弧を描いて落ち、着水で泡へ戻す。
4. **一つの沿岸状態を水面・泡・移動へ共有する。** 海底深度、自由水面、水平流速、泡の残量を同じ座標に保持する。遠洋の波スペクトルは外側境界の入力とし、岸際の遡上・戻り波だけ近岸ソルバーへ渡す。陸・水・泡が別々のサンプル格子を使う継ぎ目を減らす。
5. **外洋・海岸・ボートの痕跡も同じ流れへ接続する。** 船体の押し分け・推進器の流れ・船尾波は水面位置だけでなく、近傍流速・泡・細波減衰を更新する。サーフボードや泳ぐ人物にも同じ水面サンプルを共有する。
6. **同じ時間・同じカメラで失敗を潰す。** 岸から正面、岸沿いの横向き、海中から上向き、浜に近い俯瞰で、砕波前・リップ・衝突直後・残る泡を固定時間キャプチャする。白い帯の分断、別水面化、周期リセットのポップ、乾いた場所の泡発生を負のケースとして確認する。性能はスクリーンショットではなく、実ブラウザのGPU/フレーム時間で計る。
7. **岩肌は実景形状・表面材質・LODを分ける。** 許諾の取れた複数視点写真から固定岩面を再構成し、実測標高と合わせ、近景には細かな面形状、遠景には簡略化した形状とシルエットを使う。色の貼り付けだけで凹凸の代わりにしない。

## 調査から分かった重要な線引き

- FFT/Gerstnerとヤコビアン泡は、海全域のうねり・白波・反射には有力だが、それだけで水が前へ巻き落ちる厚い砕波や着水後の白水塊まで表現できるわけではない。
- 離れた波頭メッシュを足すだけだと、波から切り離された白い板・泡の棒に見える。地形・水面・波頭・飛沫・残留泡を同じイベントと座標で接続する必要がある。
- 完全な流体計算をリアルタイムで海全域に回す必要はない。遠洋は統計スペクトル、岸際だけ近岸計算、巻き込み部分だけ短命な局所形状/粒子、泡は低解像度の履歴場、というハイブリッドが現実的。
- GitHubの人気、READMEの「photoreal」、作者のベンチマークだけを受入証拠にしない。SEAでは同一シーン・同一カメラ・同一時間の画像差分と実ブラウザ計測で採否を決める。

## 主な参照URL

- [Breaking Waves paper (ETH Zurich)](https://matthias-research.github.io/pages/publications/breakingWaves.pdf)
- [inkwell-webgpu-water](https://github.com/siliconjungle/inkwell-webgpu-water)
- [Crest GitHub](https://github.com/wave-harmonic/crest) / [foam docs](https://docs.crest.waveharmonic.com/Manual/Appearance/Foam.html) / [shallow-water docs](https://docs.crest.waveharmonic.com/Packages/ShallowWater/Manual.html)
- [threepp GitHub](https://github.com/markaren/threepp) / [marine wake release](https://github.com/markaren/threepp/releases)
- [CelerisAi](https://github.com/wrenteria/CelerisAi) / [Celeris](https://github.com/SasanTV/Celeris) / [Celeris paper](https://arxiv.org/abs/1611.05984)
- [WaterThreeJS](https://github.com/achrefelouafi/WaterThreeJS) / [OceanThreejs](https://github.com/achrefelouafi/OceanThreejs) / [threejs-water-free](https://github.com/baditaflorin/threejs-water-free)
- [shorebreak](https://github.com/kylefriesmarketing/shorebreak)
- [COLMAP](https://github.com/colmap/colmap) / [OpenDroneMap](https://github.com/OpenDroneMap/ODM) / [3D Tiles](https://github.com/CesiumGS/3d-tiles)
