# GPT Image Bridge

把第二站前端生图接口临时包装成 OpenAI Images 兼容接口，供本机或其他服务按
OpenAI `/v1/images/generations` 形态调用。

本项目是独立服务。它不依赖任何下游容器组，不共享下游容器网络，也不修改下游源码。

## 当前能力

| 方向 | 接口 | 状态 |
| --- | --- | --- |
| 第二站 | `POST /v1/auth/login` | 已对接 |
| 第二站 | `POST /v1/images/generations` | 已对接 |
| 对外 | `GET /health` | 已支持 |
| 对外 | `GET /v1/models` | 已支持 |
| 对外 | `POST /v1/images/generations` | 已支持 |
| 对外 | `POST /v1/images/edits` | 明确返回 `501 unsupported_image_endpoint` |
| 对外 | `POST /v1/images/variations` | 明确返回 `501 unsupported_image_endpoint` |

第二站只提供非流式生图。本服务收到 `stream: true` 时，会向第二站发起非流式请求，
再把最终图片包装为 `text/event-stream` 的 `image_generation.completed` 事件返回。
这只是 OpenAI Images SSE 兼容层，不代表第二站有真实 partial image 流。

## 快速部署

```bash
cd "/path/to/gpt-image-sidecar-bridge"
export ADAPTER_API_KEY="<adapter-api-key>"
export SECOND_SITE_EMAIL="your-email@example.com"
export SECOND_SITE_PASSWORD="your-password"
./scripts/deploy-docker.sh
```

部署脚本会：

- 构建镜像 `gpt-image-bridge:local`。
- 重建容器 `gpt-image-bridge`。
- 监听宿主机 `http://127.0.0.1:3099/v1`。
- 把运行凭据写到 `$HOME/.config/gpt-image-bridge/secrets/`，再以只读文件挂载到容器。
- 不把第二站账号密码写入源码、镜像或 Docker 环境变量。

重新部署时可以直接复用本机 secret 文件：

```bash
ADAPTER_API_KEY="$(cat "$HOME/.config/gpt-image-bridge/secrets/adapter-api-key")" \
SECOND_SITE_EMAIL="$(cat "$HOME/.config/gpt-image-bridge/secrets/second-site-email")" \
SECOND_SITE_PASSWORD="$(cat "$HOME/.config/gpt-image-bridge/secrets/second-site-password")" \
./scripts/deploy-docker.sh
```

## 验证

```bash
npm test
./scripts/check-standalone-deployment.sh
```

如果要同时验证某个容器化下游的网络边界，显式传容器名：

```bash
GPT_IMAGE_BRIDGE_DOWNSTREAM_CONTAINER="<downstream-container-name>" \
./scripts/check-standalone-deployment.sh
```

预期独立部署状态：

```text
gpt-image-bridge: Docker bridge network
127.0.0.1:3099 -> 3099
```

## 调用示例

查询模型：

```bash
curl -sS http://127.0.0.1:3099/v1/models \
  -H "Authorization: Bearer <adapter-api-key>"
```

非流式生图：

```bash
curl -sS http://127.0.0.1:3099/v1/images/generations \
  -H "Authorization: Bearer <adapter-api-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "a small red cabin in snow",
    "n": 1,
    "size": "1024x1024",
    "response_format": "b64_json"
  }'
```

流式兼容请求：

```bash
curl -N http://127.0.0.1:3099/v1/images/generations \
  -H "Authorization: Bearer <adapter-api-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "a small red cabin in snow",
    "stream": true,
    "partial_images": 2,
    "response_format": "b64_json"
  }'
```

## 下游接入

宿主机进程可以直接填写：

```text
API URL: http://127.0.0.1:3099/v1
API Key: <adapter-api-key>
```

容器化下游不能把 `127.0.0.1` 当成宿主机地址。对 Docker Desktop 场景，容器内通常能访问：

```text
http://host.docker.internal:3099/v1
```

但下游本身可能会限制 API URL。常见容器化下游约束如下：

- `http://127.0.0.1:3099/v1` 在该容器内指向它自己，不会连到本服务。
- `http://host.docker.internal:3099/v1` 在 Docker Desktop 中通常可连到宿主机上的本服务。
- 如果下游拒绝非 HTTPS、非 localhost 的 URL，需要 HTTPS 反代域名，或调整下游允许的 API URL 规则。

若下游不需要流式，可传：

```text
stream_mode=non_stream
streaming_strategy=off
```

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `SECOND_SITE_BASE_URL` | 第二站地址，默认 `http://154.9.255.153:2254`。 |
| `SECOND_SITE_MODEL` | 默认 `gpt-image-2`。 |
| `SECOND_SITE_EMAIL` | 第二站登录邮箱。 |
| `SECOND_SITE_EMAIL_FILE` | 可选，从文件读取第二站登录邮箱，优先级高于 `SECOND_SITE_EMAIL`。 |
| `SECOND_SITE_PASSWORD` | 第二站登录密码。 |
| `SECOND_SITE_PASSWORD_FILE` | 可选，从文件读取第二站登录密码，优先级高于 `SECOND_SITE_PASSWORD`。 |
| `SECOND_SITE_TOKEN` | 可选，预置第二站 token；401 后仍会用邮箱密码刷新。 |
| `SECOND_SITE_TIMEOUT_MS` | 第二站请求超时，正整数毫秒，默认 `240000`。 |
| `SECOND_SITE_PAYMENT_MODE` | 默认 `tier`。 |
| `SECOND_SITE_OUTPUT_FORMAT` | 默认 `png`，可用 `png`、`jpeg`、`jpg` 或 `webp`。 |
| `ADAPTER_API_KEY` | 本服务 Bearer key；设置后调用方必须鉴权。 |
| `ADAPTER_API_KEY_FILE` | 可选，从文件读取本服务 Bearer key，优先级高于 `ADAPTER_API_KEY`。 |
| `HOST` | Node 服务监听地址，默认 `127.0.0.1`；Docker 内固定为 `0.0.0.0`。 |
| `PORT` | 容器内监听端口，默认 `3099`。 |
| `HOST_PORT` | Docker 映射到宿主机的端口，默认 `3099`。 |
| `GPT_IMAGE_BRIDGE_CONTAINER` | Docker 容器名，默认 `gpt-image-bridge`。 |
| `GPT_IMAGE_BRIDGE_IMAGE` | Docker 镜像名，默认 `gpt-image-bridge:local`。 |
| `GPT_IMAGE_BRIDGE_CONFIG_DIR` | 本机 secret 目录，默认 `$HOME/.config/gpt-image-bridge`。 |
| `GPT_IMAGE_BRIDGE_DOWNSTREAM_CONTAINER` | 仅供 `check-standalone-deployment.sh` 验证下游容器边界，不影响部署。 |

## 错误排查

| 现象 | 含义 | 处理 |
| --- | --- | --- |
| `401 invalid_adapter_api_key` | 调用方 Bearer key 不匹配 | 检查下游填写的 API Key |
| `400 API URL 必须使用 https...` | 下游自己的 API URL 校验拒绝了地址 | 使用 HTTPS 反代域名，或调整下游规则 |
| `500 Connection error.` | 容器化下游内填了 `127.0.0.1:3099` | 容器内 localhost 指向下游容器自己 |
| `501 unsupported_image_endpoint` | 调用了编辑图或变体接口 | 当前只支持生成接口 |
| `502 invalid_second_site_generation_response` | 第二站 200 响应缺少 `b64_json` | 查看第二站返回体，确认接口格式是否变更 |
| `503 No available compatible accounts` | 第二站账号池/额度不可用 | 处理第二站账号池或额度 |
| `504 second_site_timeout` | 第二站请求超时 | 增大 `SECOND_SITE_TIMEOUT_MS` 或检查第二站状态 |

## 已知限制

- 只支持图片生成：`POST /v1/images/generations`。
- 不支持图片编辑和变体。
- 只支持 `response_format=b64_json`。
- `stream: true` 是最终图 SSE 包装，不提供真实 partial image。
- 默认 `n` 范围是 1 到 5。
- 第二站不是公开官方 API，本项目是临时适配层；第二站接口变化时需要同步调整。
