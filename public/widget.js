// Embeddable Eeway support chat widget.
// Drop `<script src="/widget.js" defer></script>` into any page to mount a
// bottom-right chat launcher backed by this server's /api/chat endpoint.
(() => {
  if (window.__eewayWidgetMounted) return;
  window.__eewayWidgetMounted = true;

  const API_ENDPOINT = "/api/chat";

  // Mirrors the palette in styles.css so the widget matches the rest of
  // the site regardless of what page it's embedded on.
  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .eew-root {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 2147483000;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 12px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 14.5px;
      line-height: 1.5;
      color: #1f95bd;
    }
    @keyframes eew-fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
    @keyframes eew-bounce { 0%, 100% { opacity: .3; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-3px); } }

    .eew-launcher {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      border: none;
      background: #1f95bd;
      color: #ffffff;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.22);
    }
    .eew-launcher:hover { background: #1f95bd; }
    .eew-launcher svg[hidden] { display: none; }

    .eew-panel {
      width: 380px;
      max-width: calc(100vw - 32px);
      height: min(600px, calc(100vh - 140px));
      background: #f4f5f7;
      border: 1px solid #e3e5e9;
      border-radius: 16px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: eew-fade 0.18s ease-out;
    }
    .eew-panel[hidden] { display: none; }

    .eew-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 14px 14px 16px;
      border-bottom: 1px solid #e3e5e9;
      background: #ffffff;
      flex: none;
    }
    .eew-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: #fdf0ea;
      color: #7a1f14;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 14px;
      flex: none;
    }
    .eew-title-wrap { flex: 1; min-width: 0; }
    .eew-title { font-weight: 700; font-size: 15px; line-height: 1.2; }
    .eew-subtitle { font-size: 12px; color: #6b7280; margin-top: 1px; }

    .eew-icon-btn {
      width: 32px;
      height: 32px;
      flex: none;
      border: none;
      background: transparent;
      color: #1f95bd;
      cursor: pointer;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .eew-icon-btn:hover { background: rgba(28, 30, 33, 0.07); }
    .eew-icon-btn.eew-handoff { color: #d84315; }
    .eew-icon-btn.eew-handoff:hover { background: rgba(216, 67, 21, 0.1); }

    .eew-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .eew-row { display: flex; }
    .eew-row[hidden] { display: none; }
    .eew-row-user { justify-content: flex-end; }
    .eew-row-bot { justify-content: flex-start; }
    .eew-bubble-wrap { max-width: 84%; }

    .eew-bubble {
      padding: 10px 14px;
      border-radius: 14px;
      font-size: 14px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .eew-bubble-user { background: #d84315; color: #ffffff; border-bottom-right-radius: 4px; }
    .eew-bubble-bot { background: #ffffff; border: 1px solid #e3e5e9; border-bottom-left-radius: 4px; }
    .eew-bubble-error { background: #fdecea; border: 1px solid #f3c1bb; color: #7a1f14; border-bottom-left-radius: 4px; }
    .eew-bubble code { background: rgba(0,0,0,0.06); padding: 1px 4px; border-radius: 4px; font-size: 0.92em; }
    .eew-bubble sup { font-size: 0.75em; }
    .eew-bubble a { color: inherit; }

    .eew-badge {
      display: inline-block;
      font-size: 10.5px;
      font-weight: 600;
      color: #d84315;
      background: #fdf0ea;
      border: 1px solid #f0d5c4;
      border-radius: 10px;
      padding: 2px 8px;
      margin-bottom: 5px;
    }

    .eew-sources {
      margin-top: 8px;
      padding-top: 6px;
      border-top: 1px solid #e3e5e9;
      font-size: 11.5px;
      color: #6b7280;
    }
    .eew-sources a { color: #d84315; text-decoration: none; }
    .eew-sources a:hover { text-decoration: underline; }

    .eew-typing {
      background: #ffffff;
      border: 1px solid #e3e5e9;
      border-radius: 14px;
      border-bottom-left-radius: 4px;
      padding: 12px 14px;
      display: inline-flex;
      gap: 4px;
      align-items: center;
    }
    .eew-typing[hidden] { display: none; }
    .eew-typing span {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: #6b7280;
      display: inline-block;
      animation: eew-bounce 1s infinite;
    }
    .eew-typing span:nth-child(2) { animation-delay: .15s; }
    .eew-typing span:nth-child(3) { animation-delay: .3s; }

    .eew-quick-replies {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 0 16px 14px;
      flex: none;
    }
    .eew-quick-replies[hidden] { display: none; }
    .eew-chip {
      border: 1px solid #e3e5e9;
      background: transparent;
      color: #1c1e21;
      font-size: 12.5px;
      padding: 6px 12px;
      border-radius: 14px;
      cursor: pointer;
      font-family: inherit;
    }
    .eew-chip:hover { border-color: #d84315; color: #d84315; }

    .eew-composer {
      border-top: 1px solid #e3e5e9;
      background: #ffffff;
      padding: 12px 14px;
      display: flex;
      gap: 8px;
      align-items: center;
      flex: none;
    }
    .eew-input {
      flex: 1;
      min-width: 0;
      height: 38px;
      padding: 0 14px;
      font: inherit;
      font-size: 14px;
      color: #1c1e21;
      background: #f4f5f7;
      border: 1px solid #e3e5e9;
      border-radius: 19px;
      outline: none;
    }
    .eew-input:focus { border-color: #1f95bd; }
    .eew-send-btn {
      width: 38px;
      height: 38px;
      flex: none;
      border: none;
      border-radius: 50%;
      background: #1f95bd;
      color: #ffffff;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .eew-send-btn:hover { background: #1f95bd; }
    .eew-send-btn:disabled { opacity: 0.5; cursor: default; }
  `;

  const ICON_CHAT =
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
  const ICON_CLOSE =
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M18 6 6 18M6 6l12 12"></path></svg>';
  const ICON_CLOSE_SM =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 6 6 18M6 6l12 12"></path></svg>';
  const ICON_HANDOFF =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"></circle><path d="M4 21c0-4 4-7 8-7s8 3 8 7"></path></svg>';
  const ICON_SEND =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M22 2 11 13"></path><path d="M22 2 15 22l-4-9-9-4 20-7Z"></path></svg>';

  const QUICK_REPLIES = [
    "How do I create a waybill?",
    "How do I create an order?",
    "How does the weighbridge integration work?",
    "Talk to support",
  ];

  function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Same small markdown-ish renderer as public/chat.js, for consistency.
  function renderInline(text) {
    let html = escapeHtml(text);
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/`(.+?)`/g, "<code>$1</code>");
    html = html.replace(/\[(\d+)\]/g, "<sup>[$1]</sup>");
    return html;
  }

  function init() {
    const host = document.createElement("div");
    host.id = "eeway-chat-widget";
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = CSS;
    root.appendChild(style);

    root.innerHTML += `
      <div class="eew-root">
        <div class="eew-panel" id="panel" hidden>
          <div class="eew-header">
            <div class="eew-avatar">E</div>
            <div class="eew-title-wrap">
              <div class="eew-title">Eeway Assistant</div>
              <div class="eew-subtitle">Ask about using Eeway</div>
            </div>
            <button type="button" class="eew-icon-btn eew-handoff" id="handoffBtn" title="Contact support">${ICON_HANDOFF}</button>
            <button type="button" class="eew-icon-btn" id="closeBtn" title="Close">${ICON_CLOSE_SM}</button>
          </div>
          <div class="eew-messages" id="messages"></div>
          <div class="eew-quick-replies" id="quickReplies"></div>
          <div class="eew-composer">
            <input class="eew-input" id="input" placeholder="Message Eeway Assistant…" autocomplete="off" />
            <button type="button" class="eew-send-btn" id="sendBtn" title="Send">${ICON_SEND}</button>
          </div>
        </div>
        <button type="button" class="eew-launcher" id="launcher" title="Open support chat">
          <span id="launcherIconOpen">${ICON_CHAT}</span>
          <span id="launcherIconClose" hidden>${ICON_CLOSE}</span>
        </button>
      </div>
    `;

    const panel = root.getElementById("panel");
    const messagesEl = root.getElementById("messages");
    const quickRepliesEl = root.getElementById("quickReplies");
    const inputEl = root.getElementById("input");
    const sendBtn = root.getElementById("sendBtn");
    const launcher = root.getElementById("launcher");
    const launcherIconOpen = root.getElementById("launcherIconOpen");
    const launcherIconClose = root.getElementById("launcherIconClose");
    const closeBtn = root.getElementById("closeBtn");
    const handoffBtn = root.getElementById("handoffBtn");

    const messages = []; // [{role:'user'|'bot', text, html, sources, cached, isError, skipHistory}]
    let isOpen = false;

    quickRepliesEl.innerHTML = QUICK_REPLIES.map(
      (label) => `<button type="button" class="eew-chip">${escapeHtml(label)}</button>`
    ).join("");
    quickRepliesEl.querySelectorAll(".eew-chip").forEach((btn, i) => {
      btn.addEventListener("click", () => {
        const label = QUICK_REPLIES[i];
        if (label === "Talk to support") handoff();
        else send(label);
      });
    });

    function setOpen(next) {
      isOpen = next;
      panel.hidden = !isOpen;
      launcherIconOpen.hidden = isOpen;
      launcherIconClose.hidden = !isOpen;
      launcher.title = isOpen ? "Close support chat" : "Open support chat";
      if (isOpen) inputEl.focus();
    }

    launcher.addEventListener("click", () => setOpen(!isOpen));
    closeBtn.addEventListener("click", () => setOpen(false));
    handoffBtn.addEventListener("click", () => handoff());

    function scrollToBottom() {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function renderMessage(m) {
      const row = document.createElement("div");
      row.className = "eew-row " + (m.role === "user" ? "eew-row-user" : "eew-row-bot");

      const wrap = document.createElement("div");
      wrap.className = "eew-bubble-wrap";

      if (m.cached) {
        const badge = document.createElement("div");
        badge.className = "eew-badge";
        badge.textContent = "⚡ instant answer";
        wrap.appendChild(badge);
      }

      const bubble = document.createElement("div");
      bubble.className =
        "eew-bubble " +
        (m.role === "user" ? "eew-bubble-user" : m.isError ? "eew-bubble-error" : "eew-bubble-bot");
      bubble.innerHTML = m.html != null ? m.html : renderInline(m.text);
      wrap.appendChild(bubble);

      if (m.sources && m.sources.length) {
        const src = document.createElement("div");
        src.className = "eew-sources";
        src.innerHTML =
          "Sources: " +
          m.sources
            .map(
              (s) =>
                `<a href="${s.url}" target="_blank" rel="noopener">[${s.n}] ${escapeHtml(s.title)}</a>`
            )
            .join("&nbsp;&nbsp;");
        wrap.appendChild(src);
      }

      row.appendChild(wrap);
      return row;
    }

    function pushMessage(m) {
      messages.push(m);
      messagesEl.appendChild(renderMessage(m));
      scrollToBottom();
    }

    const typingEl = document.createElement("div");
    typingEl.className = "eew-row eew-row-bot";
    typingEl.hidden = true;
    typingEl.innerHTML = '<div class="eew-typing"><span></span><span></span><span></span></div>';
    messagesEl.appendChild(typingEl);

    function showTyping() {
      typingEl.hidden = false;
      scrollToBottom();
    }
    function hideTyping() {
      typingEl.hidden = true;
    }

    function hideQuickReplies() {
      quickRepliesEl.hidden = true;
    }

    function historyForApi() {
      return messages
        .filter((m) => !m.skipHistory && typeof m.text === "string")
        .map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }));
    }

    function setSending(sending) {
      sendBtn.disabled = sending;
      inputEl.disabled = sending;
    }

    async function send(rawText) {
      const text = (rawText || "").trim();
      if (!text) return;
      hideQuickReplies();
      pushMessage({ role: "user", text });
      inputEl.value = "";
      setSending(true);
      showTyping();

      try {
        const history = historyForApi().slice(0, -1); // exclude the message just sent, matching /api/chat's contract
        const res = await fetch(API_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, history }),
        });
        const data = await res.json();
        hideTyping();

        if (!res.ok) {
          pushMessage({ role: "bot", text: data.error || "Something went wrong.", isError: true });
          return;
        }
        pushMessage({ role: "bot", text: data.answer, sources: data.sources, cached: data.cached });
      } catch (err) {
        hideTyping();
        pushMessage({ role: "bot", text: "Network error — is the server running?", isError: true });
      } finally {
        setSending(false);
        inputEl.focus();
      }
    }

    function handoff() {
      hideQuickReplies();
      pushMessage({ role: "user", text: "Talk to support", skipHistory: true });
      showTyping();
      setTimeout(() => {
        hideTyping();
        pushMessage({
          role: "bot",
          skipHistory: true,
          html:
            "You can reach the Eeway team directly:<br><br>" +
            '<a href="mailto:info@loadmon.com">info@loadmon.com</a><br>' +
            '<a href="tel:+3726461078">+372 646 1078</a><br><br>' +
            'Or see the <a href="https://docs.eeway.eu/getting-started/contacts-support/" target="_blank" rel="noopener">Contacts &amp; Support</a> page.',
        });
      }, 500);
    }

    sendBtn.addEventListener("click", () => send(inputEl.value));
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        send(inputEl.value);
      }
    });

    pushMessage({
      role: "bot",
      text: "Hi, I'm the Eeway Assistant — ask me anything about using Eeway, or pick a question below.",
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
