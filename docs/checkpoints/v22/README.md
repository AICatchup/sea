# V22 中間比較と保存時の検証

20枚の画像とカメラ・時刻の記録は `731d0b7` の同条件比較です。`control` は通常、`ground` は地表候補、`cliff` は岩壁候補、`combined` は両候補。1280×720、時刻34、各視点の実際のカメラ高さを固定しました。別インスタンスの水・魚の履歴が異なるため、静止した地表・岩壁だけの比較です。

画像は修正後 `8f988af` の現在の見た目を証明しません。[一回の独立レビュー](R155-review.md)は地表をNEEDSFIX、岩壁をREJECTとしました。後続の修正は距離依存の色の切替と角接触のエッジ接続を修正しましたが、修正後の画像レビューは未実施です。両候補は通常無効のまま。

[capture-manifest.json](capture-manifest.json)に画像／記録のハッシュ、[R155-evidence.json](R155-evidence.json)に当時のレビュー範囲、[checkpoint-validation.json](checkpoint-validation.json)に保存時の検証結果を記録しています。パスはクラウドで読める相対パスへ置換し、ローカル個人環境への依存を除いています。

[全体ゴールと再開手順](../../CLOUD_HANDOFF.md)を維持してください。写真同等・全経路・Human受入は未達です。
