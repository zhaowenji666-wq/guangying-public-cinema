# 光影公开版

独立的在线影视网站，不包含 115 网盘凭据、私人片库和原设备上的观看记录。收藏、待看与观看进度保存在各访问者自己的浏览器中。

## 本机运行

需要 Node.js 22 或更高版本，在本目录执行 `npm start`，然后打开终端显示的地址。

## 测试

`npm test` 会运行两项不依赖网络的检查：

- `tests/grouping.cjs`：影片与剧集的类型判定、标题归一化（去掉“国语/粤语”与年份后缀）、按「标题＋年份＋类型」合并。
- `tests/probe.cjs`：线路探测在详情缺失、线路不可用、剧集对不上时的失败处理，以及多线路并发择优。

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
