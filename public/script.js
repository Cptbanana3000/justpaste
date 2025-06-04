document.addEventListener('DOMContentLoaded', () => {
    // --- Element Getters ---
    const textContent = document.getElementById('textContent');
    const saveButton = document.getElementById('saveButton');
    const updateButton = document.getElementById('updateButton');
    const newNoteButton = document.getElementById('newNoteButton'); // In editor card
    const createNewNoteFromViewButton = document.getElementById('createNewNoteFromViewButton');
    const editThisNoteButton = document.getElementById('editThisNoteButton');
    const createNewFromInfoButton = document.getElementById('createNewFromInfoButton');
    const viewNoteFromInfoButton = document.getElementById('viewNoteFromInfoButton');


    const editorArea = document.getElementById('editor-area');
    const infoArea = document.getElementById('info-area');
    const viewArea = document.getElementById('view-area');

    const messageDisplay = document.getElementById('message');
    const viewLinkDisplay = document.getElementById('viewLink');
    const editLinkDisplay = document.getElementById('editLink');
    const editCodeDisplay = document.getElementById('editCodeDisplay'); // In infoArea for edit code
    const accessCodeDisplay = document.getElementById('accessCodeDisplay'); // In infoArea for access code
    const editCodeInput = document.getElementById('editCodeInput'); // In editorArea for entering edit code
    const editCodeSection = document.getElementById('edit-code-section');

    const noteContentDisplay = document.getElementById('noteContentDisplay');
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

    // --- Helper Functions ---
    function setActiveView(activeViewElement) {
        editorArea.style.display = 'none';
        infoArea.style.display = 'none';
        viewArea.style.display = 'none';
        if (codeAccessRow) codeAccessRow.style.display = 'none';
        if (activeViewElement) activeViewElement.style.display = 'block';
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
    
    function linkify(inputText) {
        if (!inputText) return '';
        const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])|(\bwww\.[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
        const tempDiv = document.createElement('div');
        tempDiv.textContent = inputText;
        const sanitizedText = tempDiv.innerHTML;
        return sanitizedText.replace(urlRegex, function(url) {
            let fullUrl = url;
            if (!url.match(/^[a-zA-Z]+:\/\//)) { fullUrl = 'http://' + url; }
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
    function showEditorView() {
        setActiveView(editorArea);
        if (codeAccessRow) codeAccessRow.style.display = 'flex';
        textContent.value = '';
        editCodeInput.value = '';
        textContent.disabled = false;
        saveButton.style.display = 'inline-block';
        updateButton.style.display = 'none';
        if(newNoteButton) newNoteButton.style.display = 'none';
        editCodeSection.style.display = 'none';
        updateSizeDisplay();
    }

    function showInfoView(data) { // data: { id, shortId, editCode, message, viewCount }
        setActiveView(infoArea);
        messageDisplay.textContent = data.message || 'Note saved successfully!';
        
        // Path-based URLs
        const viewUrl = new URL(`/${data.shortId}`, window.location.origin).href;
        const editUrl = new URL(`/${data.shortId}/edit`, window.location.origin).href;

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

    function showNoteView(noteData) { // noteData: { content, id, shortId, createdAt, views }
        setActiveView(viewArea);
        noteContentDisplay.innerHTML = linkify(noteData.content);
        if (noteData.createdAt) {
            noteTimestampDisplay.textContent = `Created: ${new Date(noteData.createdAt).toLocaleString()}`;
        } else {
            noteTimestampDisplay.textContent = '';
        }
        if(noteViewCountDisplay) noteViewCountDisplay.textContent = noteData.views !== undefined ? noteData.views : 'N/A';
        
        currentNoteId = noteData.id;
        currentShortId = noteData.shortId;
        // currentEditCode is not set here as it's not fetched for viewing
    }

    function showEditView(noteContent) {
        setActiveView(editorArea);
        if (codeAccessRow) codeAccessRow.style.display = 'none';
        textContent.value = noteContent;
        saveButton.style.display = 'none';
        updateButton.style.display = 'inline-block';
        if(newNoteButton) newNoteButton.style.display = 'inline-block';
        editCodeSection.style.display = 'block';
        editCodeInput.value = currentEditCode || ''; 
        textContent.disabled = false;
        updateSizeDisplay();
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
        showLoadingState(true);
        try {
            const response = await fetch(`${API_BASE_URL_ROOT}/api/notes/s/${shortId.trim()}`);
            const data = await response.json();
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
            navigateTo('/');
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
            const data = await response.json(); // Expects: id, shortId, editCode, message, viewCount (optional)
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
            const data = await response.json();
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

    // Initial page load & size display
    router();
    updateSizeDisplay(); 
});
