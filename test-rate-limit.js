const axios = require('axios');

const API_URL = 'http://localhost:3000/api';
let successCount = 0;
let failureCount = 0;

// Test note creation rate limit
async function testCreateNoteLimit() {
    console.log('\n=== Testing Note Creation Rate Limit ===');
    console.log('Attempting to create 8 notes (limit is 5 per hour)...\n');
    
    for (let i = 1; i <= 8; i++) {
        try {
            const response = await axios.post(`${API_URL}/notes`, {
                content: `Test note ${i}`
            });
            successCount++;
            console.log(`✅ Note ${i} created successfully:`, response.data.id);
        } catch (error) {
            failureCount++;
            if (error.response) {
                console.log(`❌ Note ${i} failed:`, error.response.data.message);
            } else {
                console.log(`❌ Note ${i} failed:`, error.message);
            }
        }
        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log('\n=== Create Note Test Results ===');
    console.log(`Successful requests: ${successCount}`);
    console.log(`Failed requests: ${failureCount}`);
}

// Test note update rate limit
async function testUpdateNoteLimit() {
    console.log('\n=== Testing Note Update Rate Limit ===');
    
    // First create a note to update
    try {
        const createResponse = await axios.post(`${API_URL}/notes`, {
            content: 'Test note for updates'
        });
        const noteId = createResponse.data.id;
        const editCode = createResponse.data.editCode;
        
        console.log(`Created test note with ID: ${noteId}`);
        console.log('Attempting 15 updates (limit is 10 per 15 minutes)...\n');
        
        successCount = 0;
        failureCount = 0;
        
        for (let i = 1; i <= 15; i++) {
            try {
                const response = await axios.put(`${API_URL}/notes/${noteId}`, {
                    content: `Updated content ${i}`,
                    editCode: editCode
                });
                successCount++;
                console.log(`✅ Update ${i} successful`);
            } catch (error) {
                failureCount++;
                if (error.response) {
                    console.log(`❌ Update ${i} failed:`, error.response.data.message);
                } else {
                    console.log(`❌ Update ${i} failed:`, error.message);
                }
            }
            // Small delay between requests
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        console.log('\n=== Update Note Test Results ===');
        console.log(`Successful updates: ${successCount}`);
        console.log(`Failed updates: ${failureCount}`);
        
    } catch (error) {
        console.error('Failed to create test note:', error.message);
    }
}

// Run the tests
async function runTests() {
    console.log('Starting rate limit tests...');
    await testCreateNoteLimit();
    await testUpdateNoteLimit();
}

runTests().catch(console.error); 