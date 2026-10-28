# 光影公开版

独立的在线影视网站，不包含 115 网盘凭据、私人片库和原设备上的观看记录。收藏、待看与观看进度保存在各访问者自己的浏览器中。

## 本机运行

需要 Node.js 22 或更高版本，在本目录执行 `npm start`，然后打开终端显示的地址。

## 测试

`npm test` 会运行六项不依赖网络的检查：

- `tests/grouping.cjs`：影片与剧集的类型判定、标题归一化（去掉“国语/粤语”与年份后缀）、按「标题＋年份＋类型」合并。
- `tests/probe.cjs`：线路探测在详情缺失、线路不可用、剧集对不上时的失败处理，以及多线路并发择优。
- `tests/worker-token.cjs`：播放链接 HMAC 签名防篡改与过期。
- `tests/rescue.cjs`：采集站返回播放页时还原真实 m3u8（含相对路径）。
- `tests/playlist.cjs`：播放列表重写 —— AES-128 密钥、fMP4 初始化段、音轨清单等 `URI="..."` 必须被代理，
  `data:` 内联密钥原样保留，标签行其余属性不能被破坏。
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
3. **播放**：能拿到 `#EXTM3U`（播放页则先经 `rescue` 还原真实 m3u8），**且首个分片解出来的魔数必须是视频**
   （TS 同步字节 `0x47` / fMP4 的 `ftyp`、`styp`；AES-128 的分片先解密再判）；
4. **线上**：以上三步必须**通过已部署站点**跑通 —— Cloudflare 出口和自己的网络不同。

第 4 关是重点：一批源（暴风、豆瓣、茅台、闪电、新浪、飘零、索尼等十几家）在本机能搜能播，
但 Cloudflare 出口被对方拦截（搜索阶段就 403 或直接连接重置），只能放弃。

第 3 关的「分片魔数」是后来补的，起因是抓到一个假源：`iqiyizyapi.com`（标着「爱奇艺」）的
播放列表完全正常，但所谓分片其实是一张张 JPEG，每张停 4 秒 —— 是幻灯片不是视频。
只验「播放列表返回 200」会把它判成可用，用户点开一片空白。现在这类源直接被拒。

```bash
npm run audit:sources   # 线上体检，结果写入 functions/_health.js，坏源前端自动停用
```

**体检必须温和**：串行、单次、源之间停 400ms。这些采集站对同一 IP 的连续请求很敏感，
并发探测或快速重试会把「本来能播」的源打成 502 或连接重置 —— 审计于是自己制造假失败。
实测高强度探测之后，连本机 IP 都被 `dyttzyapi.com` 重置。真实用户是一次搜一次播，体检也应照这个节奏。

当前 27 个源，24 个启用。停用的 3 个各有明确原因，不是抖动：
`iqiyizyapi.com` 分片是 JPEG 幻灯片、`ukuapi88.com`（U酷）长期 502、`apibdzy.com`（百度云）被 CF 出口拦。

## 播放链路

浏览器不能直接放采集站的流（跨域、防盗链），全部经 `/online/media/<token>` 同源代理，token 是
HMAC 签名过的原始地址，6 小时过期。代理层踩过四个坑，都已修复并有测试兜底：

1. **AES-128 加密源黑屏（影响最大）**。苹果CMS 系的 m3u8 大量带
   `#EXT-X-KEY:METHOD=AES-128,URI="enc.key"`，密钥是相对路径。旧实现只重写非注释行，
   浏览器把密钥解析成 `<本站>/online/media/enc.key` 拿到 410，解密失败 —— 整部片黑屏。
   实测 24 个源里 **13 个**用 AES-128，也就是修之前有一半的源是放不出来的。现在
   `#EXT-X-KEY` / `#EXT-X-SESSION-KEY` / `#EXT-X-MAP` / `#EXT-X-MEDIA` / `#EXT-X-I-FRAME-STREAM-INF`
   里的 `URI="..."` 都会一并代理，`data:` 内联密钥原样保留。
2. **UA 太简陋**。原来统一发 `Mozilla/5.0`，部分 CDN 直接断连（实测 `hd.kuktxu.com`
   对裸 `Mozilla/5.0` 间歇性 ECONNRESET，对完整 Chrome UA 稳定 200）。现在统一完整桌面 Chrome UA。
3. **防盗链**。首轮被 401/403/404/451 拒掉时，补同源 `Referer`+`Origin` 重试一次；
   只有确实变好才替换结果，避免把 200 换成更差的状态。
4. **预取把源站打成限流**。原来每个播放列表请求都触发 12 个分片预取，遇到主清单还会多抓一层，
   一次播放向上游打十几个请求。现在主清单不预取（客户端马上会自己请求子清单），
   且复用已取到的清单文本，不再重复抓。

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
