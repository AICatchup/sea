# SEA V65 — Claudeの追加実装を統合した区切り

2026-10-10。「他にも入れているものを全面採用し、クロージングする」というユーザーの依頼に合わせ、Claude `claude/v65-all` のHEAD `2c2bd23` までを全面統合した。V64の反射・サーフィン修正は保持し、最終app commitは `f1f93892e354a8487388d1f894602ab11910475c`。実写同等・全旅程・完成紹介動画は未達のまま保存し、今回の開発はクローズする。残件による自動再開はしない。

## 採用内容

| 機能 | 使用方法と扱い |
|---|---|
| 実測地形・岩のLOD、遠い樹冠のoctahedral impostor | 通常ON。現地形のsupport queryや近景素材を維持し、遠景の描画負荷を減らす。比較用 `terrainlod=0` / `scanlod=0` / `impostor=0` を保持。 |
| 三人称とカメラ衝突 | Vで一人称/三人称。船・崖・地形・水面との視線を判定する。一人称を標準とする。 |
| 自然な立ち姿 | 三人称で適用し、一人称・釣り・サーフィンの接点を保つ。 |
| 写真調の色調 | `grade=photo` でAgX・控えめなbloom・lens fall-off。通常OFFの比較用の表現として採用。 |
| MakeHuman人体 | `body=makehuman`。CC0人体・肌・眼・眉・まつげを既存47骨と装備に接続。読み込み失敗時は従来の体で続行。 |
| CMUモーション | `motion=cmu`。歩行・走行・泳ぎ・潜水を既存位相で再生。釣り・操舵・登り・サーフィンのblend中は手続き生成の接点を保つ。走行の歩数も調整。 |

新しい人体とモーションは `sea.html?body=makehuman&motion=cmu`。`&camera=third` で三人称から開始できる。コードの採用と既定ONを区別する。Claudeが取り下げた浜方向の推定は統合ブランチにも含まれない。元のClaude作業ツリーと旧候補を保持する。[Claudeの根拠と制約](claude-review/v65.md)。

## 統合時に解消した不具合

本番ビルドの実画面で、MakeHumanの素材URLが解決されず従来の体へ戻ることを検出し、Viteが解析できる固定URLへ修正した。単体HTMLには人体metaとCMUのJSONも埋め込み、素材通知を同梱した。ロード部分失敗とrenderer破棄、atlasベイク失敗では未移管資源を回収する。

独立した規約・要求レビューの5指摘を解消した。水面による高さ補正をした視線で固体を判定し、浅い水中は実現可能な上下余白を使う。着衣の連続フィールドと湿潤材質を屈折receiverへ伝える。道具のIK後にmocapで親骨や床の高さを変えない。[レビューと実行モデル](checks/v65/independent-review.md)。

## 確認した範囲

- 最終コードで全554件成功、失敗・skipなし。[全体ログ](checks/v65/all-tests.log)。実測地形・階段・航路・衝突、姿勢と道具、LOD、CPU/GPU receiverなどの数値試験を含む。
- 修正の31件とモーション接点の5件も成功。[統合回帰](checks/v65/integration-fixes.log)、[道具とモーション](checks/v65/mocap-contacts.log)。
- 型検査・本番ビルド・単体HTML生成に成功。[ビルド](checks/v65/build.log)。Viteの大きなchunkと実効性のないdynamic importの警告は保持し、FPS改善率へ換算しない。
- 保存版365,872,989 bytes、64素材同梱。外部script/stylesheet、残存asset名なし。人体meta・CMU JSONと通知の同梱を検査した。[検査とSHA256](checks/v65/artifact.json)。静的HTTPの200を確認。
- 内蔵ブラウザの通常本番ビルドで、修正後の人体表示、Vの一人称/三人称、M地図、O操作設定、再生と浜から浅い水際へのW移動を確認。[実画像](checks/v65/third-person-makehuman.png)。現在版の潜水・乗船・航海をこの入力確認だけで通過扱いしない。
- 約366MBの単体HTMLはブラウザタブ作成と題名まで確認したが、画面への接続は待ち時間切れ・中断で最終未確認。通常ビルドの結果を単体HTMLの実画面成功に読み替えない。Claudeの距離遷移画像・計測は [元記録](checks/claude-v65/lod-transition-sweep.json) に保持する。今回FPS・メモリ量や全距離の視覚受入を実測したとはしない。

## 保存と再開

GitHub main、`outputs/SEA.html`、`outputs/sea-source.zip`、`outputs/sea-release.json` と不変のV65リリースフォルダを更新する。旧V64フォルダ・Claude作業ブランチ・候補パッチは保持する。保存manifestが最終commitとhashの正本になる。

実写品質、崖の面接続と遠景、すべての島の往復・回収/納品・活動・保存復帰、自然音の聴感、完成後の紹介動画は未達。再開指示があれば本記録とmanifest、現在のGit/dirty・起動先を確認し、[残件表](experience-checklist.md)から必要な差分を進める。
