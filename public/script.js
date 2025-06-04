// public/script.js
document.addEventListener('DOMContentLoaded', () => {
    const textContent = document.getElementById('textContent');
    const saveButton = document.getElementById('saveButton');
    const updateButton = document.getElementById('updateButton');
    const newNoteButton = document.getElementById('newNoteButton');
    const createNewNoteFromViewButton = document.getElementById('createNewNoteFromViewButton');
    const editThisNoteButton = document.getElementById('editThisNoteButton');

    const editorArea = document.getElementById('editor-area');
    const infoArea = document.getElementById('info-area');
    const viewArea = document.getElementById('view-area');

    const messageDisplay = document.getElementById('message');
    const viewLinkDisplay = document.getElementById('viewLink');
    const editLinkDisplay = document.getElementById('editLink');
    const editCodeDisplay = document.getElementById('editCodeDisplay');
    const editCodeInput = document.getElementById('editCodeInput');
    const editCodeSection = document.getElementById('edit-code-section');

    const noteContentDisplay = document.getElementById('noteContentDisplay'); // This is a <pre> element
    const noteTimestampDisplay = document.getElementById('noteTimestamp');

    const loadingIndicator = document.getElementById('loading-indicator');
    const errorMessageDisplay = document.getElementById('error-message');

    const codeAccessRow = document.getElementById('code-access-row');
    const codeAccessInput = document.getElementById('codeAccessInput');
    const codeAccessButton = document.getElementById('codeAccessButton');

    const accessCodeDisplay = document.getElementById('accessCodeDisplay');

    let currentNoteId = null;
    let currentEditCode = null;

    const API_BASE_URL = '/api/notes';

    // Content size constants
    const MAX_CONTENT_SIZE = 20 * 1024; // 20KB in bytes
    const MAX_CONTENT_SIZE_DISPLAY = '20KB';

    // --- Helper function to make links clickable ---
    function linkify(inputText) {
        if (!inputText) return '';
        // Regular expression to find URLs (http, https, ftp)
        const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])|(\bwww\.[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
        
        // Sanitize text to prevent XSS before linkifying.
        // Create a temporary div to set textContent, then get innerHTML.
        // This escapes HTML special characters.
        const tempDiv = document.createElement('div');
        tempDiv.textContent = inputText;
        const sanitizedText = tempDiv.innerHTML;

        return sanitizedText.replace(urlRegex, function(url) {
            let fullUrl = url;
            if (!url.match(/^[a-zA-Z]+:\/\//)) { // If URL doesn't start with a scheme (e.g. www.example.com)
                fullUrl = 'http://' + url; // Add http:// by default
            }
            return `<a href="${fullUrl}" target="_blank" rel="noopener noreferrer">${url}</a>`;
        });
    }


    // --- UI State Management ---
    function showLoading(isLoading) {
        loadingIndicator.style.display = isLoading ? 'block' : 'none';
        if (isLoading) errorMessageDisplay.style.display = 'none';
    }

    function showError(message) {
        errorMessageDisplay.textContent = message;
        errorMessageDisplay.style.display = 'block';
        setTimeout(() => {
            errorMessageDisplay.style.display = 'none';
        }, 5000);
    }
    
    function clearError() {
        errorMessageDisplay.textContent = '';
        errorMessageDisplay.style.display = 'none';
    }

    function showEditorView() {
        editorArea.style.display = 'block';
        infoArea.style.display = 'none';
        viewArea.style.display = 'none';
        saveButton.style.display = 'inline-block';
        updateButton.style.display = 'none';
        newNoteButton.style.display = 'none';
        editCodeSection.style.display = 'none';
        textContent.value = '';
        editCodeInput.value = '';
        textContent.disabled = false;
        clearError();
        if (codeAccessRow) codeAccessRow.style.display = 'flex';
    }

    function showInfoView(data) {
        editorArea.style.display = 'none';
        infoArea.style.display = 'block';
        viewArea.style.display = 'none';

        messageDisplay.textContent = data.message || 'Note saved successfully!';
        let basePath = window.location.origin + window.location.pathname;
        if (!basePath.endsWith('/')) {
            basePath += '/';
        }
        if (accessCodeDisplay) accessCodeDisplay.textContent = data.id || '';
        viewLinkDisplay.href = `${basePath}#/view/${data.id}`;
        viewLinkDisplay.textContent = `View: ${basePath}#/view/${data.id}`;
        editLinkDisplay.href = `${basePath}#/edit/${data.id}`;
        editLinkDisplay.textContent = `Edit: ${basePath}#/edit/${data.id}`;
        editCodeDisplay.textContent = data.editCode || " (Not available)";
        newNoteButton.style.display = 'inline-block';
        clearError();
        if (codeAccessRow) codeAccessRow.style.display = 'none';
    }

    function showNoteView(noteData) {
        editorArea.style.display = 'none';
        infoArea.style.display = 'none';
        viewArea.style.display = 'block';

        // Render clickable links in the note content
        noteContentDisplay.innerHTML = linkify(noteData.content);

        if (noteData.createdAt) {
            noteTimestampDisplay.textContent = `Created: ${new Date(noteData.createdAt).toLocaleString()}`;
        } else {
            noteTimestampDisplay.textContent = '';
        }
        // Show views if available
        let viewsDisplay = document.getElementById('noteViewsDisplay');
        if (!viewsDisplay) {
            viewsDisplay = document.createElement('div');
            viewsDisplay.id = 'noteViewsDisplay';
            viewsDisplay.style = 'font-size: 0.95em; color: #b0b0b0; margin-top: 6px; text-align: right;';
            noteTimestampDisplay.parentNode.appendChild(viewsDisplay);
        }
        if (typeof noteData.views === 'number') {
            viewsDisplay.textContent = `Views: ${noteData.views}`;
        } else {
            viewsDisplay.textContent = '';
        }
        currentNoteId = noteData.id;
        clearError();
        if (codeAccessRow) codeAccessRow.style.display = 'none';
    }

    function showEditView(noteContent) {
        editorArea.style.display = 'block';
        infoArea.style.display = 'none';
        viewArea.style.display = 'none';

        textContent.value = noteContent;
        saveButton.style.display = 'none';
        updateButton.style.display = 'inline-block';
        newNoteButton.style.display = 'inline-block';
        editCodeSection.style.display = 'block';
        editCodeInput.value = currentEditCode || '';
        textContent.disabled = false;
        clearError();
        if (codeAccessRow) codeAccessRow.style.display = 'none';
    }

    // Add size display to the editor area
    function updateSizeDisplay() {
        const content = textContent.value;
        const size = new Blob([content]).size;
        const sizeDisplay = document.getElementById('contentSizeDisplay');
        
        if (sizeDisplay) {
            const sizeInKB = Math.round(size / 1024);
            sizeDisplay.textContent = `${sizeInKB}KB / ${MAX_CONTENT_SIZE_DISPLAY}`;
            
            // Add warning class if approaching limit
            if (size > MAX_CONTENT_SIZE * 0.9) { // 90% of max size
                sizeDisplay.classList.add('size-warning');
            } else {
                sizeDisplay.classList.remove('size-warning');
            }
        }
    }

    // --- API Calls ---
    async function saveNote() {
        const content = textContent.value.trim();
        if (!content) {
            showError('Content cannot be empty.');
            return;
        }

        const contentSize = new Blob([content]).size;
        if (contentSize > MAX_CONTENT_SIZE) {
            showError(`Content size (${Math.round(contentSize / 1024)}KB) exceeds the maximum limit of ${MAX_CONTENT_SIZE_DISPLAY}.`);
            return;
        }

        showLoading(true);
        saveButton.disabled = true;
        try {
            const response = await fetch(API_BASE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content }),
            });
            const data = await response.json();
            if (!response.ok) {
                if (response.status === 413) {
                    showError(data.message);
                } else if (response.status === 429) {
                    showRateLimitAlert('Rate limit reached. You can create up to 5 notes per hour.');
                } else {
                    throw new Error(data.message || `HTTP error! status: ${response.status}`);
                }
                return;
            }
            currentNoteId = data.id;
            currentEditCode = data.editCode; 

            showInfoView({ id: data.id, editCode: data.editCode, message: data.message || 'Note saved successfully!' });
            window.location.hash = `#/details/${data.id}`;

        } catch (error) {
            console.error('Error saving note:', error);
            showError(`Failed to save note: ${error.message}`);
        } finally {
            showLoading(false);
            saveButton.disabled = false;
        }
    }

    async function updateNote() {
        const content = textContent.value.trim();
        const editCode = editCodeInput.value.trim();

        if (!currentNoteId) {
            showError('No note selected for update.');
            return;
        }
        if (!content) {
            showError('Content cannot be empty.');
            return;
        }
        if (!editCode) {
            showError('Edit code is required to update.');
            return;
        }

        const contentSize = new Blob([content]).size;
        if (contentSize > MAX_CONTENT_SIZE) {
            showError(`Content size (${Math.round(contentSize / 1024)}KB) exceeds the maximum limit of ${MAX_CONTENT_SIZE_DISPLAY}.`);
            return;
        }

        showLoading(true);
        updateButton.disabled = true;
        try {
            const response = await fetch(`${API_BASE_URL}/${currentNoteId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content, editCode }),
            });
            const data = await response.json();
            if (!response.ok) {
                if (response.status === 413) {
                    showError(data.message);
                } else if (response.status === 429) {
                    showRateLimitAlert('Rate limit reached. You can update a note up to 10 times per 15 minutes.');
                } else {
                    throw new Error(data.message || `HTTP error! status: ${response.status}`);
                }
                return;
            }
            window.location.hash = `#/view/${currentNoteId}`;
            alert('Note updated successfully!');
        } catch (error) {
            console.error('Error updating note:', error);
            showError(`Failed to update note: ${error.message}`);
        } finally {
            showLoading(false);
            updateButton.disabled = false;
        }
    }

    async function fetchNote(id, forEditing = false) {
        if (!id) return;
        showLoading(true);
        try {
            const response = await fetch(`${API_BASE_URL}/${id}`);
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message || `HTTP error! status: ${response.status}`);
            }
            currentNoteId = data.id;
            if (forEditing) {
                showEditView(data.content);
            } else {
                showNoteView(data);
            }
        } catch (error) {
            console.error('Error fetching note:', error);
            showError(`Failed to fetch note: ${error.message}`);
            showEditorView();
        } finally {
            showLoading(false);
        }
    }

    // --- Routing ---
    function handleHashChange() {
        const hash = window.location.hash;
        clearError(); 

        if (hash.startsWith('#/view/')) {
            const id = hash.substring('#/view/'.length);
            fetchNote(id);
        } else if (hash.startsWith('#/edit/')) {
            const id = hash.substring('#/edit/'.length);
            fetchNote(id, true); 
        } else if (hash.startsWith('#/details/')) {
            const idFromHash = hash.substring('#/details/'.length);
            if (currentNoteId === idFromHash && currentEditCode) {
                 showInfoView({id: currentNoteId, editCode: currentEditCode, message: "Note details:"});
            } else {
                console.warn("Navigated to details page without fresh save context or editCode. Redirecting to view.");
                window.location.hash = `#/view/${idFromHash}`;
            }
        }
        else { 
            currentNoteId = null;
            currentEditCode = null;
            showEditorView();
        }
    }

    // --- Event Listeners ---
    saveButton.addEventListener('click', saveNote);
    updateButton.addEventListener('click', updateNote);
    
    newNoteButton.addEventListener('click', () => {
        window.location.hash = '#/'; 
    });
    createNewNoteFromViewButton.addEventListener('click', () => {
        window.location.hash = '#/';
    });
    editThisNoteButton.addEventListener('click', () => {
        if (currentNoteId) {
            window.location.hash = `#/edit/${currentNoteId}`;
        }
    });

    window.addEventListener('hashchange', handleHashChange);

    // Initial load
    handleHashChange(); 

    // Rate Limit Alert Functions
    function showRateLimitAlert(message = 'You\'ve reached the maximum number of requests. Please try again later.') {
        const alert = document.getElementById('rateLimitAlert');
        if (!alert) {
            console.error('Rate limit alert element not found');
            return;
        }
        const alertMessage = alert.querySelector('.alert-message');
        if (alertMessage) {
            alertMessage.textContent = message;
        }
        alert.style.display = 'flex';
        setTimeout(() => {
            alert.classList.add('show');
        }, 10);
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            hideRateLimitAlert();
        }, 5000);
    }

    function hideRateLimitAlert() {
        const alert = document.getElementById('rateLimitAlert');
        if (!alert) return;
        
        alert.classList.remove('show');
        setTimeout(() => {
            alert.style.display = 'none';
        }, 300);
    }

    // Make functions globally available
    window.showRateLimitAlert = showRateLimitAlert;
    window.hideRateLimitAlert = hideRateLimitAlert;

    // Add input event listener for real-time size updates
    textContent.addEventListener('input', updateSizeDisplay);
    
    // Initial size display
    updateSizeDisplay();

    // Function to load a note
    async function loadNote() {
        const noteId = getNoteIdFromUrl();
        if (!noteId) return;

        try {
            const response = await fetch(`${API_BASE_URL}/${noteId}`);
            if (!response.ok) {
                throw new Error('Note not found');
            }
            const data = await response.json();
            document.getElementById('textContent').value = data.content;
            const noteIdElement = document.getElementById('noteId');
            if (noteIdElement) {
                noteIdElement.textContent = noteId;
                // Add a link to the raw view
                const rawLink = document.createElement('a');
                rawLink.href = `${API_BASE_URL}/${noteId}/raw`;
                rawLink.textContent = 'View Raw';
                rawLink.target = '_blank';
                noteIdElement.appendChild(document.createElement('br'));
                noteIdElement.appendChild(rawLink);
            }
        } catch (error) {
            console.error('Error loading note:', error);
            alert('Error loading note. Please check the URL and try again.');
        }
    }

    // Code access logic
    if (codeAccessButton && codeAccessInput) {
        codeAccessButton.addEventListener('click', () => {
            const code = codeAccessInput.value.trim();
            if (code) {
                window.location.hash = `#/view/${code}`;
                codeAccessInput.value = '';
            }
        });
        codeAccessInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                codeAccessButton.click();
            }
        });
    }
});
