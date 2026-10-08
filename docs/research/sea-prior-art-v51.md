# SEA 全体の先行研究と実装判断 — V51

2026-10-08。対象は泊海水浴場、羽伏浦・堀切・シークレット、他島への連続した一人称の旅と遊び。**調査を実写品質の達成とは扱わない。全体ゴールは未達・継続中。** 基準コードは `8a77a2548293cce8cdf4fa50fe6d1321b617fb26`。現在動くものと不足は [体験チェックリスト](../experience-checklist.md)、直前の描画・実行証拠は [V50](../verification-v50.md) を参照する。

今回の結論は、ひとつの海デモを丸ごと移すことでは解決しない、というもの。海の描画、立体的な砕波、身体と船の接触、現地の地形、音と遊びを同じ世界状態につなぐ。先行研究から採る仕組み、SEAの変更箇所、破綻を検出する試験を以下に対応させた。コード・素材は今回まだ取り込んでいない。

## 1. 波の模様から、継続して崩れる立体へ

[Thüreyほか、2007](https://cgl.ethz.ch/Downloads/Publications/Papers/2007/Thue07b/Thue07b.pdf) は、浅水面の急な前面を検出し、その前面を追跡して連結した粒子列を発生させる。離れた水の膜は速度と重力で落ち、着水で飛沫・泡へ移る。表裏と側面で厚みを与える。一方、この波パッチ自体による明示的な質量輸送は未実装で、完全な流体計算ではない。

SEAの `shore-breaker.ts` は通常OFFの候補。毎フレーム、その周辺で最も高い点を選び直すため、隣の波へ切り替わる問題がある。CPUの補助検査と本番GLSLで探索範囲・間隔も違う。円弧の調整や泡の増量より先に直す。

- **採用する設計**：世界座標上の前面ID、位置、進行速度、幅、発生時刻、消滅状態を保持する。接続する点は同じ波に属するものだけとする。膜の発生→落下→衝突→泡・飛沫を時系列でつなぐ。
- **変更先**：`src/ocean/shore-breaker.ts`、`shore-solver.ts`、`shore-spray.ts`、`shore-whitewater.ts`、`whitewater-flow.ts`。
- **受入**：横・背面・水中から、波頭が隣の波へ跳ばない。乾いた浜、深海、静かな湾で誤発生しない。停止・地形変更・計算窓の移動で古い膜が残らない。GPU本番経路を同じ入力の時系列で確認する。

[Chentanez & Müller、2010](https://matthias-research.github.io/pages/publications/hfFluid.pdf) の浅水＋細部粒子は、広い面と細部の分担の参考。[Tall Cell Grid、2011](https://matthias-research.github.io/pages/publications/tallCells.pdf) は3D流体の別候補だが、2Dとの結合は同論文では今後の課題。2007〜2011年のネイティブGPU測定を、現在のブラウザゲームの予算へ直接置き換えない。

## 2. 透明な水・空洞・身体の接触を一致させる

[Crestの水面照会](https://docs.crest.waveharmonic.com/Manual/Advanced/Queries.html) は非同期の高さ照会と波の層の扱いを説明し、船が自分の航跡を再入力する揺れの問題も扱う。[液体の多重屈折研究](https://kanamori.cs.tsukuba.ac.jp/projects/screen_space_liquids/) は水塊と飛沫の前後深度を分ける。[PBRTの媒質境界](https://pbr-book.org/4ed/Volume_Scattering/Media) は表面の内外の媒質を明示する。これらは同じ完成品の別名ではなく、別々の責任を扱う資料である。

- **採用する設計**：浮力・遊泳を支える水塊、薄い膜との接触、光線が通る水と空気の区間を区別する。同じ形状ID・時刻・座標系を共有する。膜の最高点を通常水面として使い、波の空洞を水で埋める近似は採らない。
- **変更先**：`local-water-heights.ts`、`water-volume.ts`、`refracted-path.ts`、`shaders.ts`、`explorer-controls.ts`。
- **受入**：水上／水中／膜の裏側から屈折を確認。照会が古い・範囲外のときに船や身体が急に跳ばない。船の自己航跡による振動、空洞を潜水扱いする誤判定、視点移動で青い板が現れる境界を検査する。

## 3. 沖の波の候補は、互換性と実物を見て選ぶ

[clean-room-fft-ocean](https://github.com/booherbg/clean-room-fft-ocean/tree/213c5800141ecb8099842df516004bfb3f0a8483) の `buoyancy.ts` と水面頂点shaderをrootで読んだ。非同期照会の有効範囲・更新間隔を参考にする。[WebTide](https://github.com/BarthPaleologue/WebTide/tree/a60d603288a88a7f6091af7aa375a7e0b018f42a) は公開デモを内蔵ブラウザで表示し、沖の波・太陽反射を確認した。海岸・接触・遊びの完成を確認したものではない。

[Poseidon](https://github.com/owenyuwono/poseidon/tree/671053b812fcbffe8ecc4668eaa6ab7ffeb63287) のスペクトル・光学系も比較候補だが、WebGPU/TSLを前提とする。[Three.js公式の移行資料](https://threejs.org/manual/pages/webgpurenderer) にある通り、既存ShaderMaterialや後処理がそのまま移るわけではない。SEAの全shaderを置き換える前に、水面の小さい実験で画質・GPU時間・機能互換を比較する。公開READMEにあるブラウザ保護設定の解除は行わない。

FFTの共通原典や派生コードを複数の独立した実証と数えない。旧CrestのMITコードと現行Crest 5の機能資料も分ける。Unity BoatAttackは [Unity Companion License](https://raw.githubusercontent.com/Unity-Technologies/BoatAttack/6acf5f773a440030489cb5e2b3c009fb5fe1e8ce/LICENSE.md) であり、Three.jsへMITとしてコピーしない。

## 4. 全海岸・崖・岩・砂・ランドマーク

東京都の承認済みデータと既存の地図・多方向写真の照合を基礎とする。現在の25cm格子は約400×600mの一部で、羽伏浦全岸や泊の全形状を覆う証拠ではない。上からの高さだけでは崖の張り出し・下の窪みを表せない。

[Open3Dの表面再構成](https://www.open3d.org/docs/release/tutorial/geometry/surface_reconstruction.html) は法線を持つ点群からの再構成と、観測点が少ない場所への外挿を明示する。[meshoptimizer](https://github.com/zeux/meshoptimizer) は境界保護・属性・誤差を使うLODの参考。単なる点群表示のPotreeを、そのまま歩ける面の完成として扱わない。

- **採用する設計**：地点・撮影方向・時期・縮尺を持つ観測台帳へ形状を対応させる。大地形、崖の実3D、割れ目・礫・砂粒の三段階を同じ座標に置く。観測のない穴埋めは推定として保持。異なる岩スキャンの回転・縮尺だけで現地一致としない。
- **変更先**：`src/world/niijima-geological-surface.ts`、`cliff-detail.ts`、`coast-structure.ts`、各地形生成scriptと出典台帳。歩行・水深・光学面も一緒に更新する。
- **受入**：泊の湾曲、羽伏浦の長い海岸線、堀切とシークレットの位置の区別、メインゲート等の輪郭を各資料の画角で確認。崖を横から見ても板にならず、浜を歩いて岸・水へ連続移動できる。LODの縫い目と接触を検査する。

**1cm一致は未達**。格子の数値変換誤差が小さいこと、画像解像度、測量精度、撮影日の一致は別である。空中写真だけから未知の海底や岩の裏側を実測として作らない。

## 5. 波打ち際・砂浜の形成・侵食と堆積

現地の根拠は [既存の海岸過程資料](../habushi-coastal-processes.md) にまとめてある。[XBeachの原資料](https://xbeach.readthedocs.io/en/latest/index.html) は波・流れ・漂砂・地形更新を扱い、主な対象をkm規模、荒天の時間尺度としている。[非静水圧モードの限界](https://xbeach.readthedocs.io/en/latest/xbeach_manual.html#non-hydrostatic-mode-wave-resolving) も読む必要がある。これは即時にゲームへ入る3D巻き波の完成実装ではない。

- 秒単位の遡上・引き波・水膜と、時間の長い堆積・侵食を分ける。堆積を導入するなら土砂の出入りと床更新を保存し、描画・支持・水深・濡れ履歴を同時に更新する。
- V49の砂の濡れ、V50の泡は光学表現。砂の移動や崖の侵食が実装済みとはしない。波を強く設定したQAを「現地で常時この波高」としない。
- 最初の検証は一つの断面・既知の境界条件で、土砂収支、バーム、濡れ・干出、再訪時の一致。その後、現地の異なる時期の資料で比較する。

## 6. 一人称の身体・操作・歩行から潜水

[Three.js r180 FPS例](https://github.com/mrdoob/three.js/blob/r180/examples/games_fps.html) は静的な衝突の参考。[Rapierのcharacter controller](https://rapier.rs/docs/user_guides/javascript/character_controller/) は希望移動量と衝突補正の分離、段差と支持を説明するが、回転する身体や水泳まで自動完成しない。

- **採用する設計**：固定した物理時間刻み、実寸capsule、接地と浸水率、泳法の姿勢を分ける。頭の水没と胴体の浸水を混同しない。手は竿・舵・はしごの実接点へ合わせる。腕だけ綺麗でも、全身の影や足が滑る状態は受け入れない。
- **変更先**：`src/world/explorer-controls.ts`、`player-body.ts`、`contracts.ts`、`src/input/control-settings.ts`。既存の感度・反転・キー・M地図・船上FOVを保持する。
- **受入**：30/60/144Hzで移動と旋回の差を確認。水際の往復で状態が振動せず、岩・天井・船を貫通しない。下向き視点、身体の影、pointer解除、揺れを減らした操作でも成立する。

人体素材は [MakeHumanの同梱asset/output条件](https://raw.githubusercontent.com/makehumancommunity/makehuman/a8bc2d54ff0ac92e78ff71431b1023eda42bf482/LICENSE.md) を確認した。アプリはAGPL、同梱素材はCC0で区別される。現行の身体との品質比較、指rig、泳ぎ・登る・掴む動作の実行確認後に選ぶ。第三者衣服・animationは個別確認。素材を替えるだけで動作の人間らしさは保証されない。

## 7. 船の乗降・甲板・操船・他島航海

[Object3Dの座標変換](https://threejs.org/docs/pages/Object3D.html)、Rapier、Ecctrlの移動床設計を参考にする。EcctrlはReact/Rapier依存で、内部controllerの取得まで確認できなかったため、完成コードの採用判断は保留。

- 船のlocal支持点と前後姿勢から、接地している人だけに船の変位を適用。甲板上の自由な移動と舵の操作を分け、降りる先をcapsuleで確認する。空中・水中の身体に甲板追従を残さない。
- 船は座席・金具・手すり・船外機を実寸で作り、日光、材質、濡れ・汚れ、接触する手と整合させる。海外の大型帆船を日本の小艇の代替にしない。
- 航路は同じ船の速度で進め、地形の描画LODと接岸に必要な衝突の準備を分ける。遠島も実位置の3D形状を使う。原点移動を導入する場合は船・身体・航路・粒子・水面履歴を同時に移す。
- **変更先**：`explorer-controls.ts`、`navigation.ts`、`models/boat-hull.ts`、`models/boat-upholstery.ts`。
- **受入**：停船・波上・旋回で乗降、甲板端・ジャンプ・船と岸の二重支持、遠方や壁越しの操作を確認。泊→他島→帰港・納品まで通常入力で通す。

## 8. 釣り・サーフィン・発見・記録

[Tidewater](https://github.com/dgreenheck/tidewater/tree/4811ba48d795197de5621985f404e765c0b7c0ef) の釣り状態・生息域・図鑑を調査。rootは固定版の [張力モデル](https://github.com/dgreenheck/tidewater/blob/4811ba48d795197de5621985f404e765c0b7c0ef/src/game/CatchMinigame.js) とMIT条件を確認した。魚が走るときは糸を緩める、疲れると取り込みやすくなるという遊びを、竿の曲がり・手・音へつなげる参考になる。物理的な説明を持つゲームモデルで、実魚の完全シミュレーションではない。

- **SEAへ反映する方向**：海底・魚影・時間帯から釣り場を選ぶ。発見や釣果が次の航海の理由になる。取得・納品・装備・保存を独立したUIの作業にせず、現地の行為へ接続する。
- [A Short Hike作者の記事](https://blog.playstation.com/2021/08/05/crafting-a-tiny-open-world-a-look-behind-the-scenes-at-the-creation-of-a-short-hike/) は、主経路から外れても釣りや船などを発見できる設計の参考。人気作であることをSEAの楽しさの証拠にしない。
- 波乗りのSHOREBREAKは接触・ポンプ・転倒のコードをscoutが読んだが、許諾と全面3D波場の根拠が不足。移植は保留。SEAは同じ波の傾き・流速・接触からボードを動かし、浜から運ぶ→パドル→乗波→失敗→戻る流れを仕上げる。
- **変更先**：`src/activities/fishing.ts`、`surfing.ts`、`src/game/expedition.ts`、`expedition-world.ts`、活動UI。
- **受入**：操船と釣りの入力が競合しない。魚信・張力の変化を視聴覚で読める。波の肩と進行方向が一人称で分かる。保存拒否・破損・旧版・満杯・再読込でも二重報酬や消失がない。初めての人が現地の手がかりで遊びを見つけられるか確認する。

## 9. 海中の生物と海岸植生

[東京都の新島・式根島の生物紹介](https://www.kankyo1.metro.tokyo.lg.jp/naturepark/english/know/park/introduction/kokuritsu/fujihakone/niijima/animals_and_plants.html) は、ヒメユズリハが強い海風の場所と内陸で異なる樹形になることを説明する。地域の種の存在と、対象浜の個体位置・密度は別の根拠として保持する。公園の植栽や寺院の特定の巨木を、シークレットの崖へ散布しない。

- [Three.jsの群れの原実装](https://github.com/mrdoob/three.js/blob/r180/examples/webgl_gpgpu_birds.html) と [面上散布](https://github.com/mrdoob/three.js/blob/r180/examples/webgl_instancing_scatter.html) はアルゴリズムの参考。魚は岩・海底・水面を避け、速度方向へ体を向け、尾とひれに別の位相を持たせる。植物は標高・傾斜・材質・風当たり・群落と空白で分布させる。
- 形の違い、枝の欠損、成長方向、個体の位相を固定seedで保持する。同じ画像板を正面へ向けるだけの多様性にしない。
- **変更先**：`fish-motion.ts`、`branch-foliage.ts`、`foliage-lod.ts`、海中植生と配置データ。
- **受入**：裏側でも魚・葉・枝に厚みがあり、全体が同時に動かない。群れの岩貫通、宙に浮く植生、反復した樹冠、距離での点滅を確認。種の推定を現地観察済みとしない。

## 10. 雲・太陽・遠景・材質の照明

[Brunetonの大気実装](https://ebruneton.github.io/precomputed_atmospheric_scattering/) は空と距離による散乱の共有、[Takramの体積雲](https://github.com/takram-design-engineering/three-geospatial/tree/main/packages/clouds) は雲の影・時間的再利用の参考。後者は高速旋回や遮蔽解除の残像を既知の問題としている。SEAへ同じ速度・品質で入るとは限らない。

- 固定昼光のHDRを比較基準として保持し、動的な空・雲は太陽方向、環境照度、船や水の反射、雲影を同時に更新する。動かした太陽と固定したHDRの太陽を併存させない。
- 遠景の島へも同じ大気の透過と散乱を適用する。青い霧の一律な塗りや背景写真だけに置き換えない。
- **変更先**：`photographic-sky.ts`、`renderer.ts`、`world-materials.ts`、`shaders.ts`。
- **受入**：日中・低い太陽、太陽側・逆側、船の光沢、島の前後関係、急な見回しで照明と稜線が整合。雲なしとの差分GPU時間とフレーム時間分布を同じ機材・解像度で測る。元プロジェクトのFPS表は転用しない。

## 11. 風・水・船・身体・鳥の音

[W3C Web Audio](https://www.w3.org/TR/webaudio/) の位置・距離・パラメータ遷移、[ElevenLabsの効果音資料](https://elevenlabs.io/docs/overview/capabilities/sound-effects) を参照。音源生成と、物理状態へ同期するミックスは別工程。現地映像の編集音を、その場所の音響計測として扱わない。

- 相対風は環境風から聴き手の速度を引く。砕波・着水・足接地・船体衝撃はIDのあるイベント、海鳴りや風は連続量。足音は乾砂・湿砂・岩・浅水を分ける。
- **今回見つかった不足**：`soundscape-state.ts` のエンジン音とpitchは現在、船速へ依存する。RPM・負荷・稼働状態を別に渡し、停機して漂流する時と、停止してアイドリングする時を区別する必要がある。
- 調査packetの「潜水中は吸気ゼロ」という提案はそのまま採らない。SEAの要求はスキューバで、レギュレーターの呼吸と呼気の泡が必要。素潜り・装備・空気残量を区別し、既存の潜水呼吸を誤って消さない。
- **変更先**：`src/audio/soundscape-state.ts`、`environment-graph.ts`、船・身体の状態の渡し方。
- **受入**：停機漂流、アイドリング、加速、波の衝撃が別々に聞こえる。水面境界の急反転、ループ継ぎ目、二重発音、clip、停止後の音残りを実録音で確認。自然さ・適度な音量はイベント数の検査だけで判定しない。

## 12. アセット・公開・保存・紹介動画

[Poly Haven](https://polyhaven.com/license) と [ambientCG](https://docs.ambientcg.com/license/) のCC0素材を候補にできるが、別海岸の岩・砂は現地の位置と地質を証明しない。Poly Havenの作例画像と素材本体も別条件。Mixamoのゲーム利用説明だけから、元FBXを公開GitHubへ無制限再配布できるとは判定しない。Freesoundも投稿単位で条件を確認する。

新素材は原URL・作者・license・取得時の版・変換hashを保持し、公開コード、埋込HTML、映像の用途をそれぞれ確認する。今回は新たな素材の購入・生成・配布を実行していない。

椅子・傘・岩・タンク等を置く既存機能も残す。新しいモデルは支持面と衝突を持たせ、浜・水面・船上のどこに置く物かを区別する。置き直し、重複、取り消し、保存復帰と他の活動の動線を確認する。物を増やしたことで実在の海岸線を塞いだり、同じ岩が整列する見え方にしない。

最後の動画は、完成した同じゲームの通常プレイを保存し、その原録画から砂浜・近い岩・水中・船上・広い島影・遊びを編集する。[録画仕様](https://playwright.dev/docs/videos) が保証する保存と、映像の鑑賞品質やプレイの成立は別である。テスト用の短い動画を完成紹介動画へ名前だけ変えない。

## 直近の実装順序

1. 砕波の前面追跡を世界固定の小さいデータとして実装し、現行の瞬時最大点探索と本番GPUで比較する。静止・横・水中・移動中で採否を決める。通常表示を変更する前に、膜・水塊・接触の契約を揃える。
2. 同じ波イベントから飛沫・残留泡・接触音をつなぎ、エンジン状態を船速から分離する。一つの水際→潜水→船上の動作で確かめる。
3. 現地資料が薄い崖・遠景・海底・人体と船の接点を優先して作る。全機能を別々に飾るより、同じ旅程中に見える破綻を先に除く。
4. 泊から他島の釣り・波乗り・発見を経て帰還・納品・保存復帰まで一連で確認する。別途、各海岸を横・後ろ・近距離・水中から見る。全体受入後に紹介動画を作る。

これは工程の順序であり、後半の要望を削ったり完了条件を小さくするものではない。

## 調査方法と証拠の限界

15の公開資料担当をSol/lowの独立した短い文脈で実行し、波、Web実装、性能、反証、権利、光学、地形、FPS、航海、遊び、生態、空、音、素材、全体受入を分担した。各完了turnの実行モデルと親の起動記録を照合。公開Webのみを読む行動上の制約であり、読み取り専用sandboxが強制されたという意味ではない。

rootは重要な一次資料と選択したコード・利用条件を再確認し、ローカル実装と照合した。Three.js派生、Bruneton派生、FFT共通原典を独立票として増やしていない。2007論文の格子数はscoutの桁誤りを訂正し、実際は例ごとに12,000〜20,000セル。過去の別機材・別実装の速度をSEAのGPU性能の保証にしない。公開デモの確認範囲と実ゲームの受入も分ける。

未取得・未確定：現地全岸の多方向近接計測と海底、1cm精度、地域ごとの生物配置、全ルートの現在版実プレイ、体と道具の最終接触、自然な音の聴感、全面的な3D巻き波の費用、最終紹介動画。Google/観光/動画の参照画素は新たに同梱していない。取得できなかった資料、原文で確かめていない推奨、別エンジンの実装は採用済み扱いにしない。
