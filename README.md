# 光影公开版

独立的在线影视网站，不包含 115 网盘凭据、私人片库和原设备上的观看记录。收藏、待看与观看进度保存在各访问者自己的浏览器中。

## 本机运行

需要 Node.js 22 或更高版本，在本目录执行 `npm start`，然后打开终端显示的地址。

## Render 部署

将本目录作为独立 Git 仓库，连接到 Render，使用其中的 `render.yaml` 创建 Blueprint。配置选择免费 Web 服务和新加坡区域。部署后的实际地址由 Render 提供；中国大陆的访问情况需要使用最终地址实际测试。

免费实例空闲 15 分钟后休眠，重新启动可能需要约一分钟；视频代理会消耗出站流量，超出免费额度可能暂停或产生费用，具体以 Render 账户设置为准。片源由第三方提供，搜索与播放情况会变化。

## 项目来源

本项目参考 [LunaTV-config](https://github.com/hafrey1/LunaTV-config)、[DecoTV](https://github.com/Decohererk/DecoTV) 和 [VipVideo](https://github.com/iodefog/VipVideo)。相关许可文本见 `licenses`；播放器库许可见 `web/vendor/hls.LICENSE`。
