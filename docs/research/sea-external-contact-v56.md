# V56 — 外部の植生・移動床実装を読み、船の道具を修正する

2026-10-09。海を基準に保ち、崖・植生、身体と船の接点を優先する。全体の実写品質と最終動画は未達。

## 取得したコードと採る部分

**Ecctrl** を実際にcloneし、`e2cab804f9f15661a642e76f52d09f0b2db63f35` のMIT条件と [移動床の処理](https://github.com/pmndrs/ecctrl/blob/e2cab804f9f15661a642e76f52d09f0b2db63f35/src/character/Ecctrl.tsx#L753) を読んだ。接地している人にだけ、床の並進速度と角速度から接点付近の速度を渡し、離れたら追従を解除する。SEAの甲板上自由歩行へ対応させる設計の参考であり、React/Rapier依存のcontrollerを移植済みとはしない。今回の船の収納竿修正は既存Three.jsの剛体座標変換を統一した独自変更で、Ecctrlコードの転載ではない。

**EZ-Tree** を実際にcloneし、`dcf309bd86bd521083d9c70f01f2de45fdc7c457` のMIT条件、[共通骨格とLODの生成](https://github.com/dgreenheck/ez-tree/blob/dcf309bd86bd521083d9c70f01f2de45fdc7c457/src/lib/tree.js#L246)、[枝の成長方向](https://github.com/dgreenheck/ez-tree/blob/dcf309bd86bd521083d9c70f01f2de45fdc7c457/src/lib/tree.js#L370) を読んだ。乱数で枝と葉の位置を一度生成し、同じ骨格から解像度だけ異なる面を作る。seedを変えると個体形状が変わり、LOD切替で新しい乱数形状へ飛び移らない。

取得コードの処理は実行もした。[再実行CLI](../../scripts/study-external-tree.mjs)で元ライブラリを束ね、Pine Medium・Bush 1を各3seed、各3距離の形状として生成した。18生成すべてで骨格のhashが保持され、座標は有限、indexは頂点範囲内だった。[結果と読んだファイルのSHA256](../checks/v56/tree-study.json)。写真素材、UI、GPU描画はこの実行に含めていない。元コードの葉は交差する薄い面であり、これだけで近距離の葉の厚みや写真品質を満たすとは扱わない。

pineの三角形数は19,872→8,248→3,460、shrubは13,872→5,484→2,742。今回は葉の拡大係数を1に固定して減らしたため、遠い樹冠の被覆が保たれる証拠ではない。元のpine presetを式根島の海風で変形したクロマツと同定する根拠もない。通常の植生へは未採用。次は現地の枝・樹冠・空白を対応づけた複数個体と、各LODの実投影被覆を比較する。

```text
git clone https://github.com/dgreenheck/ez-tree.git work/ez-tree
git -C work/ez-tree checkout dcf309bd86bd521083d9c70f01f2de45fdc7c457
node scripts/study-external-tree.mjs work/ez-tree work/new-tree-study
```

出力先が既存なら停止し、既存成果は上書きしない。cloneと生成bundleは研究用のローカル成果。公開SEAへ第三者の写真やライブラリbundleを同梱していない。

## 船と道具の一つの不整合を解消

収納竿の取付位置は船のpitch/yaw/rollで動いていたが、竿の向きはyawだけだった。船の揺れで取付位置と軸が別に動く。船の完全なYXZ回転に、船ローカルの竿の固定姿勢を掛け、位置と軸を同じ船へ固定した。

旧処理で「船ローカルの竿軸が不変」という試験が失敗し、修正後は成功。持ち竿・岸の竿・釣りの進行や収納の条件は保持した。独立コードレビューで回転順と既存姿勢を確認し、通常の乗船後に振り返って[実表示](../checks/v56/stored-rod.png)も保存した。手と舵・はしごの完全な接触は別の未完了項目である。

外部実装2件の取得・読解と、6個体の生成、1件の接触修正を確認した。取得数や三角形数を品質達成指標にはしない。[通常の旅の実行範囲](../verification-v56.md)と全体ゴールを区別する。
