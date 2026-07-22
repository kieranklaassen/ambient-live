# Cross-origin isolation for WASM threads/SharedArrayBuffer (plan KTD-4, R15).
# `credentialless` (not `require-corp`) so the Vite dev server's cross-port
# assets load without per-resource CORP headers. Supported in Chrome 96+ and
# Firefox 119+; Safari is demo-grade for this app.
Rails.application.config.action_dispatch.default_headers.merge!(
  "Cross-Origin-Opener-Policy" => "same-origin",
  "Cross-Origin-Embedder-Policy" => "credentialless"
)
