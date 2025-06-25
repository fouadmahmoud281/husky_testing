// Test file with various issues for AI review
function testFunction() {
    const apiKey = "sk-1234567890abcdef"; // Hardcoded API key
    
    // Missing semicolon below
    let result = getData()
    
    if (result = null) { // Assignment instead of comparison
        console.log("Error occurred")
    }
    
    return result
}
