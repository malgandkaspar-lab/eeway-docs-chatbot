(() => {
  const chatEl = document.getElementById("chat");
  const formEl = document.getElementById("form");
  const inputEl = document.getElementById("input");
  const sendEl = document.getElementById("send");

  const history = []; // [{role: 'user'|'assistant', content: string}]

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // Very small markdown-ish renderer: bold, inline code, and citation
  // markers like [1] -> superscript. Everything else stays plain text
  // (white-space: pre-wrap in CSS handles line breaks).
  function renderInline(text) {
    let html = escapeHtml(text);
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/`(.+?)`/g, "<code>$1</code>");
    html = html.replace(/\[(\d+)\]/g, '<sup>[$1]</sup>');
    return html;
  }

  function addEmptyStateIfNeeded() {
    if (history.length === 0) {
      const div = document.createElement("div");
      div.className = "empty-state";
      div.id = "empty-state";
      div.textContent =
        "Ask anything about using Eeway — e.g. “How do I create an order?” or “How does the weighbridge integration work?”";
      chatEl.appendChild(div);
    }
  }

  function removeEmptyState() {
    const el = document.getElementById("empty-state");
    if (el) el.remove();
  }

  // Creates an (initially empty) message bubble and returns handles to
  // update it as content streams in.
  function createMessageEl(role, { isError, cached } = {}) {
    const div = document.createElement("div");
    div.className = "msg " + (isError ? "error" : role === "user" ? "user" : "bot");

    if (cached) {
      const badge = document.createElement("div");
      badge.className = "cached-badge";
      badge.textContent = "⚡ instant answer";
      div.appendChild(badge);
    }

    const body = document.createElement("div");
    div.appendChild(body);

    chatEl.appendChild(div);
    chatEl.scrollTop = chatEl.scrollHeight;
    return { div, body };
  }

  function setMessageText(body, text) {
    body.innerHTML = renderInline(text);
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  function addSources(div, sources) {
    if (!sources || !sources.length) return;
    const src = document.createElement("div");
    src.className = "sources";
    src.innerHTML =
      "Sources: " +
      sources
        .map(
          (s) =>
            `<a href="${s.url}" target="_blank" rel="noopener">[${s.n}] ${escapeHtml(
              s.title
            )}</a>`
        )
        .join("&nbsp;&nbsp;");
    div.appendChild(src);
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  // Convenience for the simple, non-streaming cases (user echo, plain errors).
  function addMessage(role, text, opts = {}) {
    const { div, body } = createMessageEl(role, opts);
    setMessageText(body, text);
    addSources(div, opts.sources);
    return div;
  }

  function addLoadingMessage() {
    const div = document.createElement("div");
    div.className = "msg bot loading";
    div.textContent = "Thinking…";
    chatEl.appendChild(div);
    chatEl.scrollTop = chatEl.scrollHeight;
    return div;
  }

  async function sendMessage(message) {
    removeEmptyState();
    addMessage("user", message);
    history.push({ role: "user", content: message });

    inputEl.value = "";
    inputEl.style.height = "auto";
    sendEl.disabled = true;

    const loadingEl = addLoadingMessage();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history: history.slice(0, -1) }),
      });

      if (!res.ok) {
        // Validation errors (bad request, no backend) are returned as a
        // single plain JSON body rather than a stream.
        const data = await res.json().catch(() => ({}));
        loadingEl.remove();
        addMessage("assistant", data.error || "Something went wrong.", { isError: true });
        return;
      }

      let answerEl = null; // { div, body }
      let accumulated = "";
      let pendingSources = null;
      let sawError = false;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;

          let evt;
          try {
            evt = JSON.parse(line);
          } catch {
            continue;
          }

          if (evt.type === "meta") {
            pendingSources = evt.sources;
            answerEl = createMessageEl("assistant", { cached: evt.cached });
            loadingEl.remove();
          } else if (evt.type === "delta") {
            accumulated += evt.text;
            if (!answerEl) {
              answerEl = createMessageEl("assistant");
              loadingEl.remove();
            }
            setMessageText(answerEl.body, accumulated);
          } else if (evt.type === "error") {
            sawError = true;
            loadingEl.remove();
            if (!answerEl) {
              addMessage("assistant", evt.message || "Something went wrong.", { isError: true });
            }
          }
          // "done" needs no handling - the loop just ends when the stream closes.
        }
      }

      loadingEl.remove();

      if (answerEl && !sawError) {
        addSources(answerEl.div, pendingSources);
        history.push({ role: "assistant", content: accumulated });
      }
    } catch (err) {
      loadingEl.remove();
      addMessage("assistant", "Network error — is the server running?", {
        isError: true,
      });
    } finally {
      sendEl.disabled = false;
      inputEl.focus();
    }
  }

  formEl.addEventListener("submit", (e) => {
    e.preventDefault();
    const message = inputEl.value.trim();
    if (!message) return;
    sendMessage(message);
  });

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      formEl.requestSubmit();
    }
  });

  inputEl.addEventListener("input", () => {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + "px";
  });

  addEmptyStateIfNeeded();
  inputEl.focus();
})();
