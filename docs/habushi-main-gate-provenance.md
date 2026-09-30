# 羽伏浦メインゲート authored 3D

2026-09-30に新島観光協会の公式gallery https://niijima-info.jp/spot/2216/ の正面写真01-113.jpgと斜め写真04-60.jpgを実際にviewして制作。参照画像は作業用work/gate-referenceのみ。公開ソースには画像の画素、テクスチャ、画像から抽出した素材を含めない。

観察した特徴: 白い矩形の左右塔、各塔の小さな上下2つの四角い窓、矩形の中央海側通路、短い横梁と細い水平金属rail、幅の広い左右階段、白い階段側壁、薄灰色の反復tile tread。門はアーチではない。塔に四角い物理貫通穴を設け、各階段を厚みのあるsolidで構築した。仕上げは自作の微細粗面PBRとgeometryによる目地。湿気/塩は塔の下端と窓下sillに限定。

位置は指定座標34.3764393,139.2755897。世界座標はX東/Z南。海側が東のため正面を西へ向ける推定orientation=-π/2。塔の高さ10.8m、幅4.4m、中央通路幅6.4m、梁下7.5m、階段20段/段高.21m/奥行.44mは観察比率を元にしたart scaleであり測量寸法ではない。背面、真上、内部、絶対寸法は未確認。背面の踊り場やrail配置は全周歩行を成立させる推定補完。

接続: `new HabushiMainGate(ground)` のgroupをworldへaddし、group.updateMatrixWorld(true)後、solidsGroup配下のMeshをWorldCollision.addMeshへ登録。借用resourceなし。disposeは自分のgeometry/material/textureのみ解放する。中央通路は開いている。歩行可能な階段とlandingはsolidsGroup内、細い目地/湿気bandは外。geometryを仕上げ別にbatchし6drawcalls。

現行IslandElevationのfootprint sampleは8.9135099645〜12.2269719951m、中央値10.7355021780m、relief3.3134620306m。模型だけではDEMが階段や中央通路を覆うためterrain担当がgradingを反映する必要がある。gradingはcenter(5868.713714657,-4503.84021999997), level10.7355021780, local半幅20/半奥行11m, feather5m, rotation=-π/2。有限矩形内をlevelへ合わせてfeatherで既存DEMへ戻す提案。入口step top=.238mで現地面から歩行可能、原DEMは矩形外で保持。grade接続後、現物GPU接地確認はroot側の未実施段階。

LOCAL_PASS: 3 CPU tests（anchor/4窓の貫通ray/尺度/resource/dispose、WorldCollisionの中央通路clearと全20段support、有限DEM診断）とtsc --noEmit。13676triangles,6drawcalls,最大段差.244m。GPU/実機/Human見た目はこの担当では未検証。
