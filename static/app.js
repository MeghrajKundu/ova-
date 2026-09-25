/**
 * ============================================================================
 * OVA / JARVIS - NEXT-GEN AI STUDIO CORE FRONTEND ENGINE
 * Token Streaming, Canvas Studio, Deep Reasoning, Voice Mode, Memory Vault
 * ============================================================================
 */

(function () {
  'use strict';

  // --- STATE ---
  const state = {
    currentChatId: null,
    chats: [],
    models: [],
    selectedModel: 'openai/gpt-oss-120b',
    reasoningMode: false,
    webSearchMode: 'auto', // 'auto' | true | false
    isStreaming: false,
    abortController: null,
    attachedFiles: [], // [{ filename, content, size }]
    canvas: {
      isOpen: false,
      code: '',
      lang: 'html',
      activeTab: 'preview' // 'preview' | 'code' | 'console'
    },
    voice: {
      isListening: false,
      recognition: null,
      autoTTS: false,
      synth: window.speechSynthesis || null,
      animFrameId: null
    }
  };

  // --- DOM ELEMENTS ---
  const el = {
    // Sidebar
    sidebar: document.getElementById('sidebar'),
    sidebarToggle: document.getElementById('sidebarToggle'),
    newChatBtn: document.getElementById('newChatBtn'),
    chatList: document.getElementById('chatList'),
    chatSearch: document.getElementById('chatSearch'),
    memoryVaultBtn: document.getElementById('memoryVaultBtn'),

    // Top Nav
    modelSelectorBtn: document.getElementById('modelSelectorBtn'),
    modelDropdown: document.getElementById('modelDropdown'),
    currentModelName: document.getElementById('currentModelName'),
    currentModelBadge: document.getElementById('currentModelBadge'),
    reasoningToggleBtn: document.getElementById('reasoningToggleBtn'),
    webSearchToggleBtn: document.getElementById('webSearchToggleBtn'),
    canvasToggleBtn: document.getElementById('canvasToggleBtn'),
    exportChatBtn: document.getElementById('exportChatBtn'),

    // Chat Viewport
    messagesViewport: document.getElementById('messagesViewport'),
    messagesContainer: document.getElementById('messagesContainer'),
    welcomeScreen: document.getElementById('welcomeScreen'),
    dropOverlay: document.getElementById('dropOverlay'),

    // Input Dock
    attachmentTray: document.getElementById('attachmentTray'),
    chatInput: document.getElementById('chatInput'),
    fileInput: document.getElementById('fileInput'),
    uploadBtn: document.getElementById('uploadBtn'),
    micBtn: document.getElementById('micBtn'),
    ttsToggleBtn: document.getElementById('ttsToggleBtn'),
    sendBtn: document.getElementById('sendBtn'),
    soundwaveCanvas: document.getElementById('soundwaveCanvas'),

    // Canvas Studio
    canvasStudio: document.getElementById('canvasStudio'),
    canvasTitle: document.getElementById('canvasTitle'),
    canvasTag: document.getElementById('canvasTag'),
    canvasTabPreview: document.getElementById('canvasTabPreview'),
    canvasTabCode: document.getElementById('canvasTabCode'),
    canvasTabConsole: document.getElementById('canvasTabConsole'),
    canvasPanePreview: document.getElementById('canvasPanePreview'),
    canvasPaneCode: document.getElementById('canvasPaneCode'),
    canvasPaneConsole: document.getElementById('canvasPaneConsole'),
    canvasIframe: document.getElementById('canvasIframe'),
    canvasEditor: document.getElementById('canvasEditor'),
    canvasConsole: document.getElementById('canvasConsole'),
    canvasRunBtn: document.getElementById('canvasRunBtn'),
    canvasCopyBtn: document.getElementById('canvasCopyBtn'),
    canvasDownloadBtn: document.getElementById('canvasDownloadBtn'),
    canvasCloseBtn: document.getElementById('canvasCloseBtn'),

    // Memory Vault Modal
    memoryModal: document.getElementById('memoryModal'),
    memoryModalClose: document.getElementById('memoryModalClose'),
    memoryInput: document.getElementById('memoryInput'),
    addMemoryBtn: document.getElementById('addMemoryBtn'),
    memoryList: document.getElementById('memoryList'),
    clearMemoriesBtn: document.getElementById('clearMemoriesBtn')
  };

  // --- INITIALIZATION ---
  async function init() {
    setupMarkdown();
    setupEventListeners();
    setupSpeechRecognition();
    setupDragAndDrop();
    await loadModels();
    await loadChats();
  }

  // --- MARKDOWN & HIGHLIGHT CONFIGURATION ---
  function setupMarkdown() {
    if (window.marked) {
      marked.setOptions({
        gfm: true,
        breaks: true,
        highlight: function (code, lang) {
          if (window.hljs && lang && hljs.getLanguage(lang)) {
            try {
              return hljs.highlight(code, { language: lang }).value;
            } catch (e) {
              console.error(e);
            }
          }
          return code;
        }
      });
    }
  }

  // --- MODELS API ---
  async function loadModels() {
    try {
      const res = await fetch('/api/models');
      const data = await res.json();
      state.models = data.models || [];
      renderModelDropdown();
    } catch (e) {
      console.warn('Using default model configuration');
    }
  }

  function renderModelDropdown() {
    el.modelDropdown.innerHTML = '';
    state.models.forEach(m => {
      const opt = document.createElement('div');
      opt.className = `model-option ${m.id === state.selectedModel ? 'active' : ''}`;
      opt.innerHTML = `
        <div class="model-option-top">
          <span class="model-option-name">${m.name}</span>
          <span class="model-badge">${m.tag}</span>
        </div>
        <div class="model-option-desc">${m.desc}</div>
      `;
      opt.addEventListener('click', () => {
        selectModel(m.id);
        el.modelDropdown.classList.remove('open');
      });
      el.modelDropdown.appendChild(opt);
    });
  }

  function selectModel(modelId) {
    state.selectedModel = modelId;
    const model = state.models.find(m => m.id === modelId);
    if (model) {
      el.currentModelName.textContent = model.name;
      el.currentModelBadge.textContent = model.tag;
    }
    renderModelDropdown();
  }

  // --- CHAT MANAGEMENT ---
  async function loadChats() {
    try {
      const res = await fetch('/api/chats');
      const data = await res.json();
      state.chats = data.chats || [];
      renderChatList();
      if (state.chats.length > 0 && !state.currentChatId) {
        selectChat(state.chats[0].id);
      } else if (!state.currentChatId) {
        showWelcomeScreen();
      }
    } catch (e) {
      console.error('Error loading chats:', e);
    }
  }

  function renderChatList(filter = '') {
    el.chatList.innerHTML = '';
    const filtered = state.chats.filter(c =>
      c.title.toLowerCase().includes(filter.toLowerCase())
    );

    filtered.forEach(chat => {
      const item = document.createElement('div');
      item.className = `chat-item ${chat.id === state.currentChatId ? 'active' : ''}`;
      item.innerHTML = `
        <div class="chat-item-title" title="${escapeHtml(chat.title)}">
          <i class="fa-regular fa-message"></i>
          <span>${escapeHtml(chat.title)}</span>
        </div>
        <div class="chat-item-actions">
          <button class="chat-btn-icon" data-action="rename" title="Rename"><i class="fa-solid fa-pen"></i></button>
          <button class="chat-btn-icon delete" data-action="delete" title="Delete"><i class="fa-solid fa-trash"></i></button>
        </div>
      `;

      item.addEventListener('click', (e) => {
        if (e.target.closest('[data-action]')) return;
        selectChat(chat.id);
      });

      const renameBtn = item.querySelector('[data-action="rename"]');
      renameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        renameChat(chat.id, chat.title);
      });

      const deleteBtn = item.querySelector('[data-action="delete"]');
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteChat(chat.id);
      });

      el.chatList.appendChild(item);
    });
  }

  async function selectChat(chatId) {
    if (state.isStreaming) stopStreaming();
    state.currentChatId = chatId;
    renderChatList(el.chatSearch.value);
    el.welcomeScreen.style.display = 'none';

    try {
      const res = await fetch(`/api/chats/${chatId}/messages`);
      const data = await res.json();
      renderChatMessages(data.messages || []);
    } catch (e) {
      console.error('Failed to load chat messages:', e);
    }
  }

  async function createNewChat() {
    if (state.isStreaming) stopStreaming();
    try {
      const res = await fetch('/api/chats', { method: 'POST' });
      const data = await res.json();
      if (data.chat_id) {
        state.currentChatId = data.chat_id;
        state.chats.unshift({
          id: data.chat_id,
          title: 'New Chat',
          created_at: new Date().toISOString()
        });
        renderChatList();
        renderChatMessages([]);
        showWelcomeScreen();
      }
    } catch (e) {
      console.error('Failed to create new chat:', e);
    }
  }

  async function deleteChat(chatId) {
    if (!confirm('Are you sure you want to delete this chat?')) return;
    try {
      await fetch(`/api/chats/${chatId}`, { method: 'DELETE' });
      state.chats = state.chats.filter(c => c.id !== chatId);
      if (state.currentChatId === chatId) {
        state.currentChatId = null;
        if (state.chats.length > 0) {
          selectChat(state.chats[0].id);
        } else {
          renderChatMessages([]);
          showWelcomeScreen();
        }
      }
      renderChatList();
    } catch (e) {
      console.error('Failed to delete chat:', e);
    }
  }

  async function renameChat(chatId, oldTitle) {
    const newTitle = prompt('Enter new conversation title:', oldTitle);
    if (!newTitle || newTitle.trim() === '' || newTitle === oldTitle) return;
    try {
      const res = await fetch(`/api/chats/${chatId}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle.trim() })
      });
      const data = await res.json();
      if (data.success) {
        const c = state.chats.find(x => x.id === chatId);
        if (c) c.title = newTitle.trim();
        renderChatList();
      }
    } catch (e) {
      console.error('Failed to rename chat:', e);
    }
  }

  function showWelcomeScreen() {
    el.messagesContainer.innerHTML = '';
    el.welcomeScreen.style.display = 'flex';
  }

  // --- MESSAGE RENDERING ---
  function renderChatMessages(messages) {
    el.messagesContainer.innerHTML = '';
    if (messages.length === 0) {
      showWelcomeScreen();
      return;
    }
    el.welcomeScreen.style.display = 'none';
    messages.forEach(msg => {
      appendMessage(msg.role, msg.content, false);
    });
    scrollToBottom();
  }

  function appendMessage(role, content, isStreaming = false) {
    el.welcomeScreen.style.display = 'none';

    const row = document.createElement('div');
    row.className = `message-row ${role}`;

    const isUser = role === 'user';
    const avatarIcon = isUser ? '<i class="fa-solid fa-user"></i>' : '<i class="fa-solid fa-bolt"></i>';
    const speakerName = isUser ? 'You' : 'OVA';

    row.innerHTML = `
      <div class="message-avatar ${isStreaming ? 'streaming' : ''}">${avatarIcon}</div>
      <div class="message-content">
        <div class="message-header">
          <span class="message-speaker">${speakerName}</span>
          <div class="message-tools">
            <button class="btn-msg-tool" title="Copy Text" data-tool="copy"><i class="fa-regular fa-copy"></i></button>
            ${!isUser ? '<button class="btn-msg-tool" title="Read Aloud" data-tool="speak"><i class="fa-solid fa-volume-high"></i></button>' : ''}
          </div>
        </div>
        <div class="message-body"></div>
      </div>
    `;

    const bodyEl = row.querySelector('.message-body');

    // Attach tool listeners
    row.querySelector('[data-tool="copy"]').addEventListener('click', () => {
      navigator.clipboard.writeText(content);
      showToast('Copied to clipboard!');
    });

    if (!isUser) {
      const speakBtn = row.querySelector('[data-tool="speak"]');
      if (speakBtn) {
        speakBtn.addEventListener('click', () => speakText(bodyEl.innerText));
      }
    }

    el.messagesContainer.appendChild(row);

    if (isUser) {
      bodyEl.textContent = content;
    } else {
      renderAssistantContent(bodyEl, content);
    }

    scrollToBottom();
    return { row, bodyEl };
  }

  // --- RICH CONTENT RENDERER (Markdown, Math, Mermaid, Thinking, Canvas) ---
  function renderAssistantContent(container, rawText) {
    container.innerHTML = '';

    // Check for <think>...</think> reasoning blocks
    let cleanText = rawText;
    const thinkRegex = /<think>([\s\S]*?)(?:<\/think>|$)/i;
    const match = rawText.match(thinkRegex);

    if (match) {
      const thoughtContent = match[1].trim();
      if (thoughtContent) {
        const accordion = document.createElement('div');
        accordion.className = 'thinking-accordion open';
        accordion.innerHTML = `
          <div class="thinking-header">
            <div class="thinking-title">
              <i class="fa-solid fa-brain"></i>
              <span>Thought Process</span>
            </div>
            <i class="fa-solid fa-chevron-down thinking-chevron"></i>
          </div>
          <div class="thinking-body">${escapeHtml(thoughtContent)}</div>
        `;
        accordion.querySelector('.thinking-header').addEventListener('click', () => {
          accordion.classList.toggle('open');
        });
        container.appendChild(accordion);
      }
      cleanText = rawText.replace(thinkRegex, '').trim();
    }

    // Markdown parse
    const markdownWrapper = document.createElement('div');
    markdownWrapper.className = 'markdown-rendered';
    if (window.marked) {
      markdownWrapper.innerHTML = marked.parse(cleanText);
    } else {
      markdownWrapper.textContent = cleanText;
    }

    // KaTeX Math Rendering
    if (window.renderMathInElement) {
      try {
        renderMathInElement(markdownWrapper, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false },
            { left: '\\[', right: '\\]', display: true },
            { left: '\\(', right: '\\)', display: false }
          ],
          throwOnError: false
        });
      } catch (e) {
        console.warn('Math rendering error:', e);
      }
    }

    // Code Blocks Enhancement (Header, Run, Open in Canvas)
    enhanceCodeBlocks(markdownWrapper);

    container.appendChild(markdownWrapper);
  }

  function enhanceCodeBlocks(parent) {
    const pres = parent.querySelectorAll('pre');
    pres.forEach(pre => {
      const code = pre.querySelector('code');
      if (!code) return;

      const fullCodeText = code.innerText;
      let lang = 'code';
      code.classList.forEach(cls => {
        if (cls.startsWith('language-')) {
          lang = cls.replace('language-', '').toLowerCase();
        }
      });

      const wrapper = document.createElement('div');
      wrapper.className = 'code-block-wrapper';

      const header = document.createElement('div');
      header.className = 'code-header';
      header.innerHTML = `
        <span class="code-lang">${lang}</span>
        <div class="code-actions">
          ${isExecutablePython(lang) ? '<button class="btn-code-action run-btn" data-action="run"><i class="fa-solid fa-play"></i> Run</button>' : ''}
          ${isCanvasPreviewable(lang) ? '<button class="btn-code-action" data-action="canvas"><i class="fa-solid fa-laptop-code"></i> Canvas Studio</button>' : ''}
          <button class="btn-code-action" data-action="copy"><i class="fa-regular fa-copy"></i> Copy</button>
        </div>
      `;

      // Copy Action
      header.querySelector('[data-action="copy"]').addEventListener('click', (e) => {
        navigator.clipboard.writeText(fullCodeText);
        e.target.closest('button').innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
        setTimeout(() => {
          e.target.closest('button').innerHTML = '<i class="fa-regular fa-copy"></i> Copy';
        }, 2000);
      });

      // Canvas Studio Action (HTML, SVG, JS, CSS)
      const canvasBtn = header.querySelector('[data-action="canvas"]');
      if (canvasBtn) {
        canvasBtn.addEventListener('click', () => {
          openInCanvas(fullCodeText, lang);
        });
      }

      // Python Run Action
      const runBtn = header.querySelector('[data-action="run"]');
      if (runBtn) {
        runBtn.addEventListener('click', () => {
          runPythonCode(fullCodeText);
        });
      }

      pre.parentNode.insertBefore(wrapper, pre);
      wrapper.appendChild(header);
      wrapper.appendChild(pre);

      // Syntax highlight if not already highlighted
      if (window.hljs) {
        hljs.highlightElement(code);
      }
    });
  }

  function isCanvasPreviewable(lang) {
    return ['html', 'javascript', 'js', 'svg', 'css'].includes(lang);
  }

  function isExecutablePython(lang) {
    return ['python', 'py'].includes(lang);
  }

  // --- STREAMING CHAT (SSE) ---
  async function sendMessage() {
    const text = el.chatInput.value.trim();
    if ((!text && state.attachedFiles.length === 0) || state.isStreaming) return;

    // Combine attachments with prompt
    let fullPrompt = text;
    if (state.attachedFiles.length > 0) {
      const fileHeader = state.attachedFiles.map(f =>
        `[ATTACHED FILE: ${f.filename}]\n${f.content}\n[END OF FILE]`
      ).join('\n\n');
      fullPrompt = fileHeader + (text ? `\n\nUser Question:\n${text}` : '\n\nPlease analyze the attached file(s).');
    }

    // Clear input & reset attachment tray
    el.chatInput.value = '';
    el.chatInput.style.height = 'auto';
    clearAttachments();

    // Append User Message to UI
    appendMessage('user', text || '(Attached File Analysis)');

    // Start streaming UI
    state.isStreaming = true;
    updateSendBtnState();

    // Create Assistant Placeholder
    const { row: assistantRow, bodyEl: assistantBody } = appendMessage('assistant', '', true);

    state.abortController = new AbortController();
    let accumulatedText = '';
    let sourcesList = [];

    try {
      const response = await fetch('/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: state.currentChatId,
          message: fullPrompt,
          model: state.selectedModel,
          reasoning_mode: state.reasoningMode,
          web_search: state.webSearchMode === 'auto' ? null : state.webSearchMode
        }),
        signal: state.abortController.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop(); // Keep partial line in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const jsonStr = trimmed.substring(6);

          try {
            const data = JSON.parse(jsonStr);

            if (data.type === 'init') {
              if (data.chat_id && !state.currentChatId) {
                state.currentChatId = data.chat_id;
              }
              if (data.memory_notice) {
                showToast(`🧠 ${data.memory_notice}`);
              }
            } else if (data.type === 'sources') {
              sourcesList = data.sources || [];
              renderSourcesCard(assistantBody, sourcesList);
            } else if (data.type === 'chunk') {
              accumulatedText += data.content;
              renderAssistantContent(assistantBody, accumulatedText);
              scrollToBottom();
            } else if (data.type === 'done') {
              if (data.title) {
                const c = state.chats.find(x => x.id === state.currentChatId);
                if (c) c.title = data.title;
                renderChatList();
              }
            } else if (data.type === 'error') {
              accumulatedText += `\n\n⚠️ **Error:** ${data.error}`;
              renderAssistantContent(assistantBody, accumulatedText);
            }
          } catch (err) {
            console.error('Error parsing SSE event:', err, jsonStr);
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        accumulatedText += '\n\n*(Generation stopped by user)*';
      } else {
        accumulatedText += `\n\n⚠️ **Connection failed:** ${err.message}`;
      }
      renderAssistantContent(assistantBody, accumulatedText);
    } finally {
      state.isStreaming = false;
      const avatar = assistantRow.querySelector('.message-avatar');
      if (avatar) avatar.classList.remove('streaming');
      updateSendBtnState();
      scrollToBottom();

      // Auto TTS if enabled
      if (state.voice.autoTTS && accumulatedText) {
        const cleanToSpeak = accumulatedText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        speakText(cleanToSpeak);
      }
    }
  }

  function stopStreaming() {
    if (state.abortController) {
      state.abortController.abort();
      state.abortController = null;
    }
    state.isStreaming = false;
    updateSendBtnState();
  }

  function updateSendBtnState() {
    if (state.isStreaming) {
      el.sendBtn.classList.add('stop-mode');
      el.sendBtn.innerHTML = '<i class="fa-solid fa-stop"></i>';
      el.sendBtn.title = 'Stop Generating';
    } else {
      el.sendBtn.classList.remove('stop-mode');
      el.sendBtn.innerHTML = '<i class="fa-solid fa-arrow-up"></i>';
      el.sendBtn.title = 'Send Message';
    }
  }

  function renderSourcesCard(container, sources) {
    if (!sources || sources.length === 0) return;
    let card = container.querySelector('.sources-card');
    if (!card) {
      card = document.createElement('div');
      card.className = 'sources-card';
      container.insertBefore(card, container.firstChild);
    }
    card.innerHTML = `
      <div class="sources-header">
        <i class="fa-solid fa-globe"></i>
        <span>${sources.length} Live Web Sources Verified</span>
      </div>
      <div class="sources-list">
        ${sources.map(s => `
          <a href="${s.url}" target="_blank" rel="noopener noreferrer" class="source-chip" title="${escapeHtml(s.title)}">
            <img src="https://www.google.com/s2/favicons?domain=${new URL(s.url).hostname}&sz=32" alt="" onerror="this.style.display='none'">
            <span class="source-title">${escapeHtml(s.title || new URL(s.url).hostname)}</span>
          </a>
        `).join('')}
      </div>
    `;
  }

  // --- CANVAS STUDIO (ARTIFACTS & PYTHON RUNNER) ---
  function openInCanvas(code, lang = 'html') {
    state.canvas.isOpen = true;
    state.canvas.code = code;
    state.canvas.lang = lang;
    el.canvasStudio.classList.add('open');
    el.canvasToggleBtn.classList.add('active');

    el.canvasTitle.textContent = lang.toUpperCase() + ' Studio';
    el.canvasTag.textContent = lang.toUpperCase();
    el.canvasEditor.value = code;

    if (isCanvasPreviewable(lang)) {
      switchCanvasTab('preview');
      renderCanvasIframe(code, lang);
    } else {
      switchCanvasTab('code');
    }
  }

  function closeCanvas() {
    state.canvas.isOpen = false;
    el.canvasStudio.classList.remove('open');
    el.canvasToggleBtn.classList.remove('active');
  }

  function switchCanvasTab(tab) {
    state.canvas.activeTab = tab;
    [el.canvasTabPreview, el.canvasTabCode, el.canvasTabConsole].forEach(t => t.classList.remove('active'));
    [el.canvasPanePreview, el.canvasPaneCode, el.canvasPaneConsole].forEach(p => p.classList.remove('active'));

    if (tab === 'preview') {
      el.canvasTabPreview.classList.add('active');
      el.canvasPanePreview.classList.add('active');
    } else if (tab === 'code') {
      el.canvasTabCode.classList.add('active');
      el.canvasPaneCode.classList.add('active');
    } else if (tab === 'console') {
      el.canvasTabConsole.classList.add('active');
      el.canvasPaneConsole.classList.add('active');
    }
  }

  function renderCanvasIframe(code, lang) {
    let htmlContent = code;
    if (lang === 'svg') {
      htmlContent = `<!DOCTYPE html><html><body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#0d1117;">${code}</body></html>`;
    } else if (lang === 'javascript' || lang === 'js') {
      htmlContent = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:sans-serif;padding:20px;color:#222;}</style></head><body><h3>JavaScript Output:</h3><div id="output"></div><script>try { ${code} } catch(e) { document.getElementById('output').innerHTML = '<pre style="color:red">'+e.stack+'</pre>'; }<\/script></body></html>`;
    } else if (lang === 'css') {
      htmlContent = `<!DOCTYPE html><html><head><style>${code}</style></head><body><h1>CSS Preview</h1><p>Sample paragraph styled with CSS.</p><button>Sample Button</button></body></html>`;
    }

    // Use srcdoc for reliable sandboxed rendering (no cross-origin issues)
    const iframe = el.canvasIframe;
    iframe.srcdoc = htmlContent;
  }

  async function runPythonCode(codeToRun) {
    const code = codeToRun || el.canvasEditor.value;
    openInCanvas(code, 'python');
    switchCanvasTab('console');

    const entry = document.createElement('div');
    entry.className = 'console-entry';
    entry.innerHTML = `
      <span class="console-badge stdout">Executing Python...</span>
      <div class="console-content" style="color: #94a3b8;">Running script in isolated environment...</div>
    `;
    el.canvasConsole.appendChild(entry);
    el.canvasConsole.scrollTop = el.canvasConsole.scrollHeight;

    try {
      const res = await fetch('/api/run-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      });
      const data = await res.json();

      entry.innerHTML = '';
      if (data.stdout) {
        entry.innerHTML += `
          <span class="console-badge stdout">stdout (Exit Code ${data.exit_code})</span>
          <div class="console-content">${escapeHtml(data.stdout)}</div>
        `;
      }
      if (data.stderr) {
        entry.innerHTML += `
          <span class="console-badge stderr">stderr</span>
          <div class="console-content" style="color:#f87171;">${escapeHtml(data.stderr)}</div>
        `;
      }
      if (!data.stdout && !data.stderr) {
        entry.innerHTML = `
          <span class="console-badge stdout">Process Finished (Exit Code 0)</span>
          <div class="console-content">Execution completed with no standard output.</div>
        `;
      }
    } catch (e) {
      entry.innerHTML = `
        <span class="console-badge stderr">Error</span>
        <div class="console-content" style="color:#f87171;">Failed to connect to Python runner: ${e.message}</div>
      `;
    }
    el.canvasConsole.scrollTop = el.canvasConsole.scrollHeight;
  }

  // --- FILE ATTACHMENTS & DRAG/DROP ---
  function setupDragAndDrop() {
    window.addEventListener('dragenter', (e) => {
      e.preventDefault();
      el.dropOverlay.classList.add('active');
    });

    el.dropOverlay.addEventListener('dragleave', (e) => {
      e.preventDefault();
      el.dropOverlay.classList.remove('active');
    });

    el.dropOverlay.addEventListener('dragover', (e) => {
      e.preventDefault();
    });

    el.dropOverlay.addEventListener('drop', (e) => {
      e.preventDefault();
      el.dropOverlay.classList.remove('active');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFileUpload(e.dataTransfer.files[0]);
      }
    });
  }

  async function handleFileUpload(file) {
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);

    showToast(`Uploading and reading ${file.name}...`);
    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();

      if (data.success) {
        state.attachedFiles.push({
          filename: data.filename,
          content: data.content,
          size: data.char_count
        });
        renderAttachmentTray();
        showToast(`Parsed ${data.filename} (${Math.round(data.char_count / 1000)}k chars)`);
      } else {
        alert(data.error || 'Failed to parse file.');
      }
    } catch (e) {
      alert('Upload failed: ' + e.message);
    }
  }

  function renderAttachmentTray() {
    if (state.attachedFiles.length === 0) {
      el.attachmentTray.classList.remove('active');
      el.attachmentTray.innerHTML = '';
      return;
    }
    el.attachmentTray.classList.add('active');
    el.attachmentTray.innerHTML = '';
    state.attachedFiles.forEach((file, index) => {
      const chip = document.createElement('div');
      chip.className = 'attachment-chip';
      chip.innerHTML = `
        <i class="fa-regular fa-file-lines"></i>
        <span>${escapeHtml(file.filename)}</span>
        <i class="fa-solid fa-xmark attachment-remove" data-index="${index}"></i>
      `;
      chip.querySelector('.attachment-remove').addEventListener('click', () => {
        state.attachedFiles.splice(index, 1);
        renderAttachmentTray();
      });
      el.attachmentTray.appendChild(chip);
    });
  }

  function clearAttachments() {
    state.attachedFiles = [];
    renderAttachmentTray();
  }

  // --- SPEECH RECOGNITION & TTS AUDIO VISUALIZER ---
  function setupSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      // Keep mic visible but disable and add a tooltip indicating HTTPS needed
      el.micBtn.title = 'Voice input requires Chrome or Edge browser';
      el.micBtn.style.opacity = '0.45';
      el.micBtn.style.cursor = 'not-allowed';
      el.micBtn.addEventListener('click', (e) => {
        e.stopImmediatePropagation();
        showToast('🎤 Voice requires Chrome or Edge browser');
      });
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;        // Keep listening across pauses
    recognition.interimResults = true;    // Show live transcription
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;
    state.voice.recognition = recognition;

    let finalTranscript = '';
    let silenceTimer = null;

    recognition.onstart = () => {
      state.voice.isListening = true;
      finalTranscript = '';
      el.micBtn.classList.add('listening');
      el.micBtn.innerHTML = '<i class="fa-solid fa-stop"></i>';
      el.micBtn.title = 'Stop recording';
      startSoundwaveAnimation();
      showToast('🎤 Listening... speak now');
    };

    recognition.onresult = (event) => {
      let interim = '';
      finalTranscript = '';
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      // Show live transcript in input
      el.chatInput.value = (finalTranscript + interim).trim();
      autoResizeInput();

      // Auto-stop after 1.5s of silence after final result
      if (finalTranscript) {
        clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => {
          recognition.stop();
        }, 1500);
      }
    };

    recognition.onerror = (event) => {
      clearTimeout(silenceTimer);
      if (event.error === 'aborted') return; // Intentional stop, ignore
      const errorMessages = {
        'no-speech':           '🎤 No speech detected — try again',
        'audio-capture':       '🎤 Microphone not accessible',
        'not-allowed':         '🎤 Microphone permission denied — allow it in browser settings',
        'network':             '🎤 Network error during recognition',
        'service-not-allowed': '🎤 Speech service not allowed on this page',
      };
      showToast(errorMessages[event.error] || `🎤 Error: ${event.error}`);
      stopListening();
    };

    recognition.onend = () => {
      clearTimeout(silenceTimer);
      stopListening();
      // Auto-send if we captured text
      if (finalTranscript.trim() && !state.isStreaming) {
        setTimeout(() => sendMessage(), 200);
      }
    };
  }

  function toggleSpeechRecognition() {
    if (!state.voice.recognition) {
      showToast('🎤 Voice requires Chrome or Edge browser');
      return;
    }
    if (state.voice.isListening) {
      state.voice.recognition.stop();
    } else {
      el.chatInput.value = '';
      try {
        state.voice.recognition.start();
      } catch (e) {
        // Recognition already started — stop and restart
        state.voice.recognition.stop();
        setTimeout(() => state.voice.recognition.start(), 300);
      }
    }
  }

  function stopListening() {
    state.voice.isListening = false;
    el.micBtn.classList.remove('listening');
    el.micBtn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
    el.micBtn.title = 'Iron Man Voice Mode (Dictate)';
    stopSoundwaveAnimation();
  }

  function speakText(text) {
    if (!state.voice.synth) return;
    state.voice.synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    utterance.pitch = 1.0;

    utterance.onstart = () => {
      startSoundwaveAnimation();
    };

    utterance.onend = () => {
      stopSoundwaveAnimation();
    };

    utterance.onerror = () => {
      stopSoundwaveAnimation();
    };

    state.voice.synth.speak(utterance);
  }

  function startSoundwaveAnimation() {
    el.soundwaveCanvas.classList.add('active');
    const canvas = el.soundwaveCanvas;
    const ctx = canvas.getContext('2d');
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = 4;

    let offset = 0;
    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#00f0ff';
      offset += 0.15;

      const numBars = 40;
      const barWidth = canvas.width / numBars;
      for (let i = 0; i < numBars; i++) {
        const height = (Math.sin(offset + i * 0.4) + 1) * 2;
        ctx.fillRect(i * barWidth, 4 - height, barWidth - 2, height);
      }
      state.voice.animFrameId = requestAnimationFrame(draw);
    }
    draw();
  }

  function stopSoundwaveAnimation() {
    if (state.voice.animFrameId) {
      cancelAnimationFrame(state.voice.animFrameId);
      state.voice.animFrameId = null;
    }
    el.soundwaveCanvas.classList.remove('active');
  }

  // --- MEMORY VAULT MODAL ---
  async function openMemoryModal() {
    el.memoryModal.classList.add('open');
    await loadMemories();
  }

  function closeMemoryModal() {
    el.memoryModal.classList.remove('open');
  }

  async function loadMemories() {
    try {
      const res = await fetch('/api/memories');
      const data = await res.json();
      renderMemoryList(data.memories || []);
    } catch (e) {
      console.error('Failed to load memories:', e);
    }
  }

  function renderMemoryList(memories) {
    el.memoryList.innerHTML = '';
    if (memories.length === 0) {
      el.memoryList.innerHTML = '<div style="color:var(--text-dim);font-size:0.84rem;text-align:center;padding:16px;">No saved memories in your vault yet. Tell OVA "remember that..." or add one above!</div>';
      return;
    }

    memories.forEach(mem => {
      const item = document.createElement('div');
      item.className = 'memory-item';
      item.innerHTML = `
        <div class="memory-text">${escapeHtml(mem.content)}</div>
        <button class="memory-delete" data-id="${mem.id}" title="Forget this memory"><i class="fa-solid fa-trash"></i></button>
      `;
      item.querySelector('.memory-delete').addEventListener('click', async () => {
        await deleteMemory(mem.id);
      });
      el.memoryList.appendChild(item);
    });
  }

  async function addCustomMemory() {
    const val = el.memoryInput.value.trim();
    if (!val) return;
    try {
      const res = await fetch('/api/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: val })
      });
      const data = await res.json();
      if (data.success) {
        el.memoryInput.value = '';
        await loadMemories();
        showToast('Memory saved to persistent vault.');
      }
    } catch (e) {
      alert('Failed to save memory: ' + e.message);
    }
  }

  async function deleteMemory(id) {
    try {
      await fetch(`/api/memories/${id}`, { method: 'DELETE' });
      await loadMemories();
      showToast('Memory forgotten.');
    } catch (e) {
      console.error(e);
    }
  }

  async function clearAllMemories() {
    if (!confirm('Are you sure you want to delete ALL stored memories? This cannot be undone.')) return;
    try {
      await fetch('/api/memories', { method: 'DELETE' });
      await loadMemories();
      showToast('All memories cleared.');
    } catch (e) {
      console.error(e);
    }
  }

  // --- EVENT LISTENERS SETUP ---
  function setupEventListeners() {
    // Sidebar toggle
    el.sidebarToggle.addEventListener('click', () => {
      el.sidebar.classList.toggle('collapsed');
    });

    // New chat button
    el.newChatBtn.addEventListener('click', createNewChat);

    // Chat search filter
    el.chatSearch.addEventListener('input', (e) => {
      renderChatList(e.target.value);
    });

    // Model dropdown toggle
    el.modelSelectorBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      el.modelDropdown.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
      if (!el.modelSelectorBtn.contains(e.target) && !el.modelDropdown.contains(e.target)) {
        el.modelDropdown.classList.remove('open');
      }
    });

    // Reasoning Mode Toggle
    el.reasoningToggleBtn.addEventListener('click', () => {
      state.reasoningMode = !state.reasoningMode;
      el.reasoningToggleBtn.classList.toggle('active', state.reasoningMode);
      showToast(`Deep Reasoning Mode: ${state.reasoningMode ? 'ON' : 'OFF'}`);
    });

    // Web Search Toggle
    el.webSearchToggleBtn.addEventListener('click', () => {
      if (state.webSearchMode === 'auto') {
        state.webSearchMode = true;
        el.webSearchToggleBtn.classList.add('web-active');
        el.webSearchToggleBtn.innerHTML = '<i class="fa-solid fa-globe"></i> Live Web (Always)';
      } else if (state.webSearchMode === true) {
        state.webSearchMode = false;
        el.webSearchToggleBtn.classList.remove('web-active');
        el.webSearchToggleBtn.innerHTML = '<i class="fa-solid fa-globe"></i> Live Web (Off)';
      } else {
        state.webSearchMode = 'auto';
        el.webSearchToggleBtn.classList.remove('web-active');
        el.webSearchToggleBtn.innerHTML = '<i class="fa-solid fa-globe"></i> Live Web (Auto)';
      }
    });

    // Canvas Studio Toggle
    el.canvasToggleBtn.addEventListener('click', () => {
      if (state.canvas.isOpen) {
        closeCanvas();
      } else {
        openInCanvas(el.canvasEditor.value || '<!-- Write or paste HTML/JS here -->', state.canvas.lang);
      }
    });

    // Export Chat
    el.exportChatBtn.addEventListener('click', () => {
      if (!state.currentChatId) return;
      window.open(`/api/chats/${state.currentChatId}/export?format=markdown`, '_blank');
    });

    // Chat Textarea input & keyboard shortcuts
    el.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    el.chatInput.addEventListener('input', autoResizeInput);

    // Send / Stop button
    el.sendBtn.addEventListener('click', () => {
      if (state.isStreaming) {
        stopStreaming();
      } else {
        sendMessage();
      }
    });

    // File upload
    el.uploadBtn.addEventListener('click', () => el.fileInput.click());
    el.fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        handleFileUpload(e.target.files[0]);
      }
    });

    // Microphone button
    el.micBtn.addEventListener('click', toggleSpeechRecognition);

    // TTS Toggle
    el.ttsToggleBtn.addEventListener('click', () => {
      state.voice.autoTTS = !state.voice.autoTTS;
      el.ttsToggleBtn.classList.toggle('active', state.voice.autoTTS);
      showToast(`Auto Voice Readback: ${state.voice.autoTTS ? 'ON' : 'OFF'}`);
    });

    // Canvas Studio Tabs & Controls
    el.canvasTabPreview.addEventListener('click', () => switchCanvasTab('preview'));
    el.canvasTabCode.addEventListener('click', () => switchCanvasTab('code'));
    el.canvasTabConsole.addEventListener('click', () => switchCanvasTab('console'));
    el.canvasCloseBtn.addEventListener('click', closeCanvas);

    el.canvasRunBtn.addEventListener('click', () => {
      if (state.canvas.lang === 'python') {
        runPythonCode(el.canvasEditor.value);
      } else {
        renderCanvasIframe(el.canvasEditor.value, state.canvas.lang);
        switchCanvasTab('preview');
      }
    });

    el.canvasCopyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(el.canvasEditor.value);
      showToast('Canvas code copied to clipboard!');
    });

    el.canvasDownloadBtn.addEventListener('click', () => {
      const ext = state.canvas.lang === 'python' ? '.py' : state.canvas.lang === 'svg' ? '.svg' : '.html';
      const blob = new Blob([el.canvasEditor.value], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `artifact_${Date.now()}${ext}`;
      a.click();
    });

    // Memory Vault
    el.memoryVaultBtn.addEventListener('click', openMemoryModal);
    el.memoryModalClose.addEventListener('click', closeMemoryModal);
    el.addMemoryBtn.addEventListener('click', addCustomMemory);
    el.memoryInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addCustomMemory();
    });
    el.clearMemoriesBtn.addEventListener('click', clearAllMemories);

    // Suggestion Cards on Welcome Screen
    document.querySelectorAll('.suggestion-card').forEach(card => {
      card.addEventListener('click', () => {
        const promptText = card.getAttribute('data-prompt');
        if (promptText) {
          el.chatInput.value = promptText;
          sendMessage();
        }
      });
    });
  }

  // --- UTILITIES ---
  function autoResizeInput() {
    el.chatInput.style.height = 'auto';
    el.chatInput.style.height = Math.min(el.chatInput.scrollHeight, 180) + 'px';
  }

  function scrollToBottom() {
    el.messagesViewport.scrollTop = el.messagesViewport.scrollHeight;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function showToast(msg) {
    let toast = document.getElementById('appToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'appToast';
      toast.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:rgba(16,22,36,0.92);border:1px solid var(--border-cyan);color:#ffffff;padding:8px 18px;border-radius:999px;font-size:0.82rem;font-weight:500;box-shadow:var(--shadow-lg);z-index:9999;backdrop-filter:blur(12px);transition:all 0.3s ease;opacity:0;pointer-events:none;';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(10px)';
    }, 2800);
  }

  // Boot on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
