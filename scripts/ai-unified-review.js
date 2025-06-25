#!/usr/bin/env node

/**
 * AI Code Review Script using GPT-4o
 * 
 * This script analyzes git changes and provides categorized feedback:
 * 🚨 Syntax & Build Issues - Missing semicolons, import errors, TypeScript errors
 * 🛡 Security Critical - Hardcoded secrets, API keys, vulnerabilities  
 * 🎨 Style Violations - Major linting errors, formatting issues
 * 🚫 Blocking Issues - Build-breaking issues that prevent compilation
 * 
 * The script will BLOCK (exit code 1) only for 🚫 Blocking Issues
 */

const { execSync } = require('child_process');
const OpenAI = require('openai');
require('dotenv').config();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Get git diff for staged/unstaged changes
 */
function getGitChanges() {
  try {
    // Get staged changes (for pre-commit)
    const stagedDiff = execSync('git diff --cached', { encoding: 'utf8' });
    
    // Get unstaged changes 
    const unstagedDiff = execSync('git diff', { encoding: 'utf8' });
    
    // For pre-push, get changes between current branch and origin
    let pushDiff = '';
    try {
      pushDiff = execSync('git diff origin/main..HEAD', { encoding: 'utf8' });
    } catch (error) {
      // Fallback if origin/main doesn't exist
      try {
        pushDiff = execSync('git diff HEAD~1..HEAD', { encoding: 'utf8' });
      } catch (fallbackError) {
        console.log('⚠️  Could not get push diff, using staged changes');
        pushDiff = stagedDiff;
      }
    }
    
    return {
      staged: stagedDiff,
      unstaged: unstagedDiff,
      push: pushDiff
    };
  } catch (error) {
    console.error('Error getting git changes:', error.message);
    return { staged: '', unstaged: '', push: '' };
  }
}

/**
 * Parse git diff to separate additions and deletions
 */
function parseDiff(diff) {
  if (!diff || diff.trim() === '') {
    return { additions: [], deletions: [], files: [] };
  }

  const lines = diff.split('\n');
  const additions = [];
  const deletions = [];
  const files = [];
  let currentFile = null;

  // Limit the number of changes to avoid token limits
  const MAX_CHANGES_PER_TYPE = 50;

  for (const line of lines) {
    // File headers
    if (line.startsWith('diff --git')) {
      const match = line.match(/diff --git a\/(.+) b\/(.+)/);
      if (match) {
        currentFile = match[2];
        if (!files.includes(currentFile)) {
          files.push(currentFile);
        }
      }
    }
    // Additions (limit to avoid token overflow)
    else if (line.startsWith('+') && !line.startsWith('+++') && additions.length < MAX_CHANGES_PER_TYPE) {
      const cleanLine = line.substring(1).trim();
      // Skip empty lines and very long lines
      if (cleanLine && cleanLine.length < 200) {
        additions.push({
          file: currentFile,
          line: cleanLine,
          type: 'addition'
        });
      }
    }
    // Deletions (limit to avoid token overflow)
    else if (line.startsWith('-') && !line.startsWith('---') && deletions.length < MAX_CHANGES_PER_TYPE) {
      const cleanLine = line.substring(1).trim();
      // Skip empty lines and very long lines
      if (cleanLine && cleanLine.length < 200) {
        deletions.push({
          file: currentFile,
          line: cleanLine,
          type: 'deletion'
        });
      }
    }
  }

  return { additions, deletions, files };
}

/**
 * Create AI prompt for code review
 */
function createReviewPrompt(additions, deletions, files) {
  let prompt = `You are an expert code reviewer. Please analyze the following code changes and provide feedback on code quality, potential issues, and recommendations.

**Files Modified:** ${files.slice(0, 10).join(', ')}${files.length > 10 ? ' and ' + (files.length - 10) + ' more...' : ''}

`;

  if (deletions.length > 0) {
    prompt += `**CODE DELETIONS (${deletions.length} total):**
The following lines were DELETED from the codebase:
`;
    deletions.slice(0, 20).forEach((deletion, index) => {
      prompt += `${index + 1}. File: ${deletion.file}
   Deleted: ${deletion.line}
`;
    });
    if (deletions.length > 20) {
      prompt += `... and ${deletions.length - 20} more deletions\n`;
    }
    prompt += '\n';
  }

  if (additions.length > 0) {
    prompt += `**CODE ADDITIONS (${additions.length} total):**
The following lines were ADDED to the codebase:
`;
    additions.slice(0, 20).forEach((addition, index) => {
      prompt += `${index + 1}. File: ${addition.file}
   Added: ${addition.line}
`;
    });
    if (additions.length > 20) {
      prompt += `... and ${additions.length - 20} more additions\n`;
    }
    prompt += '\n';
  }

  prompt += `**Please analyze the code changes and categorize issues using these EXACT categories:**

🚨 **SYNTAX & BUILD ISSUES**: Missing semicolons, import errors, TypeScript errors, syntax problems
🛡 **SECURITY CRITICAL**: Hardcoded secrets, API keys, obvious vulnerabilities, security risks
🎨 **STYLE VIOLATIONS**: Major linting errors, formatting issues, code style problems
🚫 **BLOCKING ISSUES**: Only build-breaking issues that would prevent compilation/execution

**Also provide:**
1. **Overall Assessment**: Brief summary of the changes
2. **Recommendations**: Specific actionable recommendations

**IMPORTANT**: 
- If you find any 🚫 BLOCKING ISSUES, clearly mark them as "BLOCKING: YES"
- Focus on the most critical issues first
- Keep your response concise and actionable`;

  return prompt;
}

/**
 * Get AI review from OpenAI
 */
async function getAIReview(prompt) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are an expert code reviewer focused on code quality, security, and best practices. Pay special attention to syntax errors, security vulnerabilities, and build-breaking issues.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 1000,
      temperature: 0.1
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error('Error calling OpenAI API:', error.message);
    throw error;
  }
}

/**
 * Main function
 */
async function main() {
  const reviewType = process.argv[2] || 'prepush';
  
  console.log(`🤖 Starting AI code review (${reviewType})...`);

  // Check if OpenAI API key is configured
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY environment variable is not set');
    console.log('Please add your OpenAI API key to the .env file');
    process.exit(1);
  }

  // Get git changes
  const changes = getGitChanges();
  let diffToAnalyze = '';

  switch (reviewType) {
    case 'precommit':
      diffToAnalyze = changes.staged;
      break;
    case 'prepush':
      diffToAnalyze = changes.push;
      break;
    default:
      diffToAnalyze = changes.staged || changes.push;
  }

  if (!diffToAnalyze || diffToAnalyze.trim() === '') {
    console.log('✅ No changes to review');
    process.exit(0);
  }

  // Parse the diff
  const { additions, deletions, files } = parseDiff(diffToAnalyze);

  if (additions.length === 0 && deletions.length === 0) {
    console.log('✅ No code changes to review');
    process.exit(0);
  }

  console.log(`📊 Analyzing ${files.length} file(s) with ${additions.length} additions and ${deletions.length} deletions...`);

  try {
    // Create prompt and get AI review
    const prompt = createReviewPrompt(additions, deletions, files);
    const review = await getAIReview(prompt);

    console.log('\n🤖 AI Code Review Results:');
    console.log('=' .repeat(50));
    console.log(review);
    console.log('=' .repeat(50));

    // Check for blocking issues
    const hasBlockingIssues = review.includes('BLOCKING: YES') || 
                             review.includes('🚫') && review.toLowerCase().includes('blocking');

    if (hasBlockingIssues) {
      console.log('\n❌ BLOCKING ISSUES FOUND - Review failed!');
      console.log('Please fix the blocking issues before proceeding.');
      process.exit(1); // Exit with error code to block the git operation
    } else {
      console.log('\n✅ AI review completed - No blocking issues found');
      process.exit(0);
    }

  } catch (error) {
    console.error('❌ AI review failed:', error.message);
    console.log('Proceeding without AI review...');
    process.exit(0); // Non-blocking for API failures
  }
}

// Run the script
if (require.main === module) {
  main().catch(error => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
}

module.exports = { main, parseDiff, createReviewPrompt };
