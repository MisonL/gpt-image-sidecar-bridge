# GPT Image Bridge

把上游站点的 WebUI 图片生成接口包装成 OpenAI Images 兼容接口。

本项目作为独立服务运行，不依赖下游应用容器组，不共享下游容器网络，也不修改下游源码。下游只需要按 OpenAI Images API 形态调用本服务。

## 能力概览

| 能力 | 状态 |
| --- | --- |
| `GET /health` | 健康检查 |
| `GET /v1/models` | OpenAI 兼容模型列表 |
| `POST /v1/images/generations` | 文生图 |
| `POST /v1/images/edits` | 图生图，仅第一站 provider 支持 |
| `POST /v1/images/variations` | 明确返回 `501 unsupported_image_endpoint` |

支持的上游 provider：

| Provider | 上游接口 | 能力 |
| --- | --- | --- |
| `first-site` | `/api/auth/sign-in/email`, `/api/images/generate`, `/api/images/edit` | 文生图、图生图 |
| `second-site` | `/v1/auth/login`, `/v1/images/generations` | 文生图 |

默认 provider 是 `second-site`。使用第一站时设置 `GPT_IMAGE_BRIDGE_PROVIDER=first-site`。

## 兼容口径

- 只支持 `response_format=b64_json`。
- `n` 支持 1 到 5。
- `stream: true` 会返回 OpenAI 兼容 SSE，但只输出最终图事件，不透传上游 partial image。
- 第一站 provider 会按 WebUI 调用口径向上游发送 `Accept: text/event-stream` 和 `stream: true`。
- 上游接口不是公开官方 API，接口变更时需要同步调整本项目适配层。

第一站 WebUI 兼容扩展字段：

| 字段 | 接口 | 说明 |
| --- | --- | --- |
| `generationId` / `generation_id` | 文生图、图生图 | 单张图请求 ID，必须是非空字符串。 |
| `generationIds` / `generationIds[]` / `generation_ids` | 文生图、图生图 | 多张图请求 ID。文生图传 JSON 数组，图生图可传 JSON 数组或多个同名字段。 |
| `mix_web_first` / `mixWebFirst` | 文生图、图生图 | `true` 或 `false`，覆盖 provider 默认值。 |
| `prompt_optimization` / `promptOptimization` | 文生图、图生图 | `true` 或 `false`，覆盖 provider 默认值。 |
| `output_compression` | 文生图、图生图 | 非 PNG 输出时透传压缩参数。 |

## 快速部署

第二站 provider：

```bash
cd <project-dir>
export ADAPTER_API_KEY="<adapter-api-key>"
export SECOND_SITE_EMAIL="your-email@example.com"
export SECOND_SITE_PASSWORD="your-password"
./scripts/deploy-docker.sh
```

第一站 provider，使用账号密码：

```bash
cd <project-dir>
export GPT_IMAGE_BRIDGE_PROVIDER="first-site"
export ADAPTER_API_KEY="<adapter-api-key>"
export FIRST_SITE_EMAIL="your-email@example.com"
export FIRST_SITE_PASSWORD="your-password"
./scripts/deploy-docker.sh
```

第一站 provider，使用 session cookie 文件：

```bash
cd <project-dir>
export GPT_IMAGE_BRIDGE_PROVIDER="first-site"
export ADAPTER_API_KEY="<adapter-api-key>"
export FIRST_SITE_SESSION_COOKIE_FILE="/path/to/first-site-session-cookie"
./scripts/deploy-docker.sh
```

session cookie 或 session token 模式不能自动刷新过期会话。账号密码模式可以在 401 后重新登录。

部署脚本会：

- 构建镜像 `gpt-image-bridge:local`。
- 重建容器 `gpt-image-bridge`。
- 监听宿主机 `http://127.0.0.1:3099/v1`。
- 把运行凭据写入 `$HOME/.config/gpt-image-bridge/secrets/`。
- 以只读文件挂载 secret，不把账号密码、cookie、token 或 adapter key 写入镜像或 Docker 环境变量。

## 验证

提交前检查：

```bash
npm run check
```

`npm run check` 会执行：

- `node --check src/*.mjs test/*.mjs`
- `sh -n scripts/deploy-docker.sh`
- `sh -n scripts/check-standalone-deployment.sh`
- `git diff --check`
- `git diff --cached --check`
- `npm test`

部署后检查：

```bash
./scripts/check-standalone-deployment.sh
```

验证容器化下游访问宿主机服务时，可以显式指定下游容器：

```bash
GPT_IMAGE_BRIDGE_DOWNSTREAM_CONTAINER="<downstream-container-name>" \
./scripts/check-standalone-deployment.sh
```

预期状态：

```text
Docker network: bridge
Listen address: 127.0.0.1:3099 -> 3099
```

## 调用示例

查询模型：

```bash
curl -sS http://127.0.0.1:3099/v1/models \
  -H "Authorization: Bearer <adapter-api-key>"
```

非流式文生图：

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

流式兼容文生图：

```bash
curl -N http://127.0.0.1:3099/v1/images/generations \
  -H "Authorization: Bearer <adapter-api-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "a small red cabin in snow",
    "stream": true,
    "response_format": "b64_json"
  }'
```

图生图编辑，仅第一站 provider 可用：

```bash
curl -sS http://127.0.0.1:3099/v1/images/edits \
  -H "Authorization: Bearer <adapter-api-key>" \
  -F "model=gpt-image-2" \
  -F "prompt=make the subject look like a clean product render" \
  -F "image=@/path/to/source.png;type=image/png" \
  -F "size=1024x1024" \
  -F "mix_web_first=true" \
  -F "prompt_optimization=false" \
  -F "response_format=b64_json"
```

## 下游接入

宿主机进程：

```text
API URL: http://127.0.0.1:3099/v1
API Key: <adapter-api-key>
```

Docker Desktop 容器内通常使用：

```text
http://host.docker.internal:3099/v1
```

注意事项：

- 容器内的 `127.0.0.1` 指向下游容器自己，不是宿主机。
- 如果下游限制非 HTTPS 或非 localhost API URL，需要使用 HTTPS 反代域名，或调整下游 URL 校验规则。
- 不需要流式时，建议在下游关闭 streaming。

常见下游配置：

```text
stream_mode=non_stream
streaming_strategy=off
```

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `GPT_IMAGE_BRIDGE_PROVIDER` | `second-site` 或 `first-site`，默认 `second-site`。 |
| `ADAPTER_API_KEY` | 本服务 Bearer key。 |
| `ADAPTER_API_KEY_FILE` | 从文件读取本服务 Bearer key。 |
| `HOST` | Node 服务监听地址，默认 `127.0.0.1`；Docker 内固定为 `0.0.0.0`。 |
| `PORT` | 容器内监听端口，默认 `3099`。 |
| `HOST_PORT` | Docker 映射到宿主机的端口，默认 `3099`。 |
| `GPT_IMAGE_BRIDGE_CONTAINER` | Docker 容器名，默认 `gpt-image-bridge`。 |
| `GPT_IMAGE_BRIDGE_IMAGE` | Docker 镜像名，默认 `gpt-image-bridge:local`。 |
| `GPT_IMAGE_BRIDGE_CONFIG_DIR` | 本机 secret 目录，默认 `$HOME/.config/gpt-image-bridge`。 |
| `GPT_IMAGE_BRIDGE_DOWNSTREAM_CONTAINER` | 仅用于验证下游容器网络边界。 |

第一站配置：

| 变量 | 说明 |
| --- | --- |
| `FIRST_SITE_BASE_URL` | 第一站地址，默认 `https://gpt2image.superapi.buzz`。 |
| `FIRST_SITE_MODEL` | 默认图片模型，默认 `gpt-image-2`。 |
| `FIRST_SITE_EMAIL` / `FIRST_SITE_EMAIL_FILE` | 登录邮箱或邮箱文件。 |
| `FIRST_SITE_PASSWORD` / `FIRST_SITE_PASSWORD_FILE` | 登录密码或密码文件。 |
| `FIRST_SITE_SESSION_COOKIE` / `FIRST_SITE_SESSION_COOKIE_FILE` | 预置完整 session cookie。 |
| `FIRST_SITE_SESSION_TOKEN` / `FIRST_SITE_SESSION_TOKEN_FILE` | 预置 Better Auth session token。 |
| `FIRST_SITE_TIMEOUT_MS` | 请求超时，默认 `240000`。 |
| `FIRST_SITE_OUTPUT_FORMAT` | 默认 `png`，可用 `png`、`jpeg`、`jpg`、`webp`。 |
| `FIRST_SITE_SIZE` | 文生图默认尺寸，默认 `1024x1024`。 |
| `FIRST_SITE_EDIT_SIZE` | 图生图默认尺寸，默认 `1024x1024`。 |
| `FIRST_SITE_QUALITY` | 默认 `auto`，可用 `auto`、`low`、`medium`、`high`。 |
| `FIRST_SITE_BACKGROUND` | 默认 `auto`，可用 `auto`、`opaque`、`transparent`。 |
| `FIRST_SITE_THINKING` | 思考强度，默认 `low`。 |
| `FIRST_SITE_MODERATION` | 审核参数，默认 `auto`。 |
| `FIRST_SITE_MIX_WEB_FIRST` | 是否优先走 Web，默认 `true`。 |
| `FIRST_SITE_PROMPT_OPTIMIZATION` | 提示词优化开关，默认 `false`。 |

第二站配置：

| 变量 | 说明 |
| --- | --- |
| `SECOND_SITE_BASE_URL` | 第二站地址，默认 `http://154.9.255.153:2254`。 |
| `SECOND_SITE_MODEL` | 默认 `gpt-image-2`。 |
| `SECOND_SITE_EMAIL` / `SECOND_SITE_EMAIL_FILE` | 登录邮箱或邮箱文件。 |
| `SECOND_SITE_PASSWORD` / `SECOND_SITE_PASSWORD_FILE` | 登录密码或密码文件。 |
| `SECOND_SITE_TOKEN` | 预置第二站 token；401 后仍会用邮箱密码刷新。 |
| `SECOND_SITE_TIMEOUT_MS` | 请求超时，默认 `240000`。 |
| `SECOND_SITE_PAYMENT_MODE` | 默认 `tier`。 |
| `SECOND_SITE_OUTPUT_FORMAT` | 默认 `png`，可用 `png`、`jpeg`、`jpg`、`webp`。 |

## 错误排查

| 错误 | 含义 | 处理 |
| --- | --- | --- |
| `401 invalid_adapter_api_key` | Adapter key 不匹配 | 检查下游 API Key。 |
| `400 invalid_multipart_form` | 图生图请求不是 multipart/form-data | 按 `/v1/images/edits` 约定发送。 |
| `501 unsupported_image_endpoint` | 当前 provider 不支持该接口 | 图生图请使用第一站 provider。 |
| `502 first_site_network_error` | 第一站网络失败 | 检查第一站地址、网络和容器可达性。 |
| `502 first_site_image_fetch_failed` | 第一站返回的图片地址不可读取 | 检查图片存储访问权限和返回 URL。 |
| `502 invalid_upstream_image_response` | 上游 200 响应缺少 `b64_json` | 检查上游接口格式是否变化。 |
| `503/502 first_site_login_failed` | 第一站登录失败 | 检查账号、密码、cookie 或 token。 |
| `503 No available compatible accounts` | 第二站账号池或额度不可用 | 处理第二站账号池或额度。 |
| `504 first_site_timeout` | 第一站请求超时 | 增大 `FIRST_SITE_TIMEOUT_MS` 或检查第一站状态。 |
| `504 second_site_timeout` | 第二站请求超时 | 增大 `SECOND_SITE_TIMEOUT_MS` 或检查第二站状态。 |

## 已知限制

- 图生图仅第一站 provider 支持。
- 不支持图片变体。
- 只支持 `response_format=b64_json`。
- `stream: true` 是最终图 SSE 包装，不提供真实 partial image。
- 默认 `n` 范围是 1 到 5。
- 上游站点不是公开官方 API，本项目是临时适配层；上游接口变化时需要同步调整。
