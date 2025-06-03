const axios = require('axios');

const API_URL = 'http://localhost:3000/api';

// Helper function to generate text of specific size
function generateText(sizeInKB) {
    const text = 'a'.repeat(sizeInKB * 1024); // Each character is 1 byte in ASCII
    return text;
}

// Test cases with different sizes
const testCases = [
    { size: 50, description: '50KB (under limit)' },
    { size: 90, description: '90KB (approaching limit)' },
    { size: 100, description: '100KB (at limit)' },
    { size: 110, description: '110KB (over limit)' },
    { size: 150, description: '150KB (well over limit)' }
];

async function runSizeTests() {
    console.log('=== Testing Content Size Limits ===\n');
    
    for (const test of testCases) {
        console.log(`Testing ${test.description}...`);
        const content = generateText(test.size);
        
        try {
            const response = await axios.post(`${API_URL}/notes`, { content });
            console.log(`✅ Success: Note created with ${test.size}KB content`);
            console.log(`   Note ID: ${response.data.id}`);
            console.log(`   Edit Code: ${response.data.editCode}\n`);
        } catch (error) {
            if (error.response) {
                if (error.response.status === 413) {
                    console.log(`❌ Size Limit Error: ${error.response.data.message}`);
                    console.log(`   Current Size: ${error.response.data.currentSize}`);
                    console.log(`   Max Size: ${error.response.data.maxSize}\n`);
                } else {
                    console.log(`❌ Error: ${error.response.data.message}\n`);
                }
            } else {
                console.log(`❌ Error: ${error.message}\n`);
            }
        }
        
        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

// Run the tests
runSizeTests().catch(console.error); 