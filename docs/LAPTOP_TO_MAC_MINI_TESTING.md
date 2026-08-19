# Test Your Mac mini Local Model from a Laptop

This guide explains exactly how to use the **Phase 0 Load Lab** when the model runs on your Mac mini and you use a separate laptop through SSH. You do not need to expose the model port publicly. SSH will create private tunnels from your laptop to services that remain on `127.0.0.1` on the Mac mini.

> **Simple picture:** The Mac mini runs the model and the testing dashboard. Your laptop opens the dashboard in a browser. SSH privately carries both the dashboard traffic and the model requests between the laptop and Mac mini.

## 1. What you are actually testing

You are testing whether **one local model can serve several independent requests at the same time**. The dashboard creates virtual users. A virtual user is not a real login account; it is one separate browser request sent to your local model API.

If you set **Users = 2**, the dashboard sends **two requests** to the model. If you set **Users = 3**, it sends **three requests**. They use the same base system instruction and the same base user prompt that you typed in the dashboard.

By default, **Make users independent** is enabled. The dashboard appends a small suffix such as `Virtual user 1: produce an independent answer` to each request. The requests are therefore conceptually the same task but are not byte-for-byte identical. This is the realistic test for separate customers.

| Option | What happens | When to use it |
|---|---|---|
| **Make users independent = ON** | Every virtual user gets the same base prompt plus a tiny user-specific suffix. | Use this for your normal Phase 0 capacity test. |
| **Make users independent = OFF** | Every virtual user receives exactly the same message history. | Use this later to see whether your inference server benefits from shared-prefix prompt caching. |

The dashboard does **not** know your true model-server slot count automatically. Its request-lane display shows the virtual demand you launch. Your real server slot setting is configured in the model server, such as llama.cpp `--parallel` or Ollama’s concurrency settings.[1] [2]

## 2. Before starting: decide your model port

You need to know the port where your local model API is listening on the **Mac mini**. Common values are shown below. Do not guess; use the local verification command in the next section.

| Local model server | Typical port | Dashboard endpoint base after the SSH tunnel |
|---|---:|---|
| llama.cpp HTTP server | `8080` | `http://127.0.0.1:8080/v1` |
| Ollama | `11434` | `http://127.0.0.1:11434/v1` |
| MLX-LM server | `8080` unless changed | `http://127.0.0.1:8080/v1` |
| Another OpenAI-compatible server | Your configured port | `http://127.0.0.1:YOUR_PORT/v1` |

The dashboard itself runs on port **3000** in this project. The model port and the dashboard port are different. You must tunnel both ports.

## 3. On the Mac mini: start the dashboard

Open a terminal on the Mac mini. Change into the repository folder that you cloned.

```bash
cd ~/Local_server
```

If you have not already installed the JavaScript dependencies, run:

```bash
npx pnpm@10.4.1 install
```

Start the dashboard on **localhost only**. This keeps the dashboard private to the Mac mini; your laptop will reach it through SSH.

```bash
npx pnpm@10.4.1 exec vite --host 127.0.0.1 --port 3000
```

Keep this terminal open. You should see output similar to:

```text
Local: http://localhost:3000/
```

If the port is already used, stop the old Vite process or use a different dashboard port, such as `3001`. If you use another dashboard port, replace `3000` with that value everywhere in this guide.

## 4. On the Mac mini: verify the model server first

Open a **second** terminal on the Mac mini. Your model server must already be running, and it should listen on `127.0.0.1`, not a public network interface.

### 4.1 Find the model name

Use the command matching your server. If you use Ollama:

```bash
ollama list
```

For an OpenAI-compatible server, try:

```bash
curl http://127.0.0.1:8080/v1/models
```

If your model is on another port, replace `8080`. Write down the exact model identifier. You must paste that exact value into the dashboard’s **Model name** field.

### 4.2 Verify one streaming request locally

For a server on port `8080`, run this command on the Mac mini. Replace `YOUR_MODEL_NAME` and the optional test key.

```bash
curl -N http://127.0.0.1:8080/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_PHASE0_TEST_KEY' \
  -d '{
    "model": "YOUR_MODEL_NAME",
    "stream": true,
    "max_tokens": 32,
    "messages": [
      {"role": "user", "content": "Reply with one sentence about bounded queues."}
    ]
  }'
```

If the local model has no API key, remove this line from the command:

```bash
-H 'Authorization: Bearer YOUR_PHASE0_TEST_KEY'
```

You should see several lines beginning with `data:`. If this command does not work locally on the Mac mini, stop here and fix the model endpoint before trying SSH or the dashboard.

### 4.3 Allow the dashboard browser origin through CORS

The dashboard is served at `http://localhost:3000`. Your model server must allow that browser origin. This is a browser requirement, even though both requests will travel through SSH.

For llama.cpp, the server supports a CORS origin option.[1] An example local-only command is:

```bash
llama-server \
  -m /absolute/path/to/your-model.gguf \
  --host 127.0.0.1 \
  --port 8080 \
  --cors-origins http://localhost:3000 \
  --parallel 2 \
  --cont-batching \
  --cache-prompt
```

For Ollama, configure `OLLAMA_ORIGINS` to allow `http://localhost:3000` and restart Ollama. Ollama documents this browser-origin control in its FAQ.[2]

> Do not set CORS to `*` merely to make an error disappear. Keep the model bound to localhost and allow only the dashboard origin for Phase 0.

## 5. On your laptop: create the SSH tunnels

Open a terminal on your laptop. Replace `MAC_MINI_HOST` with the address you normally use for SSH. This can be the Mac mini’s local IP address, a Tailscale name/IP, or an SSH config alias.

### Example A: model server is on port 8080

```bash
ssh -N \
  -L 3000:127.0.0.1:3000 \
  -L 8080:127.0.0.1:8080 \
  inunity@MAC_MINI_HOST
```

### Example B: Ollama is on port 11434

```bash
ssh -N \
  -L 3000:127.0.0.1:3000 \
  -L 11434:127.0.0.1:11434 \
  inunity@MAC_MINI_HOST
```

Leave this laptop terminal open. It may appear to do nothing. That is correct: it is holding the private tunnels open.

The command means:

| Part | Meaning |
|---|---|
| `-N` | Create tunnels only; do not open a remote shell. |
| `-L 3000:127.0.0.1:3000` | Your laptop’s `localhost:3000` privately forwards to the Mac mini’s dashboard at `127.0.0.1:3000`. |
| `-L 8080:127.0.0.1:8080` | Your laptop’s `localhost:8080` privately forwards to the Mac mini’s model API at `127.0.0.1:8080`. |
| `inunity@MAC_MINI_HOST` | Your normal SSH user and Mac mini hostname/IP. |

No one on the public internet can use these forwarded ports. They are only available on your laptop’s local loopback interface while the SSH command is running.

## 6. On your laptop: verify both tunnels

First open the dashboard in your laptop browser:

```text
http://localhost:3000
```

Then, in a second laptop terminal, test the model tunnel. For the port-8080 example:

```bash
curl -N http://127.0.0.1:8080/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_PHASE0_TEST_KEY' \
  -d '{
    "model": "YOUR_MODEL_NAME",
    "stream": true,
    "max_tokens": 32,
    "messages": [{"role": "user", "content": "Say that the SSH tunnel works."}]
  }'
```

If the model did not use an API key, remove the `Authorization` line. If the command works from the laptop, the tunnel is correct. If it fails, use the troubleshooting table before using the dashboard.

## 7. Fill the dashboard interface correctly

Open `http://localhost:3000` on the laptop. Fill the left-side configuration panel exactly as follows for the **first test**.

| Dashboard field | First-test value | What it means |
|---|---|---|
| **Endpoint base URL** | `http://127.0.0.1:8080/v1` | The model tunnel on your laptop. Use `11434` instead if you forwarded Ollama’s port. Do not enter port `3000` here; that is the dashboard. |
| **API key** | Your local Phase 0 test key, or blank if the local model has no authentication. | Never paste a production master key. |
| **Model name** | The exact model ID found in Section 4.1. | The API must recognize this exact name. |
| **Users** | `1` | Start with one request to establish a baseline. |
| **Ramp** | `500` ms | This is the delay before each additional virtual user starts. It does not matter much when Users is 1. |
| **Max output** | `128` tokens | Keeps the first test small and easier to compare. |
| **Timeout** | `90000` ms | Stops a stuck request after 90 seconds. |
| **System instruction** | Keep the default. | Same instruction used for every virtual user. |
| **User prompt** | Keep the default or use a short synthetic test prompt. | Same base task sent to every user. |
| **Make users independent** | Keep it enabled. | Adds the small user-specific suffix for realistic separate-user testing. |

## 8. Your first three tests

Run these tests in order. Do not change the model, prompt, output cap, server settings, or timeout while moving from one test to the next.

### Test 1: one-user baseline

Set **Users = 1**. Click **Launch 1 user**. Wait until the user channel says `completed` or `error`.

Write down these values:

| Value | Where to find it |
|---|---|
| Completed / Failed | The Result summary card. |
| TTFT | The virtual-user channel and the top metrics panel. |
| Elapsed time | The virtual-user channel and the top metrics panel. |
| Visible answer quality | The output preview in the virtual-user channel. |

Run the same one-user test three times. You want to know the normal range, not just the fastest lucky result.

### Test 2: two independent users

Keep every setting unchanged except set **Users = 2**. Click **Launch 2 users**.

Yes, the dashboard now sends two near-identical tasks to the model. The base message is the same, while the enabled independent-user option adds a very small distinguishing suffix. This simulates two people asking the same kind of question at almost the same time.

Look for these outcomes:

| Result | Meaning |
|---|---|
| Both finish and p95 TTFT is only slightly slower than the one-user baseline. | Two concurrent requests may be a safe starting point. |
| Both finish but one waits much longer. | The model/server is queueing or batching; decide whether the delay is acceptable. |
| One fails, times out, or the Mac mini becomes slow. | Two users may be too much for the current model/server/context configuration. |

### Test 3: three independent users

Only run this after the two-user test is stable. Change only **Users** from `2` to `3`. Click **Launch 3 users**.

If three users produce a sharp jump in p95 TTFT, much longer elapsed times, errors, or model instability, your initial safe active limit may be **two**. That is a useful result, not a failure.

> For a commercial service, use the highest level that is consistently stable—not the highest level that happened to complete once. If 2 works reliably and 3 is poor, configure Phase 1 to allow 2 active requests and make additional requests queue or receive a controlled retry response.

## 9. How to understand the screen

| Screen area | Plain-language meaning |
|---|---|
| **Request lane bus** | A visual summary of the virtual users you launched. Orange means actively streaming, amber means waiting, teal means completed, and red means failed. It does not automatically show the physical GPU/model slot count. |
| **Active demand** | Requests that are queued, waiting, or currently streaming. |
| **p50 TTFT** | Typical time until the first actual text token appears. |
| **p95 TTFT** | Slower “tail” first-token time. This is important because some customers experience the slow end, not the average. |
| **p95 elapsed** | Slower total time from request start to request completion. |
| **Virtual user channels** | One card per request. You can inspect each output, TTFT, response start, elapsed time, and error independently. |
| **Run tape** | Timestamped test events, including dispatch, first-token arrival, completion, or cancellation. |
| **Server-reported output** | Token count only if your model server provides usage in streamed responses. `not reported` is normal for some local servers. |

## 10. How to choose a safe result

Use the included file `docs/PHASE0_RESULTS_TEMPLATE.md` after each meaningful run. A simple decision rule is:

| Observation | Practical decision |
|---|---|
| One and two users are stable; p95 TTFT remains close to baseline; no errors. | Test three users. |
| Two users are stable; three users are much slower or unstable. | Use two as the initial active model limit. |
| One user is already slow or unstable. | Do not add users. First reduce context/output, check the model server, or choose a smaller model. |
| All users succeed but visible response time is too slow for chat. | Treat the limit as suitable for batch work, not interactive chat. |
| `429` or `503` appears after you later add a gateway. | The gateway is protecting the model from overload; this is expected behavior. |

## 11. Troubleshooting

| Problem | Likely cause | Fix |
|---|---|---|
| `ssh: connect to host ... failed` | Wrong Mac mini hostname/IP, Mac asleep, SSH disabled, or network path unavailable. | First verify your normal SSH login command works. |
| `bind: Address already in use` on laptop | Laptop port 3000, 8080, or 11434 is already occupied. | Close the existing service or use a different local port, such as `-L 38080:127.0.0.1:8080`, then use `http://127.0.0.1:38080/v1` in the dashboard. |
| Browser cannot open `http://localhost:3000` | Dashboard was not started on the Mac mini or the SSH tunnel is not running. | Recheck Sections 3 and 5. |
| Dashboard shows CORS error | The model server does not allow `http://localhost:3000`. | Configure the exact CORS origin on the Mac mini model server and restart it. |
| Dashboard shows `401` | Incorrect test key. | Test the same key with the laptop `curl` command. Remove accidental spaces. |
| Dashboard shows `404` | Wrong model port or wrong endpoint base. | Confirm the model’s local `curl` request works; use `/v1` only if your server exposes OpenAI-compatible routes there. |
| Dashboard shows no stream output | The endpoint may return a non-streaming or nonstandard format. | Use `curl -N` and confirm `data:` events with incremental content arrive. |
| The Mac mini becomes unresponsive at 3 users | You reached an unsafe concurrency/context/output setting. | Stop the test, reduce Users, output cap, context, or model-server parallel slots; restart from the last stable test. |

## 12. Stop and close everything

To stop the test, click **Stop active run** in the dashboard. To close the SSH tunnels, return to the laptop terminal that is running the `ssh -N ...` command and press:

```text
Ctrl+C
```

To stop the dashboard, return to the Mac mini terminal running Vite and press:

```text
Ctrl+C
```

Your model server can remain running if you still need it, but keep it bound to localhost when Phase 0 is complete.

## References

[1]: https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md "llama.cpp HTTP Server documentation"

[2]: https://docs.ollama.com/faq "Ollama FAQ"

[3]: https://docs.vllm.ai/en/latest/features/automatic_prefix_caching/ "vLLM automatic prefix caching"
