# 光影公开版

独立的在线影视网站，不包含 115 网盘凭据、私人片库和原设备上的观看记录。收藏、待看与观看进度保存在各访问者自己的浏览器中。

## 本机运行

需要 Node.js 22 或更高版本，在本目录执行 `npm start`，然后打开终端显示的地址。

## 测试

`npm test` 会运行五项不依赖网络的检查：

- `tests/grouping.cjs`：影片与剧集的类型判定、标题归一化（去掉“国语/粤语”与年份后缀）、按「标题＋年份＋类型」合并。
- `tests/probe.cjs`：线路探测在详情缺失、线路不可用、剧集对不上时的失败处理，以及多线路并发择优。
- `tests/worker-token.cjs`：播放链接 HMAC 签名防篡改与过期。
- `tests/rescue.cjs`：采集站返回播放页时还原真实 m3u8（含相对路径）。
- `tests/live.cjs`：直播频道清单结构（必须 https、无重名、分组合法、生成模块与源文件一致）。

## 电视直播

`/live` 是独立的直播页，频道清单来自开源项目 [iptv-org/iptv](https://github.com/iptv-org/iptv) 的
`streams/cn.m3u`（511 个中文频道），经逐条实测筛选后保留 61 个。

筛选标准（缺一不可）：

1. 播放清单可取，且首个分片能读到；
2. 响应带 CORS，浏览器可以直接播放；
3. **支持 HTTPS** —— 站点是 https，http 源会被浏览器按混合内容拦截；
4. 分片是可解码的 MPEG-TS（`0x47` 同步字节）或 fMP4，剔除 `ARCVIDEO-PROTECTED` 一类的私有加密频道。

播放完全在浏览器直连源站，不经过本站代理，因此不占用 Functions 每日请求额度。

```bash
npm run sync:live     # live-sources.json -> web/live-channels.js
npm run audit:live    # 逐条体检，结果写入 live-report.json（只报告，不自动删减）
```

体检只报告不自动删改：直播源抖动频繁，自动删减容易把能用的频道误杀。

## 片源来源与筛选

采集源不是随便凑的，来源与筛选标准如下。

来源（均为开源项目，格式统一为苹果CMS `api.php/provide/vod`）：

- [LunaTV-config](https://github.com/hafrey1/LunaTV-config) 及其分支 [vodtv/api](https://github.com/vodtv/api)（每日自动检测 API 状态，`report.md` 里有全部候选与成功率）
- [moontv-aggr-config](https://github.com/smallmain/moontv-aggr-config)（聚合多个 MoonTV/LunaTV 配置）
- [tvbox-ysc-config](https://github.com/Lightconer/tvbox-ysc-config)（TVBox 多仓聚合）
- [awesome-zhuiju-free](https://github.com/laoma528/awesome-zhuiju-free) 推荐的 TVBox 配置地址

> 只有 type=1（苹果CMS）的接口能直接接入本站。TVBox 的 type=3（drpy/spider JS 爬虫）
> 和 IPTV 的 m3u 直播流是另外两种形态，不能直接当搜索源用。

一条源要经过四关才会留在列表里：

1. **搜索**：`?ac=videolist&wd=` 返回非空 `list`；
2. **详情**：`?ac=detail&ids=` 能取到 `vod_play_url`；
3. **播放**：首集地址能拿到 `#EXTM3U`（播放页则先经 `rescue` 还原真实 m3u8）；
4. **线上**：以上三步必须**通过已部署站点**跑通 —— Cloudflare 出口和自己的网络不同。

第 4 关是重点：一批源（暴风、豆瓣、茅台、闪电、新浪、飘零、索尼等十几家）在本机能搜能播，
但 Cloudflare 出口被对方拦截（搜索阶段就 403 或直接连接重置），只能放弃。
反过来，也有源（如电影天堂、非凡资源）会时好时坏，所以体检失败会重试一次，且不自动删源。

```bash
npm run audit:sources   # 线上体检，结果写入 functions/_health.js，坏源前端自动停用
```

当前 27 个源，26 个可用（约 96%）。体检里「重试一次」很关键：本轮电影天堂、百度云资源
首次探测失败、复测通过，只按第一轮结果会误判成坏源。

## 部署

### Cloudflare Pages（已上线，国内可用）

**当前线上地址：https://guangying-cinema-c1l.pages.dev**

> 为什么用 Pages 而不是 Workers：`*.workers.dev` 在国内 DNS 被污染（本机与阿里公共 DNS
> 223.5.5.5 都解析到 Facebook 段 `2a03:2880::face:b00c`，而非 Cloudflare IP），国内基本无法访问；
> `*.pages.dev` 解析正常。Pages 的 Functions 与 Workers 是同一运行时，功能完全一致。

实测对比（同一网络）：

| 平台 | 延迟中位数 | 国内可用性 |
| --- | --- | --- |
| **Cloudflare Pages** | **98 ms** | 可用 |
| Bonto | 433 ms | 可用 |
| workers.dev | — | DNS 被污染，不可用 |

部署：

```bash
npm run deploy:pages
```

### 片源体检

采集源会不定期失效，用下面的命令做一次全源体检（搜索 → 详情 → 拉取播放列表逐项验证），
坏源会被自动停用，前端不再请求它们：

```bash
npm run audit:sources
```

> 体检脚本必须探测**线上站点**而不是本机：Cloudflare 的网络与本机不同
> （B 站、play.xluuss.com 都是本机通、Cloudflare 不通），只有线上探测才代表用户真实体验。

### 自动体检（GitHub Actions）

`.github/workflows/source-audit.yml` 每周一自动跑一次体检并部署，也支持手动触发。
需要在仓库 Settings → Secrets and variables → Actions 里添加：

- `CLOUDFLARE_API_TOKEN`：具备 Workers/Pages 编辑权限的 API Token
  （在 https://dash.cloudflare.com/profile/api-tokens 创建）
- `CLOUDFLARE_ACCOUNT_ID`：Account ID（Cloudflare 控制台右侧可见）

### 测试

```bash
npm test
```

四项离线用例：分组去重（`grouping`）、线路探测容错（`probe`）、
播放链接签名防篡改（`worker-token`）、**播放页还原（`rescue`）**、直播清单结构（`live`）。
`rescue` 覆盖「能搜到但播不了」的核心修复，包括相对路径 m3u8 提取与脚本误伤。

（Workers 版 `npm run deploy:worker` 仍保留，但国内访问不了，仅作备用。）

从你的网络实测对比：

| 平台 | 延迟中位数 | 吞吐 | 免费政策 |
| --- | --- | --- | --- |
| **Cloudflare Workers** | **142 ms** | **2.62 MB/s**（并发 3.36） | $0/月，10 万请求/天，无需信用卡，无冷启动 |
| Bonto（当前线上） | 495 ms | 1.01 MB/s | 免费但运行时长有限 |
| 阿里云 / 腾讯云 | 43 / 124 ms | — | 国内最快，但免费额度非永久保证，且自定义域名需备案 |
| Vercel / Netlify / Deno | 200~1850 ms | — | 免费，国内访问明显偏慢 |

Workers 免费档限制：每天 10 万次请求、每请求 10 ms CPU（等待网络不计入，代理转发基本不受影响）、内存 128 MB。

部署步骤：

```bash
npm i -g wrangler
wrangler login          # 会打开浏览器，用 Cloudflare 账号授权
wrangler secret put MEDIA_SECRET   # 设置一个随机字符串，用于播放链接签名
npm run deploy:worker
```

部署完成后会得到一个 `https://guangying-cinema.<你的子域>.workers.dev` 地址，可直接访问。

> 说明：`workers/worker.js` 是同一套功能的 Workers 移植版，与 Node 版的主要差异是改用全局 `fetch`、用 Cache API 缓存视频分段、播放链接改用无状态 HMAC 签名（isolate 重启后仍有效）。

### 其他方案

当前线上地址：`https://guangying-lab.bonto.run`（Bonto，免费额度，冷启动约数十秒）。

历史方案 Render：将本目录作为独立 Git 仓库，连接到 Render，使用其中的 `render.yaml` 创建 Blueprint。配置选择免费 Web 服务和新加坡区域。部署后的实际地址由 Render 提供；中国大陆的访问情况需要使用最终地址实际测试。

免费实例空闲 15 分钟后休眠，重新启动可能需要约一分钟；视频代理会消耗出站流量，超出免费额度可能暂停或产生费用，具体以 Render 账户设置为准。片源由第三方提供，搜索与播放情况会变化。

## 项目来源

本项目参考 [LunaTV-config](https://github.com/hafrey1/LunaTV-config)、[DecoTV](https://github.com/Decohererk/DecoTV) 和 [VipVideo](https://github.com/iodefog/VipVideo)。相关许可文本见 `licenses`；播放器库许可见 `web/vendor/hls.LICENSE`。
