document.addEventListener('DOMContentLoaded', () => {
    // --- Element Getters ---
    const textContent = document.getElementById('textContent');
    const saveButton = document.getElementById('saveButton');
    const updateButton = document.getElementById('updateButton');
    const newNoteButton = document.getElementById('newNoteButton'); //  
    const createNewNoteFromViewButton = document.getElementById('createNewNoteFromViewButton');
    const editThisNoteButton = document.getElementById('editThisNoteButton');
    const createNewFromInfoButton = document.getElementById('createNewFromInfoButton');
    const viewNoteFromInfoButton = document.getElementById('viewNoteFromInfoButton');
    
    

    const topAdBanner = document.getElementById('top-ad-banner');
    const bottomAdBanner = document.getElementById('bottom-ad-banner');


    const editorArea = document.getElementById('editor-area');
    const infoArea = document.getElementById('info-area');
    const viewArea = document.getElementById('view-area');

    const messageDisplay = document.getElementById('message');
    const viewLinkDisplay = document.getElementById('viewLink');
    const editLinkDisplay = document.getElementById('editLink');
    const editCodeDisplay = document.getElementById('editCodeDisplay');  
    const accessCodeDisplay = document.getElementById('accessCodeDisplay');  
    const editCodeInput = document.getElementById('editCodeInput');  
    const editCodeSection = document.getElementById('edit-code-section');

    const noteContentDisplay = document.getElementById('noteContentDisplay');
    const adContainer = document.getElementById('ad-container');
    const initialViewCountDisplay = document.getElementById('initialViewCountDisplay');
    const noteViewCountDisplay = document.getElementById('noteViewCountDisplay');
    const noteTimestampDisplay = document.getElementById('noteTimestamp');

    const loadingIndicator = document.getElementById('loading-indicator');
    const errorMessageDisplay = document.getElementById('error-message');
    const rateLimitAlertElement = document.getElementById('rateLimitAlert');


    const codeAccessRow = document.getElementById('code-access-row');
    const codeAccessInput = document.getElementById('codeAccessInput');
    const codeAccessButton = document.getElementById('codeAccessButton');
    
    const contentSizeDisplay = document.getElementById('contentSizeDisplay');

    // Add new element getters for tabbed interface
    const writeTab = document.getElementById('write-tab');
    const previewTab = document.getElementById('preview-tab');
    const editorPreview = document.getElementById('editorPreview');
    const tabButtons = document.querySelectorAll('.tab-button');

    // marked.js
    marked.setOptions({
        highlight: function(code, lang) {
            if (lang && hljs.getLanguage(lang)) {
                try {
                    return hljs.highlight(code, { language: lang }).value;
                } catch (err) {
                    console.error('Error highlighting code:', err);
                }
            }
            return code;
        },
        breaks: true,
        gfm: true
    });

    // --- State Variables ---
    let currentNoteId = null;       // Firestore document ID (long ID)
    let currentShortId = null;      // User-facing short ID / access code
    let currentEditCode = null;     // Secret edit code for the current note (if known)

    // --- Constants ---
    const API_BASE_URL_ROOT =  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://localhost:3000' 
        : ''; // For production, API calls are relative, e.g., /api/notes

    const MAX_CONTENT_SIZE = 20 * 1024; // 20KB in bytes
    const MAX_CONTENT_SIZE_DISPLAY = '20KB';

    function showAds(visible) {
        const displayValue = visible ? 'flex' : 'none'; // Use 'flex' as per your CSS for ad-banner
        if (topAdBanner) topAdBanner.style.display = displayValue;
        if (bottomAdBanner) bottomAdBanner.style.display = displayValue;
    }

    
    


    // --- Helper Functions ---
    function setActiveView(activeViewElement) {
        editorArea.style.display = 'none';
        infoArea.style.display = 'none';
        viewArea.style.display = 'none';
        if (codeAccessRow) codeAccessRow.style.display = 'none';
        
        // Hide ads by default when switching views
        showAds(false);

        if (activeViewElement) {
            activeViewElement.style.display = 'block';
        }
    }

    function showLoadingState(isLoading) {
        if (isLoading) {
            setActiveView(null);
            loadingIndicator.style.display = 'block';
            clearError();
        } else {
            loadingIndicator.style.display = 'none';
        }
    }
    
    function linkify(inputTextOrHtml) {
        if (!inputTextOrHtml) return '';
        
        // This regular expression finds URLs.
        const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])|(\bwww\.[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
        
        // We directly replace URLs found in the string. 
        // The initial content was already safely inserted into the DOM using .textContent,
        // so we don't need to re-sanitize here. We are just adding <a> tags.
        return inputTextOrHtml.replace(urlRegex, function(url) {
            // This check prevents us from turning a URL that's already inside an <a> tag's href
            // into another link. It's a simple but effective guard.
            if (inputTextOrHtml.includes(`href="${url}"`)) {
                return url; // It's already a link, so don't change it.
            }
    
            let fullUrl = url;
            // If the URL starts with 'www.' but not 'http://' or 'https://', add 'http://'
            if (!url.match(/^[a-zA-Z]+:\/\//)) { 
                fullUrl = 'http://' + url;
            }
    
            // Return the HTML for the clickable link
            return `<a href="${fullUrl}" target="_blank" rel="noopener noreferrer">${url}</a>`;
        });
    }

    function showError(message) {
        errorMessageDisplay.textContent = message;
        errorMessageDisplay.style.display = 'block';
        // No auto-hide, user should acknowledge or navigate away
    }
    
    function clearError() {
        errorMessageDisplay.textContent = '';
        errorMessageDisplay.style.display = 'none';
    }

    function showRateLimitAlertMessage(message) {
        if (!rateLimitAlertElement) return;
        const alertMessageEl = rateLimitAlertElement.querySelector('.alert-message');
        if (alertMessageEl) alertMessageEl.textContent = message;
        rateLimitAlertElement.style.display = 'flex';
        setTimeout(() => rateLimitAlertElement.classList.add('show'), 10);
        // Auto-hide handled by CSS or a global hide function if needed
    }
    // Global hide function for the rate limit alert (if onclick is used in HTML)
    window.hideRateLimitAlert = function() {
        if (!rateLimitAlertElement) return;
        rateLimitAlertElement.classList.remove('show');
        setTimeout(() => { rateLimitAlertElement.style.display = 'none'; }, 300);
    };


    // --- UI Update Functions ---
    // --- SEO helpers: robots noindex for user-generated note views ---
    function setRobotsNoIndex(enable) {
        let tag = document.querySelector('meta[name="robots"]');
        if (enable) {
            if (!tag) {
                tag = document.createElement('meta');
                tag.setAttribute('name', 'robots');
                document.head.appendChild(tag);
            }
            tag.setAttribute('content', 'noindex, follow');
        } else {
            if (tag) tag.remove();
        }
    }

    function showEditorView() {
        setActiveView(editorArea);
        if (codeAccessRow) codeAccessRow.style.display = 'flex';
    showAds(false);
    teardownAds();
        setRobotsNoIndex(false);
        textContent.value = '';
        editCodeInput.value = '';
        textContent.disabled = false;
        saveButton.style.display = 'inline-block';
        updateButton.style.display = 'none';
        if(newNoteButton) newNoteButton.style.display = 'none';
        editCodeSection.style.display = 'none';
        updateSizeDisplay();
        
        // Reset to Write tab
        switchTab('write');
    }

    function showInfoView(data) { // data: { id, shortId, editCode, message, viewCount }
        setActiveView(infoArea);
    showAds(false);
    teardownAds();
    setRobotsNoIndex(false);
        messageDisplay.textContent = data.message || 'Note saved successfully!';
        
        // Path-based URLs
        const viewUrl = new URL(`/${data.shortId}`, window.location.origin).href;
        const editUrl = new URL(`/${data.shortId}/edit#${data.editCode}`, window.location.origin).href;

        viewLinkDisplay.href = viewUrl; 
        viewLinkDisplay.textContent = viewUrl; 
        editLinkDisplay.href = editUrl;
        editLinkDisplay.textContent = editUrl;
        
        if (accessCodeDisplay) accessCodeDisplay.textContent = data.shortId || "N/A";
        if (editCodeDisplay) editCodeDisplay.textContent = data.editCode || " (Not available)";
        
        const initialViewCountRow = document.getElementById('initialViewCountRow');
        if(initialViewCountDisplay && initialViewCountRow) {
            initialViewCountDisplay.textContent = data.viewCount !== undefined ? data.viewCount : '0';
            initialViewCountRow.style.display = data.viewCount !== undefined ? 'block' : 'none'; // Show if count exists
        }


        if(createNewFromInfoButton) createNewFromInfoButton.style.display = 'inline-block';
        if(viewNoteFromInfoButton) viewNoteFromInfoButton.style.display = 'inline-block';
    }

    function showNoteView(noteData) {
        setActiveView(viewArea);
    showAds(false); // We control ads via manual placement, not banner toggles
        
        // Parse and render the Markdown content
        noteContentDisplay.innerHTML = marked.parse(noteData.content || '');
        
        // Apply syntax highlighting to code blocks
        noteContentDisplay.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });

        if (noteData.createdAt) {
            noteTimestampDisplay.textContent = `Created: ${new Date(noteData.createdAt).toLocaleString()}`;
        } else {
            noteTimestampDisplay.textContent = '';
        }
        if(noteViewCountDisplay) noteViewCountDisplay.textContent = noteData.views !== undefined ? noteData.views : 'N/A';
        
    currentNoteId = noteData.id;
    currentShortId = noteData.shortId;

    // Only load ads on substantial content pages
    maybeLoadAdsForNote(noteData);

    // User-generated content should not be indexed
    setRobotsNoIndex(true);
    }

    function showEditView(noteContent) {
        setActiveView(editorArea);
    showAds(false);
    teardownAds();
    setRobotsNoIndex(false);
        if (codeAccessRow) codeAccessRow.style.display = 'none';
        textContent.value = noteContent;
        saveButton.style.display = 'none';
        updateButton.style.display = 'inline-block';
        if(newNoteButton) newNoteButton.style.display = 'inline-block';
        editCodeSection.style.display = 'block';
        editCodeInput.value = currentEditCode || ''; 
        // textContent.disabled = false;
        updateSizeDisplay();
        
        // Reset to Write tab
        switchTab('write');
    }

    function updateSizeDisplay() {
        if (!contentSizeDisplay) return;
        const content = textContent.value;
        const size = new Blob([content]).size; // More accurate byte size
        const sizeInKB = (size / 1024).toFixed(1);
        contentSizeDisplay.textContent = `${sizeInKB}KB / ${MAX_CONTENT_SIZE_DISPLAY}`;
        contentSizeDisplay.classList.toggle('size-warning', size > MAX_CONTENT_SIZE * 0.9);
    }

    // --- API Calls ---
    async function fetchNoteByShortId(shortId, forEditing = false) {
        if (!shortId || !shortId.trim()) {
            showError("Access code/ID is missing or invalid.");
            navigateTo('/'); return;
        }

        if (forEditing && window.location.hash) {
            // The fragment will be like '#SECRET_EDIT_CODE'. We remove the '#'
            const potentialEditCode = window.location.hash.substring(1);
            if (potentialEditCode) {
                console.log("Edit code found in URL fragment.");
                currentEditCode = potentialEditCode;
            }
        }
        showLoadingState(true);
        try {
            const response = await fetch(`${API_BASE_URL_ROOT}/api/notes/s/${shortId.trim()}`);
            let data = {};
            try { data = await response.json(); } catch(_) { data = { message: await response.text().catch(()=> 'Server error') }; }
            if (!response.ok) throw new Error(data.message || `Note not found or server error.`);
            
            currentNoteId = data.id;
            currentShortId = data.shortId;
            // currentEditCode is only known if user provides it for editing, or after saving.
            // If forEditing is true, we expect user to input editCode.
            
            if (forEditing) {
                showEditView(data.content);
            } else {
                showNoteView(data);
            }
        } catch (error) {
            console.error('Error fetching note by shortId:', error);
            showError(error.message); // Show specific error from API if available
            // Do not redirect to home; keep user on current route to retry or correct code
        } finally {
            showLoadingState(false);
        }
    }
    
    async function saveNote() {
        const content = textContent.value;
        if (!content.trim()) { showError('Content cannot be empty.'); return; }

        const contentSize = new Blob([content]).size;
        if (contentSize > MAX_CONTENT_SIZE) {
            showError(`Content size (${(contentSize / 1024).toFixed(1)}KB) exceeds limit of ${MAX_CONTENT_SIZE_DISPLAY}.`);
            return;
        }
        showLoadingState(true);
        saveButton.disabled = true;
        try {
            const response = await fetch(`${API_BASE_URL_ROOT}/api/notes`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }),
            });
            let data = {};
            try { data = await response.json(); } catch(_) { data = { message: await response.text().catch(()=> 'Server error') }; }
            if (!response.ok) {
                 if (response.status === 413 || response.status === 429) {
                    showRateLimitAlertMessage(data.message); // Use specific rate limit alert
                } else {
                    showError(data.message || `HTTP error! status: ${response.status}`);
                }
                setActiveView(editorArea); 
                showLoadingState(false);
                return;
            }
            
            currentNoteId = data.id; 
            currentShortId = data.shortId;
            currentEditCode = data.editCode; 
            
            sessionStorage.setItem('justpaste_lastNoteDetails', JSON.stringify({
                id: data.id, shortId: data.shortId, editCode: data.editCode, 
                message: data.message || 'Note saved!', viewCount: data.viewCount !== undefined ? data.viewCount : 0
            }));
            navigateTo(`/details/${data.shortId}`); 
        } catch (error) {
            console.error('Error saving note:', error);
            showError(`Failed to save note: ${error.message}`);
            setActiveView(editorArea);
            showLoadingState(false);
        } finally {
            saveButton.disabled = false;
        }
    }

    async function updateNote() {
        const content = textContent.value;
        const editCode = editCodeInput.value.trim();
        if (!currentNoteId) { showError('No note selected for update. Please load a note first.'); return; }
        if (!content.trim()) { showError('Content cannot be empty.'); return; }
        if (!editCode) { showError('Edit code is required to update.'); return; }

        const contentSize = new Blob([content]).size;
        if (contentSize > MAX_CONTENT_SIZE) {
            showError(`Content size (${(contentSize / 1024).toFixed(1)}KB) exceeds limit of ${MAX_CONTENT_SIZE_DISPLAY}.`);
            return;
        }
        
        showLoadingState(true);
        updateButton.disabled = true;
        try {
            const response = await fetch(`${API_BASE_URL_ROOT}/api/notes/${currentNoteId}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, editCode }),
            });
            let data = {};
            try { data = await response.json(); } catch(_) { data = { message: await response.text().catch(()=> 'Server error') }; }
            if (!response.ok) {
                if (response.status === 413 || response.status === 429) {
                    showRateLimitAlertMessage(data.message);
                } else {
                     showError(data.message || `HTTP error! status: ${response.status}`);
                }
                showEditView(textContent.value); 
                showLoadingState(false);
                return;
            }
            // Use currentShortId for navigation if available, otherwise currentNoteId (less ideal)
            navigateTo(`/${currentShortId || currentNoteId}`); 
            alert('Note updated successfully!'); // Consider replacing alert with a less obtrusive notification
        } catch (error) {
            console.error('Error updating note:', error);
            showError(`Failed to update note: ${error.message}`);
            showEditView(textContent.value);
            showLoadingState(false);
        } finally {
            updateButton.disabled = false;
        }
    }

    // --- Router ---
    const routes = {
        '/': () => {
            currentNoteId = null; currentShortId = null; currentEditCode = null;
            sessionStorage.removeItem('justpaste_lastNoteDetails');
            showEditorView();
            showLoadingState(false);
        },
        '/details/:shortId': (params) => {
            const detailsRaw = sessionStorage.getItem('justpaste_lastNoteDetails');
            let details = null;
            try { details = detailsRaw ? JSON.parse(detailsRaw) : null; } catch (e) { details = null; }

            if (details && details.shortId === params.shortId) {
                currentNoteId = details.id;
                currentShortId = details.shortId;
                currentEditCode = details.editCode;
                showInfoView(details); // Pass full details object
                showLoadingState(false);
            } else {
                navigateTo(`/${params.shortId}`);
            }
        },
        '/:id': (params) => fetchNoteByShortId(params.id, false),
        '/:id/edit': (params) => {
            // For edit, we need the editCode. If user navigates directly, they'll need to input it.
            // currentEditCode might be set if they came from info page after saving.
            fetchNoteByShortId(params.id, true);
        }
    };

    function router() {
        clearError();
        showLoadingState(true); 

        const path = window.location.pathname;
        let matchedRouteHandler = null;
        let routeParams = {};

        if (routes[path]) {
            matchedRouteHandler = routes[path];
        } else {
            for (const routePattern in routes) {
                const paramNames = [];
                const regexPattern = '^' + routePattern.replace(/:([^\/]+)/g, (_, paramName) => {
                    paramNames.push(paramName);
                    return '([^\/]+)'; // Match any character except '/'
                }) + '$';
                const regex = new RegExp(regexPattern);
                const matchResult = path.match(regex);

                if (matchResult) {
                    paramNames.forEach((name, index) => { routeParams[name] = matchResult[index + 1]; });
                    matchedRouteHandler = routes[routePattern];
                    break;
                }
            }
        }

        if (matchedRouteHandler) {
            matchedRouteHandler(routeParams);
        } else {
            console.warn(`No route found for ${path}, showing editor.`);
            currentNoteId = null; currentShortId = null; currentEditCode = null;
            sessionStorage.removeItem('justpaste_lastNoteDetails');
            showEditorView();
            showLoadingState(false);
        }
    }

    function navigateTo(path) {
        history.pushState({ path: path }, '', path);
        router();
    }

    // --- AdSense manual gating ---
    function getWordCountFromHtml(html) {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        const text = tmp.textContent || tmp.innerText || '';
        return (text.trim().match(/\S+/g) || []).length;
    }

    function ensureAdSenseScriptLoaded() {
        if (window.adsbygoogle) return true; // likely already present
        const existing = document.querySelector('script[data-adsbygoogle]');
        if (existing) return true;
        const s = document.createElement('script');
        s.async = true;
        s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-2387807071256876';
        s.setAttribute('crossorigin', 'anonymous');
        s.setAttribute('data-adsbygoogle', '1');
        document.head.appendChild(s);
        return false; // not yet loaded
    }

    function teardownAds() {
        if (!adContainer) return;
        adContainer.style.display = 'none';
        adContainer.innerHTML = '';
    }

    function maybeLoadAdsForNote(noteData) {
        if (!adContainer) return;
        const wordCount = getWordCountFromHtml(noteContentDisplay.innerHTML);
        const isEligible = wordCount >= 250; // threshold to avoid "no publisher content" violations
        if (!isEligible) { teardownAds(); return; }

        // Prepare container
        adContainer.style.display = 'block';
        adContainer.innerHTML = '';

        // Ensure AdSense script is present
        const ready = ensureAdSenseScriptLoaded();

        // Create an ad unit
        const ins = document.createElement('ins');
        ins.className = 'adsbygoogle';
        ins.style.display = 'block';
        // Replace with your responsive ad unit slot if you have one; fallback to auto format
        ins.setAttribute('data-ad-client', 'ca-pub-2387807071256876');
        ins.setAttribute('data-ad-slot', 'auto');
        ins.setAttribute('data-ad-format', 'auto');
        ins.setAttribute('data-full-width-responsive', 'true');
        adContainer.appendChild(ins);

        function pushAd() {
            try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch(e) { /* no-op */ }
        }

        if (ready) {
            pushAd();
        } else {
            // If script just injected, wait a bit then push
            setTimeout(pushAd, 800);
        }
    }
    
    // --- Event Listeners ---
    if(saveButton) saveButton.addEventListener('click', saveNote);
    if(updateButton) updateButton.addEventListener('click', updateNote);
    
    if(newNoteButton) newNoteButton.addEventListener('click', () => navigateTo('/'));
    if(createNewNoteFromViewButton) createNewNoteFromViewButton.addEventListener('click', () => navigateTo('/'));
    if(createNewFromInfoButton) createNewFromInfoButton.addEventListener('click', () => navigateTo('/'));
    if(viewNoteFromInfoButton) viewNoteFromInfoButton.addEventListener('click', () => {
        if(currentShortId) navigateTo(`/${currentShortId}`);
        else if (currentNoteId) navigateTo(`/${currentNoteId}`); // Fallback, less ideal
    });


    if(editThisNoteButton) editThisNoteButton.addEventListener('click', () => {
        if (currentShortId) navigateTo(`/${currentShortId}/edit`);
        else if (currentNoteId) navigateTo(`/${currentNoteId}/edit`); // Fallback
    });
    
    if(textContent) textContent.addEventListener('input', updateSizeDisplay);

    if (codeAccessButton && codeAccessInput) {
        codeAccessButton.addEventListener('click', () => {
            const code = codeAccessInput.value.trim();
            if (code) {
                navigateTo(`/${code}`); 
                codeAccessInput.value = '';
            } else {
                showError("Please enter an access code.");
            }
        });
        codeAccessInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') codeAccessButton.click();
        });
    }

    window.addEventListener('popstate', router);

    // Intercept local link clicks for SPA navigation (simplified)
    // These are primarily for the links generated in showInfoView
    if(viewLinkDisplay) viewLinkDisplay.addEventListener('click', (e) => {
      if (e.target.origin === window.location.origin && (currentShortId || currentNoteId)) { 
          e.preventDefault(); navigateTo(new URL(e.target.href).pathname);
      }
    });
    if(editLinkDisplay) editLinkDisplay.addEventListener('click', (e) => {
      if (e.target.origin === window.location.origin && (currentShortId || currentNoteId)) { 
          e.preventDefault(); navigateTo(new URL(e.target.href).pathname);
      }
    });

    // --- Tab Switching Functions ---
    function switchTab(tabName) {
        // Update tab buttons
        tabButtons.forEach(button => {
            button.classList.toggle('active', button.dataset.tab === tabName);
        });

        // Update tab content
        writeTab.classList.toggle('active', tabName === 'write');
        previewTab.classList.toggle('active', tabName === 'preview');

        // If switching to preview, update the preview content
        if (tabName === 'preview') {
            updatePreview();
        }
    }

    function updatePreview() {
        const content = textContent.value;
        editorPreview.innerHTML = marked.parse(content);
        
        // Apply syntax highlighting to code blocks
        editorPreview.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });
    }

    // Add event listeners for tab switching
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            switchTab(button.dataset.tab);
        });
    });

    // Update preview when content changes (with debounce)
    let previewTimeout;
    textContent.addEventListener('input', () => {
        clearTimeout(previewTimeout);
        previewTimeout = setTimeout(() => {
            if (previewTab.classList.contains('active')) {
                updatePreview();
            }
            updateSizeDisplay();
        }, 300);
    });

    // Initial page load & size display
    router();
    updateSizeDisplay(); 
});
