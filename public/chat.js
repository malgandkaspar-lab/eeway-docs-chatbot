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

  function addMessage(role, text, { sources, isError } = {}) {
    const div = document.createElement("div");
    div.className = "msg " + (isError ? "error" : role === "user" ? "user" : "bot");
    div.innerHTML = renderInline(text);

    if (sources && sources.length) {
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
    }

    chatEl.appendChild(div);
    chatEl.scrollTop = chatEl.scrollHeight;
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
      const data = await res.json();

      loadingEl.remove();

      if (!res.ok) {
        addMessage("assistant", data.error || "Something went wrong.", { isError: true });
        return;
      }

      addMessage("assistant", data.answer, { sources: data.sources });
      history.push({ role: "assistant", content: data.answer });
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
