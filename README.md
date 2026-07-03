# pi-glm-nonstream

Non-streaming provider extension for GLM-5.2 on [Pi](https://pi.dev), working around broken streaming tool-call assembly in the [micuapi.ai](https://www.micuapi.ai) proxy.

## Problem

When using GLM-5.2 through micuapi.ai's OpenAI-compatible Chat Completions API with `stream: true`, tool call argument chunks arrive at new indices without ID carry-over. Pi's streaming handler creates a separate (malformed) tool call per index, making tool use impossible.

## Solution

This extension registers a custom provider (`occ-glm-nonstream`) that uses `stream: false` (non-streaming) requests and converts the single-shot response into Pi's `AssistantMessageEventStream`. Non-streaming responses are correctly structured — tool calls arrive as complete objects with proper arguments.

## Install

```bash
# Clone into Pi's global extensions directory
git clone https://github.com/yiwenlu66/pi-glm-nonstream ~/.pi/agent/extensions/glm-nonstream
```

Or install as a Pi package:

```bash
pi install yiwenlu66/pi-glm-nonstream
```

## Usage

Requires `OCC_API_KEY` environment variable (the micuapi.ai API key).

```bash
pi --model occ-glm-nonstream/glm-5.2
```

Or select the model interactively with `/model` → `occ-glm-nonstream/glm-5.2`.

### Thinking levels

| Pi level | GLM-5.2 |
|----------|---------|
| off      | disabled |
| high     | high     |
| xhigh    | max      |

## Configuration

The extension self-registers. No `models.json` changes needed. To customize the base URL or API key, edit `index.ts`.

## How it works

1. Intercepts provider streaming via Pi's `streamSimple` extension API
2. Converts Pi's internal message format to OpenAI Chat Completions format
3. Sends `POST /v1/chat/completions` with `stream: false`
4. Parses the complete response: text, thinking/reasoning, tool calls
5. Emits the structured content as `AssistantMessageEventStream` events

## License

MIT
