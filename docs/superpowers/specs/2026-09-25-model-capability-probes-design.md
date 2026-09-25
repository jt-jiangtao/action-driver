# Model Capability Probes and Image Input Gate

## Purpose and success criteria

Model settings currently force each model into `chat` or `image` and ask the user to choose an image generation API. This misrepresents models with more than one capability and makes a provider's actual response secondary to a manual label. Replace those controls with capability results produced by explicit tests. The user chooses only the default image generation model.

Success means that the listed Token Plan models show their relevant capabilities, a model can pass more than one capability, text and image generation use their tested interfaces, and a message containing an image is sent only when the selected chat model's visual test has succeeded. An untested, inconclusive, or failed visual result blocks submission with a clear path to test that model. Audio and video capabilities appear as catalog information but are not tested or callable in this change.

## Battle conclusion

- **Type:** Product and architecture decision. It changes model discovery, provider calls, persisted results, public DTOs, settings, and message submission.
- **Goal:** Remove manual model classification while accurately showing which supported actions each model has passed.
- **Challenge:** Model names and catalog documentation can be stale or differ between gateways. A single `ping` cannot prove vision, reasoning, or image generation. Real image tests can incur cost, and reasoning evidence can be unavailable even when a provider accepts a thinking parameter.
- **Alternatives:** (1) Keep explicit `chat`/`image` selection and expose additional visual toggles. This is cheap but leaves the user responsible for incorrect capability claims. (2) Blindly run every modality test against every discovered model. This is provider agnostic but creates predictable paid image requests and noisy failures. (3) Use a small, versioned catalog to select meaningful probes, then persist actual per-capability results. This is the selected approach.
- **Decision:** Use catalog-guided, explicitly triggered, real tests for text, reasoning, vision, and image generation. Show audio and video catalog labels without testing. Derive chat eligibility and default image candidates from successful results. Remove model kind and image API selectors from the UI. Route Token Plan image models to the Token Plan adapter, other image candidates to Images API.
- **User override:** The user first preferred forwarding every image to the provider, then chose a strict visual gate after seeing the provider rejection. Only a successful visual test permits an image attachment; all other states block it. Preserve the actual provider error display for requests that fail after the gate, including changed provider behavior.
- **Risk accepted:** Real image tests may be billed; a strict visual gate can temporarily block a capable model until its test succeeds. Tests run only after a user action, never during discovery or refresh.

## Capability model

Persist a result for each of `text`, `reasoning`, `vision`, and `image_generation`. Each result has `untested`, `testing`, `success`, `unsupported`, `failed`, or `inconclusive`, a `catalog`/`probe`/`legacy` source, plus the test time and a short provider error when relevant. `unsupported` means an explicit provider rejection of that capability or a catalog exclusion that has not been contradicted by a successful test; the source distinguishes these cases in the UI. Transient transport, authentication, rate-limit, timeout, and malformed responses are `failed` or `inconclusive`, never evidence that the model intrinsically lacks the capability. A successful probe takes precedence over catalog metadata. A later explicit test replaces only the result for the capability it tested.

The catalog is a versioned hint, not availability proof. For the user's Token Plan list it marks:

| Capability candidates | Model IDs |
| --- | --- |
| Text and reasoning and vision | `qwen3.8-max`, `qwen3.8-flash`, `qwen3.7-plus`, `qwen3.6-flash` |
| Text and reasoning | `qwen3.7-max`, `deepseek-v4.1-flash`, `deepseek-v4-pro-0813`, `deepseek-v4-pro`, `deepseek-v4-flash-0731`, `glm-5.3`, `glm-5.2` |
| Image generation | `qwen-image-3.0-pro`, `wan2.7-image`, `wan2.7-image-pro` |
| Audio, display only | `qwen-audio-3.0-asr-flash`, `qwen-audio-3.0-realtime-plus`, `qwen-audio-3.0-tts-plus` |
| Video, display only | `happyhorse-1.1-t2v`, `happyhorse-1.1-i2v`, `happyhorse-1.1-r2v` |

Discovery remains provider driven. Catalog entries enrich discovered models and do not create unavailable provider models. Manual model IDs remain possible. Unknown IDs are candidates for text, vision, and image tests where the connection protocol supports those probes; reasoning is attempted only if a supported provider request can ask for reasoning. The test summary distinguishes capability claimed by the catalog from capability confirmed by a test. Untested audio/video stays visibly “未接入测试”, without a success badge.

## Test flow and provider routing

The user clicks a model's test action. Runtime selects applicable probes from catalog hints or the unknown-model fallback, performs them independently, saves each result, and returns per-capability outcomes to the UI. A failed vision probe must not erase a successful text result. The UI shows separate Text, Reasoning, Vision, and Image results, and the capability's error can be inspected. There is no automatic paid probe when listing or refreshing models.

- **Text:** Issue a small chat completion and require usable nonempty text. An HTTP success without usable content is inconclusive.
- **Reasoning:** Issue a provider-appropriate small reasoning request. Mark success only when the response exposes positive reasoning evidence through a documented field or equivalent. A normal final answer alone is inconclusive. When the provider offers no verifiable reasoning signal, show inconclusive rather than claiming unsupported.
- **Vision:** Send a bundled image fixture in a multimodal chat request and require the expected answer from its content. A plain successful text response that ignores the image does not pass. A definitive provider rejection is unsupported; temporary failures do not pass.
- **Image generation:** Generate one small test image through the selected adapter and verify its bytes as a decodable image. Token Plan routing follows the official Token Plan gateway; other compatible connections use Images API. A model can have successful text and image results simultaneously.

Each probe has a bounded timeout and can be cancelled; results are committed independently. Test output may contain provider error text but no API key or raw image data. The image produced for a settings test is discarded after validation and is not added to a conversation. The existing generation tool continues to store real conversation images under the session asset directory.

## Runtime and UI rules

The chat picker includes enabled models with a successful text result. The image generation default picker includes enabled models with a successful image generation result and a usable tested adapter; only one can be default. Disabling, deleting, or losing image success for that model clears the default. A stored legacy default is shown as provisional until retested and cannot generate while unverified.

The composer checks image attachments against the selected model's **successful vision result**, including at submission time in Runtime. If the result is untested, inconclusive, failed, or unsupported, it keeps the draft and image in place, blocks sending, and says why with an action to open that model's test in settings. Plain text messages use the text success rule. If the provider later rejects an image after a previously successful test, the task shows the real provider error at that reply; the existing failed-task display remains.

The settings list replaces kind and image API controls with compact capability badges and per-capability details. The only image-related choice is “设为默认生图”. Audio and video labels are informational. The Add Model flow tests the model and shows the same results before saving; it need not force the user to pick a kind. A connection containing only image-capable models can be saved.

## Persistence and migration

Runtime owns the catalog, probes, route choice, capability records, and default model validity. Shared contracts carry serializable result DTOs; the renderer only presents them. Add an additive SQLite migration for per-capability state and test metadata. Map old successful chat tests to provisional text results and old image kind or default references to provisional image candidates, **not** verified successes. Existing models therefore need one new test before they become selectable for chat or image generation; settings shows this action prominently. Retain connection secrets, enabled flags, model IDs, and session assets. Legacy kind and image fields may remain as migration inputs but no longer govern eligibility. Refresh preserves existing test results for unchanged model IDs; changing connection credentials or endpoint invalidates those results. A new test updates only its target capability.

## Verification

Unit tests cover catalog mapping, route selection, all result transitions, default clearing, migration, and DTO serialization. Runtime tests cover actual text, reasoning, visual, and image probes with fake provider responses, including independent partial failures and cancellation. UI tests cover badge states, default selection, strict image gate with draft preservation, and image-free text submission. End-to-end tests cover a visual success, visual rejection before send, a provider error after prior success, and a model that passes both text and image generation. Existing image layout and failed-task tests remain in the suite.
