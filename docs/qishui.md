# 汽水音乐桌面接入（`qishui`）

汽水音乐（SodaMusic）使用独立的 `qishui` provider，仅桌面端。协议代码不经过 npm 包：
`electron/qishui/qishuiClient.cjs` 是一个只覆盖 Folia 用到的端点的薄客户端，请求形状来自
PC 客户端 3.7.0（`aid=386088`）以及 `qishui-api`（MIT）记录下来的实测口径。

## 仓库边界

- 主进程：设备注册、cookie 与 `safeStorage`、passport 扫码登录、h5 曲目取址、全部 luna 请求。
- renderer：只经 `window.electron.qishuiRequest` 调用桥接层；`src/services/onlineMusic/qishui/`
  负责归一化、分页和 provider 合同。
- 没有本地 HTTP 服务，也不开端口；网页版没有汽水音乐，`getAvailability` 回 `runtime-unavailable`。

## 用到的端点

| 用途 | 端点 |
|---|---|
| 搜索 | `GET /luna/search/track` |
| 曲目详情 / 播放地址 / 歌词 | `GET /luna/h5/track_v2?track_id=…&device_platform=web` |
| 我的歌单 / 我喜欢 | `GET /luna/me/playlist` → `GET /luna/playlist/detail` |
| 歌单 / 专辑 / 艺人 | `GET /luna/playlist/detail`、`/luna/albums/<id>`、`/luna/artists/<id>`、`/luna/artists/<id>/tracks`、`/luna/artists/<id>/albums` |
| 最近播放 | `GET /luna/me/recently-played` |
| 登录 | `GET /passport/web/get_qrcode/`、`POST /passport/web/check_qrconnect/` |
| 账号 | `GET /luna/me` |
| 收藏 / 歌单写入 | `POST /luna/me/collection/track`、`/delete`、`/luna/me/playlist`、`/media/append`、`/media/delete` |
| 推荐流（私人 FM） | `POST /luna/pc/feed/song-tab` |
| 推荐歌单（电台页） | `POST /luna/feed/playlist-square` |
| 可播性 | `POST /luna/track/mcheck` |

`device_platform=web` 是 h5 曲目口的放行条件，缺它回 `1000062`；普通浏览器 UA、无 cookie 即可匿名取到
曲目、多档音频、KRC 歌词和权益矩阵。`device_register` 得到的设备身份存在主进程，渲染端拿不到。

## 播放与试听片段

音频是 `audio/mp4`，CDN 支持 Range，签名地址约 24 小时过期。`high` 取 `highest`（约 256 kbit/s），
`standard` 取 `medium`；`lossless` 只在会员账号下列出。

匿名/非会员遇到 VIP 曲时，h5 只给一段试听，`preview.start` 指向歌曲中间（实测 208320 ms）。
`getAudioSource` 照常交出片段，在 `ProviderAudioSource` 上标 `preview: true`，并把
`preview.start` 写进 `clipStartMs`：播放器照放片段并提示“仅可试听”，歌词时钟加上这个偏移，
片段自己的 0 秒对应整首的 `preview.start`。播放进度和时长仍是片段自己的（与其它平台的试听片段
一致），片段不会被当成整曲写入缓存（`wholeSongCheck.ts`）。

## 推荐与私人 FM

`recommendations.getPersonalFm` 走 `FeedSongTab`（`POST /luna/pc/feed/song-tab`），一次要 12 首。
PC 设备必须走 `/luna/pc/` 变体：通用路径 `/luna/feed/song-tab` 会回 `1000006`「当前设备无法访问」。
请求体按 App 口径带会话计数（`is_first_request` / `total_request_count` /
`preference_mode_request_count` / `is_did_first_request` / `did_first_use_time` /
`feed_counts.mix_session_count`），偏好档和场景档各自计数。

- **偏好档**：Folia 的 `DEFAULT` / `FAMILIAR` / `EXPLORE` 映射为汽水的 `default` / `familiar` /
  `fresh`，放在 `feed_preference: { preference_mode }`（顶层 `preference_mode` 也照发）。
  这三个取值来自客户端 IDL 常量；实测只确认请求被接受，曲目分布是否真的随档位变化还没有量过。
- **场景档**：Folia 私人 FM 的模式与场景目录是网易云的 id；汽水的场景是 `FeedMode` 里的短数字
  `scene_mode_id`。只映射两边语义一致的场景（如 `JAPANESE` → 30、`YUEYU` → 10、`GUDIAN` → 32、
  `FOCUS` → 6、`SLEEP_HELP` → 8），映射表在 `qishuiRecommendations.ts`。没有对应场景时按
  `default` 推荐，不拿猜的 id 去请求。场景必须放在扁平的
  `feed_preference: { scene_mode_id }` 里；套一层 `{scene_mode:{...}}` 不生效。
- 响应条目形如 `items[].entity.track_wrapper.track`，适配层先拆到曲目实体再归一化；
  拆不出曲目的条目跳过。`recommendations: true` 和 `personalFmModes: true` 由此一起打开。

汽水自己的 45 个场景里，Folia 目录没有对应项（图书馆、摸鱼、KTV 必点等）的不会被选中；
场景列表没有为此扩展共用目录。

`recommendations.getRecommendedCollections` 走 `FeedPlaylistSquare`（`POST /luna/feed/playlist-square`，
`category_id: 0` = 全部），给电台页的“推荐歌单”卡片。响应条目形如
`items[].entity.playlist`，拆出歌单实体后按 `normalizeQishuiCollection` 归一化，取前 `limit` 个。
没有每日推荐（`getDailySongs`），电台页因此不显示每日推荐卡。

## 登录

`get_qrcode` 的 `data.qrcode` 本身就是 `data:image/png;base64,…`，直接作为登录窗口的 `imageUrl`。
扫码状态映射：`1` 等待、`2` 已扫、`3` 确认、`4` 过期。确认后 `check_qrconnect` 落 cookie，
桥接层再用 `GetMyInfo` 读账号并用 `safeStorage` 加密保存。退出只清本机会话。

## 尚未实现

- 探索页（`GetChartDetail` 已能读，`FeedPlaylistSquare` 现在只供电台页的推荐歌单，没有接成 provider 的 `explore`）。
- 播放历史上报（`AppendRecentPlayedTracks`）和会员完整音质的真实账号验收。
- 歌单改名、删除歌单；收藏专辑/歌单的读回。
- 跨源歌词匹配、本地歌曲匹配、封面按尺寸取图等旁路（见 `src/services/onlineMusic/README.md` 的“按需要做的”）。

## 验证

- `npx tsc --noEmit`
- `npx vitest run -c vitest.config.ts test/unit/onlineMusic/qishuiNormalize.test.ts test/unit/onlineMusic/qishuiProvider.test.ts test/unit/onlineMusic/omniArchitecture.test.ts`
- 手动：搜索一首免费曲能播、VIP 曲放试听片段并提示且歌词对得上、扫码登录后“我的歌单”能读、退出后回到匿名；
  私人 FM 在推荐/熟悉/新鲜三档和日语/粤语等场景下各能拉到一批歌；电台页能看到推荐歌单卡片并打开。
