# pi-glm-nonstream

Non-streaming provider extension for GLM-5.2 (or any OpenAI-compatible model) on [Pi](https://pi.dev). Works around broken streaming tool-call assembly by using `stream: false` requests and converting responses to Pi's event stream.

## Why

Some proxies (e.g. micuapi.ai) emit malformed streaming tool-call deltas — argument chunks arrive at new indices without ID carry-over, splitting one tool call into multiple bogus calls. Non-streaming responses are always correctly structured.

## Install

```bash
git clone https://github.com/yiwenlu66/pi-glm-nonstream ~/.pi/agent/extensions/glm-nonstream
```

Or:

```bash
pi install yiwenlu66/pi-glm-nonstream
```

## Configuration

All via environment variables. Defaults target micuapi.ai with GLM-5.2.

| Variable | Default | Description |
|----------|---------|-------------|
| `GLM_NONSTREAM_PROVIDER` | `glm-nonstream` | Provider name in Pi |
| `GLM_NONSTREAM_BASE_URL` | `https://www.micuapi.ai/v1` | API base URL |
| `GLM_NONSTREAM_API_KEY` | `$OCC_API_KEY` | API key (supports Pi's `$VAR` and `!cmd` syntax) |
| `GLM_NONSTREAM_MODEL` | `glm-5.2` | Model ID sent to API |
| `GLM_NONSTREAM_MODEL_NAME` | `GLM-5.2 (non-stream)` | Display name in Pi |
| `GLM_NONSTREAM_CONTEXT` | `1000000` | Context window size |
| `GLM_NONSTREAM_MAX_TOKENS` | `131072` | Max output tokens |

### Examples

**Default (micuapi.ai + GLM-5.2):**
```bash
OCC_API_KEY=sk-... pi --model glm-nonstream/glm-5.2
```

**Different endpoint:**
```bash
GLM_NONSTREAM_BASE_URL=https://api.z.ai/api/coding/paas/v4 \
GLM_NONSTREAM_API_KEY='$ZAI_API_KEY' \
GLM_NONSTREAM_MODEL=glm-5.2 \
pi --model glm-nonstream/glm-5.2
```

**Any OpenAI-compatible model:**
```bash
GLM_NONSTREAM_BASE_URL=https://api.deepseek.com \
GLM_NONSTREAM_API_KEY='$DEEPSEEK_API_KEY' \
GLM_NONSTREAM_MODEL=deepseek-chat \
GLM_NONSTREAM_MODEL_NAME='DeepSeek V3 (non-stream)' \
GLM_NONSTREAM_CONTEXT=65536 \
GLM_NONSTREAM_MAX_TOKENS=8192 \
pi --model glm-nonstream/deepseek-chat
```

## Usage

```bash
pi --model glm-nonstream/glm-5.2
```

Or `/model` → `glm-nonstream/glm-5.2`.

## How it works

1. Registers a custom provider via Pi's `streamSimple` extension API
2. Converts Pi's internal message format to OpenAI Chat Completions format
3. Sends `POST /chat/completions` with `stream: false`
4. Parses the complete response (text, thinking, tool calls)
5. Emits structured `AssistantMessageEventStream` events

## License

MIT
