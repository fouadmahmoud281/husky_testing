#!/usr/bin/env node

/**
 * AI Code Review Script using GPT-4o
 * 
 * This script analyzes git changes and provides comprehensive categorized feedback:
 * 
 * 🚨 CRITICAL/BLOCKING REVIEWS:
 * 1. Syntax & Build Issues - Syntax errors, missing semicolons, TypeScript errors
 * 2. Security Vulnerabilities - Hardcoded secrets, SQL injection, XSS, unsafe eval()
 * 3. Code Style & Standards - Linting violations, formatting, naming conventions
 * 
 * � QUALITY & OPTIMIZATION REVIEWS:
 * 4. Code Quality & Best Practices - SOLID principles, complexity, maintainability
 * 5. Performance Review - Inefficient algorithms, memory leaks, optimization
 * 6. Architecture & Design - Component structure, dependencies, scalability
 * 7. Documentation Review - Missing docs, API documentation, comments
 * 
 * The script will BLOCK (exit code 1) only for Critical/Blocking issues (categories 1-3)
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

🚨 **CRITICAL/BLOCKING REVIEWS** (Will block commit/push if issues found):

**1. SYNTAX & BUILD ISSUES**: 
   - Syntax errors, missing semicolons, brackets
   - Import/export issues  
   - TypeScript type errors
   - Build-breaking changes

**2. SECURITY VULNERABILITIES**:
   - Hardcoded secrets/API keys
   - SQL injection patterns
   - XSS vulnerabilities
   - Unsafe eval() usage

**3. CODE STYLE & STANDARDS**:
   - Linting violations
   - Formatting inconsistencies
   - Naming convention violations
   - Missing required comments/docs

� **QUALITY & OPTIMIZATION REVIEWS** (Informational - won't block):

**4. CODE QUALITY & BEST PRACTICES**:
   - SOLID principles violations
   - Code complexity analysis
   - Design pattern recommendations
   - Maintainability issues

**5. PERFORMANCE REVIEW**:
   - Inefficient algorithms
   - Memory leaks potential
   - Database query optimization
   - Bundle size impact

**6. ARCHITECTURE & DESIGN**:
   - Component structure analysis
   - Dependency management
   - API design patterns
   - Scalability concerns

**7. DOCUMENTATION REVIEW**:
   - Missing documentation
   - API documentation completeness
   - README updates needed
   - Code comment quality

**Also provide:**
1. **Overall Assessment**: Brief summary of the changes and their impact
2. **Priority Recommendations**: Most critical issues to address first
3. **Improvement Suggestions**: Optional enhancements for code quality

**IMPORTANT**: 
- Mark as "BLOCKING: YES" if ANY issues found in categories 1-3 (Critical/Blocking)
- Mark as "BLOCKING: NO" if only categories 4-7 have issues or no issues found
- For each category, write "None identified" if no issues found in that category
- Provide specific file names and line references when possible
- Focus on actionable feedback
- Don't analyze files in .husky, .git, node_modules, or build directories`;

  return prompt;
}

/**
 * Check if the review contains actual critical/blocking issues
 */
function checkForCriticalIssues(review) {
  const reviewLower = review.toLowerCase();
  
  // Critical categories that should block
  const criticalSections = [
    '1. syntax & build issues',
    '2. security vulnerabilities', 
    '3. code style & standards'
  ];
  
  for (const section of criticalSections) {
    const sectionIndex = reviewLower.indexOf(section);
    if (sectionIndex !== -1) {
      // Get the content after this section header until the next numbered section
      const afterSection = reviewLower.substring(sectionIndex + section.length);
      const nextSectionMatch = afterSection.match(/\d+\./);
      const sectionContent = nextSectionMatch 
        ? afterSection.substring(0, nextSectionMatch.index)
        : afterSection.substring(0, 500); // Limit to avoid false positives
      
      // Check if this section has actual issues (not just "none identified")
      if (sectionContent.includes('none identified') || 
          sectionContent.includes('no issues') ||
          sectionContent.includes('not found') ||
          sectionContent.includes('all good')) {
        continue; // This section is clean
      }
      
      // Look for issue indicators
      if (sectionContent.includes('- ') || 
          sectionContent.includes('• ') ||
          sectionContent.includes('* ') ||
          /\d+\./.test(sectionContent) ||
          sectionContent.includes('error') ||
          sectionContent.includes('issue') ||
          sectionContent.includes('problem') ||
          sectionContent.includes('violation')) {
        return true; // Found actual issues in critical section
      }
    }
  }
  
  return false;
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
          content: 'You are an expert code reviewer with deep knowledge of software engineering best practices, security, performance optimization, and architecture design. Analyze code changes comprehensively across syntax, security, style, quality, performance, architecture, and documentation aspects. Provide specific, actionable feedback categorized by severity and impact.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 1500,
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

    // Check for blocking issues - Critical/Blocking categories (1-3)
    const reviewLower = review.toLowerCase();
    const hasBlockingIssues = 
      review.includes('BLOCKING: YES') || 
      reviewLower.includes('blocking: yes') ||
      // Check for actual issues in critical categories (not "None identified")
      checkForCriticalIssues(review);

    if (hasBlockingIssues) {
      console.log('\n❌ CRITICAL/BLOCKING ISSUES FOUND - Review failed!');
      console.log('Please fix the critical issues in categories 1-3 before proceeding.');
      process.exit(1); // Exit with error code to block the git operation
    } else {
      console.log('\n✅ AI review completed - No blocking issues found');
      if (review.toLowerCase().includes('🔍') || review.toLowerCase().includes('quality')) {
        console.log('💡 Quality suggestions available - consider addressing for improved code quality');
      }
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

module.exports = { main, parseDiff, createReviewPrompt, checkForCriticalIssues };
