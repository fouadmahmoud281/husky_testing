const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// OpenAI configuration
const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS) || 1000;

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function colorize(text, color) {
  return `${colors[color]}${text}${colors.reset}`;
}

function getGitDiff() {
  try {
    // Get the diff between current branch and origin/main (or master)
    let baseBranch = 'origin/main';
    try {
      execSync('git rev-parse --verify origin/main', { stdio: 'pipe' });
    } catch {
      try {
        execSync('git rev-parse --verify origin/master', { stdio: 'pipe' });
        baseBranch = 'origin/master';
      } catch {
        // If no remote, compare with HEAD~1
        baseBranch = 'HEAD~1';
      }
    }

    const diff = execSync(`git diff ${baseBranch}...HEAD`, { encoding: 'utf8' });
    return diff;
  } catch (error) {
    console.error(colorize('Error getting git diff:', 'red'), error.message);
    return null;
  }
}

function getChangedFiles() {
  try {
    const files = execSync('git diff --name-only HEAD~1...HEAD', { encoding: 'utf8' });
    return files.trim().split('\n').filter(file => file.length > 0);
  } catch (error) {
    console.error(colorize('Error getting changed files:', 'red'), error.message);
    return [];
  }
}

async function reviewCode(diff, changedFiles) {
  if (!diff || diff.trim().length === 0) {
    console.log(colorize('No changes detected. Skipping AI review.', 'yellow'));
    return { success: true, recommendations: [] };
  }

  const prompt = `
You are an expert code reviewer. Please review the following git diff and provide constructive feedback.

Focus on:
1. Code quality and best practices
2. Potential bugs or security issues
3. Performance optimizations
4. Maintainability and readability
5. React/JavaScript specific improvements
6. Testing suggestions

Changed files: ${changedFiles.join(', ')}

Git diff:
\`\`\`diff
${diff}
\`\`\`

Please provide:
1. A brief overall assessment (GOOD/NEEDS_IMPROVEMENT/CRITICAL_ISSUES)
2. Specific recommendations with line references when applicable
3. Positive feedback for good practices
4. Prioritized list of improvements

Format your response as:
**ASSESSMENT:** [GOOD/NEEDS_IMPROVEMENT/CRITICAL_ISSUES]
**SUMMARY:** Brief overview of the changes

**RECOMMENDATIONS:**
- [Priority: HIGH/MEDIUM/LOW] Description with specific suggestions

**POSITIVE FEEDBACK:**
- Good practices observed in the code

Keep it concise but actionable.
`;

  try {
    console.log(colorize('🤖 Sending code to AI for review...', 'cyan'));
    
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are an expert code reviewer specializing in React, JavaScript, and web development best practices.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: MAX_TOKENS,
      temperature: 0.3,
    });

    const review = response.choices[0].message.content;
    console.log(colorize('\n📋 AI Code Review Results:', 'bright'));
    console.log('=' .repeat(60));
    console.log(review);
    console.log('=' .repeat(60));

    // Parse assessment level
    const assessmentMatch = review.match(/\*\*ASSESSMENT:\*\*\s*(GOOD|NEEDS_IMPROVEMENT|CRITICAL_ISSUES)/i);
    const assessment = assessmentMatch ? assessmentMatch[1].toUpperCase() : 'NEEDS_IMPROVEMENT';

    // Determine if we should block the push
    const shouldBlock = assessment === 'CRITICAL_ISSUES';
    
    if (shouldBlock) {
      console.log(colorize('\n⚠️  CRITICAL ISSUES DETECTED - Push blocked!', 'red'));
      console.log(colorize('Please address the critical issues before pushing.', 'red'));
    } else if (assessment === 'NEEDS_IMPROVEMENT') {
      console.log(colorize('\n📝 Improvements suggested but push allowed.', 'yellow'));
      console.log(colorize('Consider addressing the recommendations for better code quality.', 'yellow'));
    } else {
      console.log(colorize('\n✅ Code looks good! Great work!', 'green'));
    }

    return {
      success: !shouldBlock,
      assessment,
      review,
      recommendations: review.split('**RECOMMENDATIONS:**')[1]?.split('**POSITIVE FEEDBACK:**')[0]?.trim() || ''
    };

  } catch (error) {
    console.error(colorize('Error during AI review:', 'red'), error.message);
    
    if (error.message.includes('API key')) {
      console.error(colorize('\n🔑 Please set your OpenAI API key in the .env file:', 'yellow'));
      console.error(colorize('OPENAI_API_KEY=your_api_key_here', 'cyan'));
      console.error(colorize('\nCopy .env.example to .env and add your API key.', 'yellow'));
    }
    
    // Don't block push on API errors, just warn
    console.log(colorize('\n⚠️  AI review failed, but allowing push to continue.', 'yellow'));
    return { success: true, error: error.message };
  }
}

function saveReviewLog(review, changedFiles) {
  const logDir = path.join(process.cwd(), '.husky', 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(logDir, `review-${timestamp}.md`);
  
  const logContent = `# AI Code Review Log
**Date:** ${new Date().toLocaleString()}
**Changed Files:** ${changedFiles.join(', ')}

${review.review || review.error || 'Review completed'}
`;

  fs.writeFileSync(logFile, logContent);
  console.log(colorize(`\n📝 Review log saved to: ${logFile}`, 'blue'));
}

async function main() {
  console.log(colorize('🚀 Starting AI Code Review...', 'bright'));
  
  // Check if OpenAI API key is configured
  if (!process.env.OPENAI_API_KEY) {
    console.error(colorize('❌ OPENAI_API_KEY not found in environment variables.', 'red'));
    console.error(colorize('Please copy .env.example to .env and add your OpenAI API key.', 'yellow'));
    process.exit(1);
  }

  const diff = getGitDiff();
  const changedFiles = getChangedFiles();

  if (!diff) {
    console.log(colorize('No git diff available. Skipping review.', 'yellow'));
    process.exit(0);
  }

  console.log(colorize(`📁 Changed files: ${changedFiles.join(', ')}`, 'blue'));
  
  const result = await reviewCode(diff, changedFiles);
  
  // Save review log
  saveReviewLog(result, changedFiles);
  
  if (!result.success) {
    process.exit(1);
  }
  
  console.log(colorize('\n🎉 Code review completed successfully!', 'green'));
}

// Run the main function
main().catch((error) => {
  console.error(colorize('Unexpected error:', 'red'), error);
  process.exit(1);
});
